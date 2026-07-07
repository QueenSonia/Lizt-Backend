import { ConfigService } from '@nestjs/config';
import { RolesEnum } from 'src/base.entity';
import { CacheService } from 'src/lib/cache';
import { Property } from 'src/properties/entities/property.entity';
import {
  PropertyStatusEnum,
  TenantStatusEnum,
} from 'src/properties/dto/create-property.dto';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { MaintenanceRequest } from 'src/maintenance-requests/entities/maintenance-request.entity';
import { Account, accountHasRole } from 'src/users/entities/account.entity';
import { Users } from 'src/users/entities/user.entity';
import { UtilService } from 'src/utils/utility-service';
import { WhatsappUtils } from 'src/whatsapp-bot/utils/whatsapp';
import { Repository } from 'typeorm/repository/Repository';
import { In } from 'typeorm';
import { KYCLinksService } from 'src/kyc-links/kyc-links.service';
import { ChatLogService } from 'src/whatsapp-bot/chat-log.service';
import { ManagementScopeService } from 'src/common/scope/management-scope.service';

/**
 * The acting operator behind an inbound landlord-flow message: an ADMIN
 * (property manager) spanning every managed landlord, or a plain LANDLORD
 * spanning only itself. `landlordIds` is the set of landlord Account.ids the
 * actor's queries must scope to (owner columns hold landlord ids only).
 */
interface LookupActor {
  account: Account;
  user: Users;
  landlordIds: string[];
  isAdmin: boolean;
}

// --- landlordLookup.ts ---
export class LandlordLookup {
  private whatsappUtil: WhatsappUtils;

  // ✅ Define timeout in milliseconds
  private readonly SESSION_TIMEOUT_MS = 5 * 60 * 1000;

  constructor(
    private cache: CacheService,
    private propertyRepo: Repository<Property>,
    private readonly usersRepo: Repository<Users>,
    private readonly accountRepo: Repository<Account>,
    private readonly propertyTenantRepo: Repository<PropertyTenant>,
    private readonly maintenanceRequestRepo: Repository<MaintenanceRequest>,
    private readonly utilService: UtilService,
    private readonly kycLinksService: KYCLinksService,
    private readonly scopeService: ManagementScopeService,
    private readonly chatLogService?: ChatLogService,
  ) {
    const config = new ConfigService();
    this.whatsappUtil = new WhatsappUtils(config, chatLogService);
  }

  private key(from: string) {
    return `maintenance_request_state_landlord_${from}`;
  }

  private ownerDisplayName(owner: Account | null | undefined): string {
    return (
      owner?.profile_name ||
      `${owner?.user?.first_name ?? ''} ${owner?.user?.last_name ?? ''}`.trim() ||
      'Unnamed landlord'
    );
  }

  /** Mirrors LandlordFlow.resolveActor — see that method for the contract. */
  private async resolveActor(from: string): Promise<LookupActor | null> {
    const normalizedPhone = this.utilService.normalizePhoneNumber(from);
    const user = await this.usersRepo.findOne({
      where: { phone_number: normalizedPhone },
      relations: ['accounts'],
    });
    if (!user) return null;

    const adminAccount = user.accounts?.find((a) =>
      accountHasRole(a, RolesEnum.ADMIN),
    );
    if (adminAccount) {
      const landlordIds = await this.scopeService.resolveManagedLandlordIds(
        adminAccount.id,
      );
      return { account: adminAccount, user, landlordIds, isAdmin: true };
    }

    const landlordAccount = user.accounts?.find((a) =>
      accountHasRole(a, RolesEnum.LANDLORD),
    );
    if (!landlordAccount) return null;
    return {
      account: landlordAccount,
      user,
      landlordIds: [landlordAccount.id],
      isAdmin: false,
    };
  }

  /**
   * Digit reply while a `generate_kyc_link` selection state is live: an
   * admin with several managed landlords picked which landlord to generate
   * the (landlord-scoped) KYC link for. Anything else falls back to the menu.
   */
  async handleGenerateKYCLinkText(from: string, text: string) {
    const raw = await this.cache.get(this.key(from));
    const state = typeof raw === 'string' ? JSON.parse(raw) : raw;

    if (
      state?.type === 'generate_kyc_link' &&
      Array.isArray(state.ids) &&
      state.ids.length
    ) {
      const selectedIndex = parseInt(text.trim(), 10) - 1;
      if (
        !isNaN(selectedIndex) &&
        selectedIndex >= 0 &&
        selectedIndex < state.ids.length
      ) {
        await this.cache.delete(this.key(from));
        await this.generateAndSendKycLink(from, state.ids[selectedIndex]);
        return;
      }
      await this.whatsappUtil.sendText(
        from,
        'Invalid selection. Please reply with a valid number, or "done" to exit.',
      );
      return;
    }

    await this.handleExitOrMenu(from, text);
  }

  async handleExitOrMenu(from: string, text: string) {
    if (text.toLowerCase() === 'done') {
      await this.whatsappUtil.sendText(
        from,
        'Thanks! You have exited landlord flow.',
      );
      await this.cache.delete(`maintenance_request_state_landlord_${from}`);
    } else {
      const actor = await this.resolveActor(from);
      const greetName =
        actor?.account?.profile_name || actor?.user?.first_name || 'there';

      // Use template with URL buttons for direct redirects
      await this.whatsappUtil.sendLandlordMainMenu(from, greetName);
      return;
    }
  }

  async startGenerateKYCLinkFlow(from: string) {
    console.log('🔍 startGenerateKYCLinkFlow called with phone:', from);

    const actor = await this.resolveActor(from);
    if (!actor) {
      await this.whatsappUtil.sendText(
        from,
        'Account not found. Please try again.',
      );
      return;
    }

    if (!actor.landlordIds.length) {
      await this.whatsappUtil.sendText(
        from,
        "You don't have any landlords yet. Add a landlord in the web app to generate KYC links.",
      );
      return;
    }

    // Fetch all vacant and ready for marketing properties (including
    // offer_pending and offer_accepted) across the actor's landlord scope.
    const properties = await this.propertyRepo.find({
      where: [
        {
          owner_id: In(actor.landlordIds),
          property_status: PropertyStatusEnum.VACANT,
        },
        {
          owner_id: In(actor.landlordIds),
          property_status: PropertyStatusEnum.OFFER_PENDING,
        },
        {
          owner_id: In(actor.landlordIds),
          property_status: PropertyStatusEnum.OFFER_ACCEPTED,
        },
      ],
    });

    if (!properties.length) {
      await this.whatsappUtil.sendText(
        from,
        '🏠 You do not have any vacant properties at the moment.\n\nPlease add some properties or ensure your properties are marked as vacant to generate KYC links.',
      );
      return;
    }

    // KYC links are landlord-scoped. A plain landlord (or an admin managing
    // exactly one landlord) generates directly; an admin with several
    // managed landlords picks which landlord the link is for. Only offer
    // landlords that actually have marketable properties.
    const landlordIdsWithVacancies = Array.from(
      new Set(properties.map((p) => p.owner_id)),
    );

    if (landlordIdsWithVacancies.length === 1) {
      await this.generateAndSendKycLink(from, landlordIdsWithVacancies[0]);
      return;
    }

    const landlordAccounts = await this.accountRepo.find({
      where: { id: In(landlordIdsWithVacancies) },
      relations: ['user'],
    });
    // Keep the option order stable and index-aligned with the cached ids.
    const options = landlordIdsWithVacancies.map((id) => {
      const account = landlordAccounts.find((a) => a.id === id);
      const name =
        account?.profile_name ||
        `${account?.user?.first_name ?? ''} ${account?.user?.last_name ?? ''}`.trim() ||
        'Unnamed landlord';
      return { id, name };
    });

    let message = 'Which landlord is this KYC link for?\n\n';
    options.forEach((opt, i) => {
      message += `${i + 1}. ${opt.name}\n`;
    });
    message += '\nReply with the number of the landlord.';

    await this.whatsappUtil.sendText(from, message);

    await this.cache.set(
      this.key(from),
      JSON.stringify({
        type: 'generate_kyc_link',
        ids: options.map((opt) => opt.id),
        step: 'no_step',
        data: {},
      }),
      this.SESSION_TIMEOUT_MS,
    );
  }

  /**
   * Generate (or fetch) the landlord-scoped general KYC link and send it to
   * the requesting phone. Shared by the direct path and the admin's
   * landlord-selection path.
   */
  private async generateAndSendKycLink(
    from: string,
    landlordAccountId: string,
  ): Promise<void> {
    try {
      const kycLinkResponse =
        await this.kycLinksService.generateKYCLink(landlordAccountId);

      const baseUrl = process.env.FRONTEND_URL || 'https://www.lizt.co';
      const kycLink = `${baseUrl}/kyc/${kycLinkResponse.token}`;

      const landlordAccount = await this.accountRepo.findOne({
        where: { id: landlordAccountId },
        relations: ['user'],
      });
      const landlordName =
        landlordAccount?.profile_name ||
        `${landlordAccount?.user?.first_name ?? ''} ${landlordAccount?.user?.last_name ?? ''}`.trim() ||
        'Your Properties';

      // Send the general KYC link
      await this.whatsappUtil.sendText(
        from,
        `✅ General KYC link for ${landlordName}\n\n🔗 ${kycLink}\n.`,
      );
    } catch (error) {
      console.error('Error generating KYC link:', error);

      // Extract meaningful error message
      let errorMessage =
        'Failed to generate KYC link. Please try again or contact support.';

      if (error.response?.message) {
        // Handle NestJS HttpException errors
        const message = error.response.message;
        if (message.includes('no properties')) {
          errorMessage = `❌ Cannot generate KYC link\n\nYou don't have any properties available for rent applications.`;
        } else if (message.includes('not found')) {
          errorMessage = `❌ Landlord account not found. Please try again.`;
        } else {
          errorMessage = `❌ ${message}`;
        }
      } else if (error.message) {
        // Handle generic errors
        errorMessage = `❌ ${error.message}`;
      }

      await this.whatsappUtil.sendText(from, errorMessage);
    }
  }

  async handleViewTenancies(from: string) {
    const actor = await this.resolveActor(from);

    if (!actor) {
      await this.whatsappUtil.sendText(from, 'No tenancy info available.');
      return;
    }

    if (!actor.landlordIds.length) {
      await this.whatsappUtil.sendText(from, 'No tenancies found.');
      return;
    }

    const propertyTenants = await this.propertyTenantRepo.find({
      where: {
        property: { owner_id: In(actor.landlordIds) },
        status: TenantStatusEnum.ACTIVE,
      },
      relations: [
        'property',
        'property.owner',
        'property.owner.user',
        'property.rents',
        'tenant',
        'tenant.user',
      ],
    });

    if (!propertyTenants?.length) {
      await this.whatsappUtil.sendText(from, 'No tenancies found.');
      return;
    }

    let tenancyMessage = 'Here are your current tenancies:\n';
    for (const [i, pt] of propertyTenants.entries()) {
      const latestRent =
        pt.property.rents?.[pt.property.rents.length - 1] || null;
      const tenantName = pt.tenant?.user
        ? `${pt.tenant.user.first_name} ${pt.tenant.user.last_name}`
        : 'Vacant';

      const rentAmount = latestRent?.rental_price
        ? latestRent.rental_price.toLocaleString('en-NG', {
            style: 'currency',
            currency: 'NGN',
          })
        : '——';

      const dueDate = latestRent?.expiry_date
        ? new Date(latestRent.expiry_date).toLocaleDateString('en-NG', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })
        : '——';

      // The admin's list spans several landlords — say whose tenancy each is.
      const ownerLine = actor.isAdmin
        ? `Landlord: ${this.ownerDisplayName(pt.property.owner)}\n`
        : '';

      tenancyMessage += `${i + 1}. ${pt.property.name}\n${ownerLine}${tenantName}\n${rentAmount}/yr\nNext rent due: ${dueDate}\n\n`;
    }

    await this.whatsappUtil.sendText(from, tenancyMessage);
    await this.whatsappUtil.sendText(
      from,
      'Reply with the number of the tenancy you want to view (e.g., 1 for first property).',
    );

    await this.cache.set(
      `maintenance_request_state_landlord_${from}`,
      JSON.stringify({
        type: 'tenancy',
        ids: propertyTenants.map((pt) => pt.id),
        step: 'no_step',
        data: {},
      }),
      this.SESSION_TIMEOUT_MS,
    );
  }

  async handleViewMaintenance(from: string) {
    const actor = await this.resolveActor(from);

    if (!actor) {
      await this.whatsappUtil.sendText(from, 'No maintenance info available.');
      return;
    }

    if (!actor.landlordIds.length) {
      await this.whatsappUtil.sendText(from, 'No maintenance requests found.');
      return;
    }

    // Requests across BOTH scopes: unit (property.owner_id) and common area
    // (common_area.owner_id). Both owner columns hold a landlord's
    // Account.id, so the array-of-where ORs them over the actor's scope.
    const maintenanceRequests = await this.maintenanceRequestRepo.find({
      where: [
        { property: { owner_id: In(actor.landlordIds) } },
        { common_area: { owner_id: In(actor.landlordIds) } },
      ],
      relations: [
        'property',
        'common_area',
        'tenant',
        'tenant.user',
        'facilityManager',
      ],
      order: { date_reported: 'DESC' },
    });

    if (!maintenanceRequests?.length) {
      await this.whatsappUtil.sendText(from, 'No maintenance requests found.');
      return;
    }

    let maintenanceMessage = 'Here are open maintenance requests:\n';
    for (const [i, req] of maintenanceRequests.entries()) {
      const reportedDate = new Date(req.date_reported).toLocaleDateString(
        'en-NG',
        {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        },
      );

      const locationName =
        req.property?.name ??
        req.property_name ??
        req.common_area?.name ??
        'Common area';
      maintenanceMessage += `${i + 1}. ${locationName} – ${req.issue_category} – Reported ${reportedDate} – Status: ${req.status}\n`;
    }

    await this.whatsappUtil.sendText(from, maintenanceMessage);
    await this.whatsappUtil.sendText(
      from,
      'Reply with the number of the request you want to view.',
    );

    await this.cache.set(
      `maintenance_request_state_landlord_${from}`,
      JSON.stringify({
        type: 'maintenance',
        ids: maintenanceRequests.map((req) => req.id),
        step: 'no_step',
        data: {},
      }),
      this.SESSION_TIMEOUT_MS,
    );
  }
}
