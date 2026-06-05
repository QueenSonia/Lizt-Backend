import { ConfigService } from '@nestjs/config';
import { RolesEnum } from 'src/base.entity';
import { CacheService } from 'src/lib/cache';
import { Property } from 'src/properties/entities/property.entity';
import { PropertyStatusEnum, TenantStatusEnum } from 'src/properties/dto/create-property.dto';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { MaintenanceRequest } from 'src/maintenance-requests/entities/maintenance-request.entity';
import { Account, accountHasRole } from 'src/users/entities/account.entity';
import { Users } from 'src/users/entities/user.entity';
import { UtilService } from 'src/utils/utility-service';
import { WhatsappUtils } from 'src/whatsapp-bot/utils/whatsapp';
import { Repository } from 'typeorm/repository/Repository';
import { Not, IsNull } from 'typeorm';
import { KYCLinksService } from 'src/kyc-links/kyc-links.service';
import { ChatLogService } from 'src/whatsapp-bot/chat-log.service';

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
    private readonly chatLogService?: ChatLogService,
  ) {
    const config = new ConfigService();
    this.whatsappUtil = new WhatsappUtils(config, chatLogService);
  }

  private key(from: string) {
    return `maintenance_request_state_landlord_${from}`;
  }

  async handleGenerateKYCLinkText(from: string, text: string) {
    // Since we now generate general links immediately, this method just handles exit/menu
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
      const ownerUser = await this.usersRepo.findOne({
        where: { phone_number: `${from}` },
        relations: ['accounts'],
      });

      const landlordAccount = ownerUser?.accounts?.find((acc) =>
        accountHasRole(acc, RolesEnum.LANDLORD),
      );

      const landlordName =
        landlordAccount?.profile_name || ownerUser?.first_name || 'there';

      // Use template with URL buttons for direct redirects
      await this.whatsappUtil.sendLandlordMainMenu(from, landlordName);
      return;
    }
  }

  async startGenerateKYCLinkFlow(from: string) {
    console.log('🔍 startGenerateKYCLinkFlow called with phone:', from);

    const normalizedPhone = this.utilService.normalizePhoneNumber(from);

    console.log('📞 Phone format:', {
      original: from,
      normalized: normalizedPhone,
    });

    const user = await this.usersRepo.findOne({
      where: { phone_number: normalizedPhone },
      relations: ['accounts'],
    });

    console.log('👤 User lookup result:', {
      found: !!user,
      userId: user?.id,
      userPhone: user?.phone_number,
      accountsCount: user?.accounts?.length || 0,
      accounts:
        user?.accounts?.map((acc) => ({ id: acc.id, roles: acc.roles })) || [],
    });

    if (!user) {
      await this.whatsappUtil.sendText(
        from,
        'Account not found. Please try again.',
      );
      return;
    }

    // Find the landlord account for this user
    const landlordAccount = user.accounts?.find((account) =>
      accountHasRole(account, RolesEnum.LANDLORD),
    );

    console.log('🏠 Landlord account lookup:', {
      found: !!landlordAccount,
      accountId: landlordAccount?.id,
      accountRoles: landlordAccount?.roles,
      searchingFor: RolesEnum.LANDLORD,
    });

    if (!landlordAccount) {
      await this.whatsappUtil.sendText(
        from,
        'Landlord account not found. Please try again.',
      );
      return;
    }

    const ownerUser = user;

    // Fetch all vacant and ready for marketing properties (including offer_pending and offer_accepted)
    const properties = await this.propertyRepo.find({
      where: [
        {
          owner_id: landlordAccount.id,
          property_status: PropertyStatusEnum.VACANT,
        },
        {
          owner_id: landlordAccount.id,
          property_status: PropertyStatusEnum.OFFER_PENDING,
        },
        {
          owner_id: landlordAccount.id,
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

    try {
      // Generate or retrieve existing general KYC link for landlord
      const kycLinkResponse = await this.kycLinksService.generateKYCLink(
        ownerUser.accounts[0].id,
      );

      const baseUrl = process.env.FRONTEND_URL || 'https://www.lizt.co';
      const kycLink = `${baseUrl}/kyc/${kycLinkResponse.token}`;

      // Get vacant properties count
      const vacantPropertiesCount = properties.length;

      // Get landlord's profile name
      const landlordName =
        ownerUser.accounts[0].profile_name ||
        `${ownerUser.first_name} ${ownerUser.last_name}`.trim() ||
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
    const normalizedPhone = this.utilService.normalizePhoneNumber(from);

    const user = await this.usersRepo.findOne({
      where: { phone_number: normalizedPhone },
      relations: ['accounts'],
    });

    if (!user) {
      await this.whatsappUtil.sendText(from, 'No tenancy info available.');
      return;
    }

    // Find the landlord account for this user
    const landlordAccount = user.accounts?.find((account) =>
      accountHasRole(account, RolesEnum.LANDLORD),
    );

    if (!landlordAccount) {
      await this.whatsappUtil.sendText(from, 'Landlord account not found.');
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

  async handleViewMaintenance(from: string) {
    const normalizedPhone = this.utilService.normalizePhoneNumber(from);

    const user = await this.usersRepo.findOne({
      where: { phone_number: normalizedPhone },
      relations: ['accounts'],
    });

    if (!user) {
      await this.whatsappUtil.sendText(from, 'No maintenance info available.');
      return;
    }

    // Find the landlord account for this user
    const landlordAccount = user.accounts?.find((account) =>
      accountHasRole(account, RolesEnum.LANDLORD),
    );

    if (!landlordAccount) {
      await this.whatsappUtil.sendText(from, 'Landlord account not found.');
      return;
    }

    // Landlord's requests across BOTH scopes: unit (property.owner_id) and
    // common area (common_area.owner_id). Both owner columns hold the
    // landlord's Account.id, so the array-of-where ORs them on the same id.
    const maintenanceRequests = await this.maintenanceRequestRepo.find({
      where: [
        { property: { owner_id: landlordAccount.id } },
        { common_area: { owner_id: landlordAccount.id } },
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
