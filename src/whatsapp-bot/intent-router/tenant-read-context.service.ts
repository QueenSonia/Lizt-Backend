import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Not } from 'typeorm';

import { MaintenanceRequest } from 'src/maintenance-requests/entities/maintenance-request.entity';
import {
  MaintenanceRequestStatusEnum,
} from 'src/maintenance-requests/dto/create-maintenance-request.dto';
import { mapMRStatusForTenant } from 'src/maintenance-requests/utils/tenant-view';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { Rent } from 'src/rents/entities/rent.entity';
import { RentStatusEnum } from 'src/rents/dto/create-rent.dto';
import { TenantStatusEnum } from 'src/properties/dto/create-property.dto';
import { Account } from 'src/users/entities/account.entity';
import { TenantBalancesService } from 'src/tenant-balances/tenant-balances.service';
import { TeamMember } from 'src/users/entities/team-member.entity';
import { UtilService } from 'src/utils/utility-service';

/**
 * Read-only context source for the intent router.
 *
 * Every method on this service must:
 *   1. Take a `tenantAccountId` (Account.id) as the first arg and use it as
 *      the scope. No cross-tenant reads.
 *   2. Return only fields a tenant could already see today via the bot or the
 *      tenant-facing web pages. No raw maintenance request status leaks —
 *      always remap with mapMRStatusForTenant.
 *   3. Be side-effect-free.
 */
@Injectable()
export class TenantReadContextService {
  private readonly logger = new Logger(TenantReadContextService.name);

  constructor(
    @InjectRepository(PropertyTenant)
    private readonly propertyTenantRepo: Repository<PropertyTenant>,
    @InjectRepository(Rent)
    private readonly rentRepo: Repository<Rent>,
    @InjectRepository(MaintenanceRequest)
    private readonly mrRepo: Repository<MaintenanceRequest>,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    @InjectRepository(TeamMember)
    private readonly teamMemberRepo: Repository<TeamMember>,
    private readonly tenantBalancesService: TenantBalancesService,
    private readonly utilService: UtilService,
  ) {}

  async getTenancy(tenantAccountId: string): Promise<TenancySummary[]> {
    const propertyTenants = await this.propertyTenantRepo.find({
      where: { tenant_id: tenantAccountId, status: TenantStatusEnum.ACTIVE },
      relations: ['property', 'property.owner'],
    });

    const out: TenancySummary[] = [];
    for (const pt of propertyTenants) {
      const rent = await this.rentRepo.findOne({
        where: {
          property_id: pt.property.id,
          tenant_id: tenantAccountId,
          rent_status: RentStatusEnum.ACTIVE,
        },
      });
      out.push({
        propertyId: pt.property.id,
        propertyName: pt.property.name,
        propertyLocation: pt.property.location,
        rentAmount: rent?.rental_price ?? null,
        startDate: rent?.rent_start_date ?? null,
        endDate: rent?.expiry_date ?? null,
        landlordAccountId: pt.property.owner?.id ?? null,
      });
    }
    return out;
  }

  async getBalance(
    tenantAccountId: string,
    landlordAccountId: string,
  ): Promise<number> {
    return this.tenantBalancesService.getBalance(tenantAccountId, landlordAccountId);
  }

  /**
   * Tenant-visible status: only 'pending' or 'closed'. Internal status enum
   * names are never exposed.
   */
  async getOpenMaintenanceRequests(
    tenantAccountId: string,
  ): Promise<TenantVisibleMR[]> {
    const rows = await this.mrRepo.find({
      where: {
        tenant_id: tenantAccountId,
        status: Not(
          In([
            MaintenanceRequestStatusEnum.CLOSED,
            MaintenanceRequestStatusEnum.REJECTED,
          ]),
        ),
      },
      order: { created_at: 'DESC' },
      take: 10,
    });

    return rows.map((r) => ({
      id: r.id,
      description: r.description,
      status: mapMRStatusForTenant(r.status),
      createdAt: r.created_at ?? new Date(),
      notes: r.notes ?? null,
    }));
  }

  /**
   * The most-recent MR for this tenant that is currently waiting on a
   * tenant confirmation (because an FM or landlord filed it on their
   * behalf). Used to resolve which request the tenant means when they text
   * "yes that's mine" / "no I never reported that" instead of tapping the
   * template buttons.
   */
  async getPendingTenantConfirmationMR(
    tenantAccountId: string,
  ): Promise<{ id: string; description: string } | null> {
    const row = await this.mrRepo.findOne({
      where: {
        tenant_id: tenantAccountId,
        status: MaintenanceRequestStatusEnum.PENDING_TENANT_CONFIRMATION,
      },
      order: { created_at: 'DESC' },
    });
    if (!row) return null;
    return { id: row.id, description: row.description };
  }

  /**
   * Returns the landlord's display name + WhatsApp-ready phone, derived
   * the same way templates show it (per [[landlord_display_name]]).
   */
  async getLandlordContact(
    landlordAccountId: string,
  ): Promise<{ name: string; phone: string | null } | null> {
    const acc = await this.accountRepo.findOne({
      where: { id: landlordAccountId },
      relations: ['user'],
    });
    if (!acc) return null;
    const name =
      acc.profile_name ||
      `${acc.user?.first_name ?? ''} ${acc.user?.last_name ?? ''}`.trim() ||
      'Your landlord';
    const phone = acc.user?.phone_number
      ? this.utilService.normalizePhoneNumber(acc.user.phone_number)
      : null;
    return { name, phone };
  }

  /**
   * Best-effort FM lookup for the tenant's first property. If the tenant
   * has multiple properties, only the first property's FM is returned —
   * full multi-property disambiguation isn't supported here yet.
   */
  async getFmContact(
    tenantAccountId: string,
  ): Promise<{ name: string; phone: string | null } | null> {
    const pt = await this.propertyTenantRepo.findOne({
      where: { tenant_id: tenantAccountId, status: TenantStatusEnum.ACTIVE },
      relations: ['property', 'property.owner'],
    });
    if (!pt?.property?.owner?.id) return null;
    const landlordId = pt.property.owner.id;

    const tm = await this.teamMemberRepo.findOne({
      where: { role: 'facility_manager' as never },
      relations: ['account', 'account.user', 'team'],
    });
    // The repo doesn't have a direct property↔team_member link, so we
    // filter loosely. This deliberately returns null when ambiguous —
    // the router will then fall back to landlord contact / message-to-fm.
    if (!tm || !tm.account || tm.team?.creatorId !== landlordId) return null;

    const name =
      tm.account.profile_name ||
      `${tm.account.user?.first_name ?? ''} ${tm.account.user?.last_name ?? ''}`.trim() ||
      'Your facility manager';
    const phone = tm.account.user?.phone_number
      ? this.utilService.normalizePhoneNumber(tm.account.user.phone_number)
      : null;
    return { name, phone };
  }
}

export interface TenancySummary {
  propertyId: string;
  propertyName: string;
  propertyLocation: string;
  rentAmount: number | string | null;
  startDate: Date | string | null;
  endDate: Date | string | null;
  landlordAccountId: string | null;
}

export interface TenantVisibleMR {
  id: string;
  description: string;
  status: 'pending' | 'closed';
  createdAt: Date | string;
  notes: string | null;
}
