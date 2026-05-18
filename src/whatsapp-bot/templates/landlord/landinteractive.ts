import { Repository } from 'typeorm';
import { CacheService } from 'src/lib/cache';
import { RolesEnum } from 'src/base.entity';
import {
  Users,
} from 'src/users/entities/user.entity';
import { accountHasRole } from 'src/users/entities/account.entity';
import { MaintenanceRequest } from 'src/maintenance-requests/entities/maintenance-request.entity';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { TenantStatusEnum } from 'src/properties/dto/create-property.dto';
import { WhatsappUtils } from 'src/whatsapp-bot/utils/whatsapp';
import { ConfigService } from '@nestjs/config';
import { ChatLogService } from 'src/whatsapp-bot/chat-log.service';

export class LandlordInteractive {
  private whatsappUtil: WhatsappUtils;

  // ✅ Define timeout in milliseconds
  private readonly SESSION_TIMEOUT_MS = 5 * 60 * 1000;

  constructor(
    private usersRepo: Repository<Users>,
    private maintenanceRequestRepo: Repository<MaintenanceRequest>,
    private propertyTenantRepo: Repository<PropertyTenant>,
    private cache: CacheService,
    private chatLogService?: ChatLogService,
  ) {
    const config = new ConfigService();
    this.whatsappUtil = new WhatsappUtils(config, chatLogService);
  }

  // async handle(message: any, from: string) {
  //   const buttonReply = message.interactive?.button_reply;
  //   if (!buttonReply) return;

  //   const handlers: Record<string, () => Promise<void>> = {
  //     view_tenancies: () => this.handleViewTenancies(from),
  //     view_maintenance: () => this.handleViewMaintenance(from),
  //     new_tenant: () => this.handleNewTenant(from),
  //   };

  //   const handler = handlers[buttonReply.id];
  //   if (handler) {
  //     await handler();
  //   } else {
  //     await this.handleFallback(from, buttonReply.id);
  //   }
  // }

  private async handleViewTenancies(from: string) {
    const ownerUser = await this.usersRepo.findOne({
      where: { phone_number: `${from}` },
      relations: ['accounts'],
    });

    const landlordAccount = ownerUser?.accounts?.find((acc) =>
      accountHasRole(acc, RolesEnum.LANDLORD),
    );

    if (!ownerUser || !landlordAccount) {
      await this.whatsappUtil.sendText(from, 'No tenancy info available.');
      return;
    }

    const propertyTenants = await this.propertyTenantRepo.find({
      where: {
        property: { owner_id: landlordAccount.id },
        status: TenantStatusEnum.ACTIVE,
      },
      relations: ['property', 'property.rents', 'tenant', 'tenant.user'],
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

      tenancyMessage += `${i + 1}. ${pt.property.name}\n${tenantName}\n${rentAmount}/yr\nNext rent due: ${dueDate}\n\n`;
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

  private async handleViewMaintenance(from: string) {
    const ownerUser = await this.usersRepo.findOne({
      where: { phone_number: `${from}` },
      relations: ['accounts'],
    });

    const landlordAccount = ownerUser?.accounts?.find((acc) =>
      accountHasRole(acc, RolesEnum.LANDLORD),
    );

    if (!ownerUser || !landlordAccount) {
      await this.whatsappUtil.sendText(from, 'No maintenance info available.');
      return;
    }

    const maintenanceRequests = await this.maintenanceRequestRepo.find({
      where: { property: { owner_id: landlordAccount.id } },
      relations: [
        'property',
        'tenant',
        'tenant.user',
        'facilityManager',
        'notification',
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

      maintenanceMessage += `${i + 1}. ${req.property_name} – ${req.issue_category} – Reported ${reportedDate} – Status: ${req.status}\n`;
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

  private async handleNewTenant(from: string) {
    // delegate to flow
    await this.whatsappUtil.sendText(from, 'Starting tenant onboarding...');
    // You can call flow.startAddTenantFlow(from) here
  }

  private async handleFallback(from: string, id: string) {
    await this.whatsappUtil.sendText(
      from,
      `Got it! You selected ${id}. Before we connect you with our team, may we have your full name?`,
    );
    await this.cache.set(
      `maintenance_request_state_default_${from}`,
      `property_owner_options_${id}`,
      this.SESSION_TIMEOUT_MS,
    );
  }
}
