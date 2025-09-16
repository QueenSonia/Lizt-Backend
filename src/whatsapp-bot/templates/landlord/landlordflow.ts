import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { RolesEnum } from 'src/base.entity';
import { CacheService } from 'src/lib/cache';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { ServiceRequest } from 'src/service-requests/entities/service-request.entity';
import { Users } from 'src/users/entities/user.entity';
import { WhatsappUtils } from 'src/whatsapp-bot/utils/whatsapp';
import { Repository } from 'typeorm';
import { LandlordLookup } from './landlordlookup';
import { Account } from 'src/users/entities/account.entity';
import { Property } from 'src/properties/entities/property.entity';
import { TenantStatusEnum } from 'src/properties/dto/create-property.dto';
import { UtilService } from 'src/utils/utility-service';
import { RentPaymentStatusEnum, RentStatusEnum } from 'src/rents/dto/create-rent.dto';
import { Rent } from 'src/rents/entities/rent.entity';

@Injectable()
export class LandlordFlow {
  private whatsappUtil: WhatsappUtils;
  private lookup: LandlordLookup;
  constructor(
    @InjectRepository(Users)
    private readonly usersRepo: Repository<Users>,

    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,

    @InjectRepository(Property)
    private readonly propertyRepo: Repository<Property>,

    @InjectRepository(PropertyTenant)
    private readonly propertyTenantRepo: Repository<PropertyTenant>,

    @InjectRepository(ServiceRequest)
    private readonly serviceRequestRepo: Repository<ServiceRequest>,

    @InjectRepository(Rent)
    private readonly rentRepo: Repository<Rent>,

    private readonly cache: CacheService,
  ) {
    const config = new ConfigService();
    this.whatsappUtil = new WhatsappUtils(config);
    this.lookup = new LandlordLookup(
      cache,
      propertyTenantRepo,
      serviceRequestRepo,
    );
  }

  /**
   * Handle landlord TEXT input
   */
  async handleText(from: string, text: string) {
    if (['done', 'menu'].includes(text?.toLowerCase())) {
      await this.handleExitOrMenu(from, text);
      return;
    }

    const raw = await this.cache.get(`service_request_state_landlord_${from}`);
    if (!raw) {
      await this.whatsappUtil.sendText(from, 'No active landlord flow.');
      return;
    }

    const { type } = raw;

    console.log({ type });

    if (type === 'add_tenant') {
      await this.handleAddTenantText(from, text);
    } else if (['tenancy', 'maintenance'].includes(type)) {
      await this.handleLookupText(from, text);
    } else {
      await this.whatsappUtil.sendText(
        from,
        'Invalid state. Please try again.',
      );
    }
  }

  /**
   * Handle landlord INTERACTIVE button clicks
   */
  async handleInteractive(message: any, from: string) {
    const buttonReply = message.interactive?.button_reply;
    if (!buttonReply) return;

    const handlers: Record<string, () => Promise<void>> = {
      view_tenancies: () => this.handleViewTenancies(from),
      view_maintenance: () => this.handleViewMaintenance(from),
      new_tenant: () => this.startAddTenantFlow(from),
    };

    const handler = handlers[buttonReply.id];
    if (handler) {
      await handler();
    } else {
      await this.handleFallback(from, buttonReply.id);
    }
  }

  // ------------------------
  // TEXT flow pieces
  // ------------------------

  async handleAddTenantText(from: string, text: string) {
    const stateRaw = await this.cache.get(
      `service_request_state_landlord_${from}`,
    );
    if (!stateRaw) {
      await this.whatsappUtil.sendText(
        from,
        'No active tenant flow. Please try again.',
      );
      return;
    }

    const state = stateRaw;
    const { step, data } = state;

    switch (step) {
      case 'ask_name':
        data.full_name = text.trim();
        await this.whatsappUtil.sendText(
          from,
          '📱 What is the tenant’s phone number?',
        );
        await this.cache.set(
          `service_request_state_landlord_${from}`,
          JSON.stringify({ type: 'add_tenant', step: 'ask_phone', data }),
          300,
        );
        break;

      case 'ask_phone':
        data.phone = text.trim();
        await this.whatsappUtil.sendText(
          from,
          "✉️ What is your tenant's email",
        );
        await this.cache.set(
          `service_request_state_landlord_${from}`,
          JSON.stringify({ type: 'add_tenant', step: 'ask_email', data }),
          300,
        );
        break;

      case 'ask_email':
        if (text.toLowerCase() !== 'skip') {
          data.email = text.trim();
        }

        // ✅ Fetch landlord with properties
        const ownerUser = await this.usersRepo.findOne({
          where: { phone_number: `${from}`, role: RolesEnum.LANDLORD },
          relations: ['accounts', 'accounts.properties'],
        });

        if (!ownerUser) {
          await this.whatsappUtil.sendText(
            from,
            'No properties found for your account.',
          );
          return;
        }

        const properties = await this.propertyRepo.find({
          where: { owner_id: ownerUser.accounts[0].id },
          relations: ['property_tenants', 'property_tenants.tenant'],
        });

        if (!properties.length) {
          await this.whatsappUtil.sendText(
            from,
            'You don’t have any properties yet.',
          );
          return;
        }

        let propertyList = '🏘️ Which unit will this tenant occupy?\n';
        let vacantUnitsList: any[] = [];

        for (const property of properties) {
          // 🔍 Check if any tenant has ACTIVE status
          const hasActiveTenant = property.property_tenants?.some(
            (pt) => pt.status === TenantStatusEnum.ACTIVE,
          );

          if (!hasActiveTenant) {
            vacantUnitsList.push({
              id: property.id,
              name: property.name,
            });
            propertyList += `${vacantUnitsList.length}. ${property.name} (Vacant)\n`;
          }
        }

        if (!vacantUnitsList.length) {
          await this.whatsappUtil.sendText(from, 'No vacant units available.');
          return;
        }

        await this.whatsappUtil.sendText(
          from,
          propertyList +
            '\nReply with the number for the unit this tenant will occupy.',
        );

        await this.cache.set(
          `service_request_state_landlord_${from}`,
          JSON.stringify({
            type: 'add_tenant',
            step: 'select_unit',
            data: { ...data, vacantUnits: vacantUnitsList },
          }),
          300,
        );
        break;

      case 'select_unit':
        const choice = parseInt(text.trim(), 10);
        const vacantUnits = data.vacantUnits;

        if (isNaN(choice) || choice < 1 || choice > vacantUnits.length) {
          await this.whatsappUtil.sendText(
            from,
            'Invalid choice. Please reply with a valid number.',
          );
          return;
        }

        const unit = vacantUnits[choice - 1];
        data.selectedUnit = unit;

        await this.whatsappUtil.sendText(
          from,
          `💵 What is the *annual rental price* for ${unit.name}? (in NGN)`,
        );

        await this.cache.set(
          `service_request_state_landlord_${from}`,
          JSON.stringify({
            type: 'add_tenant',
            step: 'ask_rent',
            data,
          }),
          300,
        );
        break;

      case 'ask_rent':
        const rentAmount = parseInt(text.trim(), 10);
        if (isNaN(rentAmount) || rentAmount <= 0) {
          await this.whatsappUtil.sendText(
            from,
            'Please enter a valid rent amount.',
          );
          return;
        }
        data.rental_price = rentAmount;

        await this.whatsappUtil.sendText(
          from,
          '📅 What is the *lease duration*? (in months, e.g. 12)',
        );

        await this.cache.set(
          `service_request_state_landlord_${from}`,
          JSON.stringify({
            type: 'add_tenant',
            step: 'ask_duration',
            data,
          }),
          300,
        );
        break;

      case 'ask_duration':
        const duration = parseInt(text.trim(), 10);
        if (isNaN(duration) || duration <= 0) {
          await this.whatsappUtil.sendText(
            from,
            'Please enter a valid number of months.',
          );
          return;
        }
        data.lease_duration_months = duration;

        // ✅ Compute lease dates
        const lease_start_date = new Date();
        const lease_end_date = new Date(lease_start_date);
        lease_end_date.setMonth(lease_start_date.getMonth() + duration);

        // ✅ Create User, Account, PropertyTenant, and Rent
        const [first_name, ...last_name_parts] = data.full_name.split(' ');
        const last_name = last_name_parts.join(' ') || '';

        const newUser = this.usersRepo.create({
          first_name,
          last_name,
          phone_number: UtilService.normalizePhoneNumber(data.phone),
          email: data.email || null,
          is_verified: true,
        });
        await this.usersRepo.save(newUser);

        const newAccount = this.accountRepo.create({
          email: data.email || null,
          role: RolesEnum.TENANT,
          user: newUser,
          userId: newUser.id,
          is_verified: true,
          password: await UtilService.generatePassword(),
        });
        await this.accountRepo.save(newAccount);

        const propertyTenant = this.propertyTenantRepo.create({
          property_id: data.selectedUnit.id,
          tenant: newAccount,
          status: TenantStatusEnum.ACTIVE,
        });
        await this.propertyTenantRepo.save(propertyTenant);
        console.log(lease_start_date, lease_end_date)

        const rent = this.rentRepo.create({
          property_id: data.selectedUnit.id,
          tenant_id: newAccount.id,
          rental_price: data.rental_price,
          lease_start_date,
          lease_end_date,
          payment_status: RentPaymentStatusEnum.PAID,
          rent_status: RentStatusEnum.ACTIVE,
          amount_paid: 0,
        });
        await this.rentRepo.save(rent);

        await this.whatsappUtil.sendText(
          from,
          `✅ Tenant *${data.full_name}* has been added to ${data.selectedUnit.name}.
    
💵 Rent: NGN ${data.rental_price}
📅 Lease: ${lease_start_date.toDateString()} → ${lease_end_date.toDateString()}
`,
        );

        await this.cache.delete(`service_request_state_landlord_${from}`);
        break;
    }
  }

  private async handleLookupText(from: string, text: string) {
    await this.lookup.handleLookup(from, `${text}`);
  }

  async handleExitOrMenu(from: string, text: string) {
    if (text.toLowerCase() === 'done') {
      await this.whatsappUtil.sendText(
        from,
        'Thanks! You’ve exited landlord flow.',
      );
      await this.cache.delete(`service_request_state_landlord_${from}`);
    } else {
      const ownerUser = await this.usersRepo.findOne({
        where: { phone_number: `${from}`, role: RolesEnum.LANDLORD },
        relations: ['accounts'],
      });

      await this.whatsappUtil.sendButtons(
        from,
        `Hello ${ownerUser?.accounts[0].profile_name}, What do you want to do today?`,
        [
          { id: 'view_tenancies', title: 'View tenancies' },
          { id: 'view_maintenance', title: 'maintenance requests' },
          { id: 'new_tenant', title: 'Add new tenant' },
        ],
      );
      return;
    }
  }

  // ------------------------
  // INTERACTIVE flow pieces
  // ------------------------

  private async handleViewTenancies(from: string) {
    const ownerUser = await this.usersRepo.findOne({
      where: { phone_number: `${from}`, role: RolesEnum.LANDLORD },
      relations: ['accounts'],
    });

    if (!ownerUser) {
      await this.whatsappUtil.sendText(from, 'No tenancy info available.');
      return;
    }

 const propertyTenants = await this.propertyTenantRepo
  .createQueryBuilder('pt')
  .leftJoinAndSelect('pt.property', 'property')
  .leftJoinAndSelect('pt.tenant', 'tenant')
  .leftJoinAndSelect('tenant.user', 'user')
  .leftJoinAndSelect(
    qb =>
      qb
        .from('rent', 'r')
        .select('r.*')
        .distinctOn(['r.property_id'])
        .orderBy('r.property_id')
        .addOrderBy('r.lease_end_date', 'DESC'),
    'latest_rent',
    'latest_rent.property_id = property.id'
  )
  .where('property.owner_id = :ownerId', { ownerId: ownerUser.accounts[0].id })
  .orderBy('latest_rent.lease_end_date', 'ASC')
  .getMany();

  console.log(propertyTenants)


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
        : 'N/A';

      const dueDate = latestRent?.lease_end_date
        ? new Date(latestRent.lease_end_date).toLocaleDateString('en-NG', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })
        : 'N/A';

      tenancyMessage += `${i + 1}. ${pt.property.name}\n${tenantName}\n${rentAmount}/yr\nNext rent due: ${dueDate}\n\n`;
    }

    await this.whatsappUtil.sendText(from, tenancyMessage);
    await this.whatsappUtil.sendText(
      from,
      'Reply with the number of the tenancy you want to view (e.g., 1 for first property).',
    );

    await this.cache.set(
      `service_request_state_landlord_${from}`,
      JSON.stringify({
        type: 'tenancy',
        ids: propertyTenants.map((pt) => pt.id),
        step: 'no_step',
        data: {},
      }),
      300,
    );
  }

  private async handleViewMaintenance(from: string) {
    const ownerUser = await this.usersRepo.findOne({
      where: { phone_number: `${from}`, role: RolesEnum.LANDLORD },
      relations: ['accounts'],
    });

    if (!ownerUser) {
      await this.whatsappUtil.sendText(from, 'No maintenance info available.');
      return;
    }

    const serviceRequests = await this.serviceRequestRepo.find({
      where: { property: { owner_id: ownerUser.accounts[0].id } },
      relations: [
        'property',
        'tenant',
        'tenant.user',
        'facilityManager',
        'notification',
      ],
      order: { date_reported: 'DESC' },
    });

    if (!serviceRequests?.length) {
      await this.whatsappUtil.sendText(from, 'No maintenance requests found.');
      return;
    }

    let maintenanceMessage = 'Here are open maintenance requests:\n';
    for (const [i, req] of serviceRequests.entries()) {
      const reportedDate = new Date(req.date_reported).toLocaleDateString(
        'en-NG',
        {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        },
      );

      maintenanceMessage += `${i + 1}. ${req.property_name}\n${req.issue_category}\nReported ${reportedDate}\nStatus: ${req.status}\n\n`;
    }

    await this.whatsappUtil.sendText(from, maintenanceMessage);
    await this.whatsappUtil.sendText(
      from,
      'Reply with the number of the request you want to view.',
    );

    await this.cache.set(
      `service_request_state_landlord_${from}`,
      JSON.stringify({
        type: 'maintenance',
        ids: serviceRequests.map((req) => req.id),
        step: 'no_step',
        data: {},
      }),
      300,
    );
  }

  private async startAddTenantFlow(from: string) {
    await this.whatsappUtil.sendText(from, 'Starting tenant onboarding...');
    await this.whatsappUtil.sendText(from, "whats your tenant's full name");
    await this.cache.set(
      `service_request_state_landlord_${from}`,
      JSON.stringify({
        type: 'add_tenant',
        step: 'ask_name',
        data: {},
      }),
      300,
    );
  }

  private async handleFallback(from: string, id: string) {
    await this.whatsappUtil.sendText(
      from,
      `Got it! You selected ${id}. Before we connect you with our team, may we have your full name?`,
    );
    await this.cache.set(
      `service_request_state_default_${from}`,
      `property_owner_options_${id}`,
      300,
    );
  }
}
