import { ConfigService } from '@nestjs/config';
import { RolesEnum } from 'src/base.entity';
import { CacheService } from 'src/lib/cache';
import {
  PropertyStatusEnum,
  TenantStatusEnum,
} from 'src/properties/dto/create-property.dto';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { Property } from 'src/properties/entities/property.entity';
import {
  RentPaymentStatusEnum,
  RentStatusEnum,
} from 'src/rents/dto/create-rent.dto';
import { Rent } from 'src/rents/entities/rent.entity';
import { ServiceRequest } from 'src/service-requests/entities/service-request.entity';
import { Account } from 'src/users/entities/account.entity';
import { Users } from 'src/users/entities/user.entity';
import { UtilService } from 'src/utils/utility-service';
import { WhatsappUtils } from 'src/whatsapp-bot/utils/whatsapp';
import { Repository } from 'typeorm/repository/Repository';

// --- landlordLookup.ts ---
export class LandlordLookup {
  private whatsappUtil: WhatsappUtils;

  // ✅ Define timeout in milliseconds
  private readonly SESSION_TIMEOUT_MS = 5 * 60 * 1000;

  constructor(
    private cache: CacheService,
    private propertyTenantRepo: Repository<PropertyTenant>,
    private propertyRepo: Repository<Property>,
    private serviceRequestRepo: Repository<ServiceRequest>,
    private readonly usersRepo: Repository<Users>,
    private readonly rentRepo: Repository<Rent>,
    private readonly accountRepo: Repository<Account>,
    private readonly utilService: UtilService,
  ) {
    const config = new ConfigService();
    this.whatsappUtil = new WhatsappUtils(config);
  }

  private key(from: string) {
    return `service_request_state_landlord_${from}`;
  }

  async handleAddTenantText(from: string, text: string) {
    const stateRaw = await this.cache.get(
      `service_request_state_landlord_${from}`,
    );
    if (!stateRaw) {
      await this.whatsappUtil.sendText(
        from,
        '⏱️ Your session has expired. Type "menu" to start over.',
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
          this.SESSION_TIMEOUT_MS, // now in ms
        );
        break;

      case 'ask_phone':
        data.phone = text.trim();
        await this.whatsappUtil.sendText(
          from,
          "✉️ What is your tenant's email (or type 'skip')",
        );
        await this.cache.set(
          `service_request_state_landlord_${from}`,
          JSON.stringify({ type: 'add_tenant', step: 'ask_email', data }),
          this.SESSION_TIMEOUT_MS, // now in ms
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
        const vacantUnitsList: any[] = [];

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
          this.SESSION_TIMEOUT_MS, // now in ms
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
          this.SESSION_TIMEOUT_MS, // now in ms
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
          this.SESSION_TIMEOUT_MS, // now in ms
        );
        break;

      case 'ask_duration': {
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

        const property = await this.propertyRepo.findOne({
          where: { id: data.selectedUnit.id },
        });
        if (!property) {
          return;
        }

        property.property_status = PropertyStatusEnum.OCCUPIED;

        await this.propertyRepo.save(property);

        const newUser = this.usersRepo.create({
          first_name: this.utilService.toSentenceCase(first_name),
          last_name: this.utilService.toSentenceCase(last_name),
          phone_number: this.utilService.normalizePhoneNumber(data.phone),
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
          password: await this.utilService.generatePassword(),
        });
        await this.accountRepo.save(newAccount);

        const propertyTenant = this.propertyTenantRepo.create({
          property_id: data.selectedUnit.id,
          tenant: newAccount,
          status: TenantStatusEnum.ACTIVE,
        });
        await this.propertyTenantRepo.save(propertyTenant);
        console.log(lease_start_date, lease_end_date);

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
  }

  async handleLookup(from: string, text: string) {
    const raw = await this.cache.get(this.key(from));
    if (!raw) {
      await this.whatsappUtil.sendText(
        from,
        'No cached selection found. Please try again.',
      );
      return;
    }

    let parsed: {
      type: 'tenancy' | 'maintenance' | 'property_action';
      ids?: string[];
      step: string;
      tenancyId?: string;
      occupied?: boolean;
    };

    try {
      parsed = raw;
    } catch (err) {
      await this.whatsappUtil.sendText(
        from,
        'Something went wrong. Please try again.',
      );
      return;
    }

    console.log(raw);
    const choice = parseInt(text.trim(), 10);
    console.log({ choice });
    if (isNaN(choice)) {
      await this.whatsappUtil.sendText(
        from,
        'Invalid choice. Please reply with a valid number.',
      );
      await this.cache.delete(`service_request_state_landlord_${from}`);
      return;
    }

    // === 1. User is choosing from the tenancy list ===
    if (parsed.type === 'tenancy' && parsed.step === 'no_step') {
      if (!parsed.ids?.length || choice < 1 || choice > parsed.ids.length) {
        await this.whatsappUtil.sendText(
          from,
          'Invalid choice. Please reply with a valid number.',
        );
        return;
      }
      const selectedId = parsed.ids[choice - 1];
      console.log(selectedId);
      await this.handlePropertySelection(from, selectedId);
      return;
    }

    // === 2. User is choosing from property action menu ===
    if (
      parsed.type === 'property_action' &&
      parsed.step === 'awaiting_action'
    ) {
      if (parsed.occupied) {
        switch (choice) {
          case 1:
            await this.showTenancyDetails(from, parsed.tenancyId!);
            break;
          case 2:
            await this.showMaintenanceList(from, parsed.tenancyId!);
            break;
          case 3:
            await this.startAddTenantFlow(from);
            break;
          default:
            await this.whatsappUtil.sendText(
              from,
              'Invalid choice. Reply 1, 2, or 3.',
            );
        }
      } else {
        switch (choice) {
          case 1:
            await this.startAddTenantFlow(from);
            break;
          case 2:
            await this.showMaintenanceList(from, parsed.tenancyId!);
            break;
          default:
            await this.whatsappUtil.sendText(
              from,
              'Invalid choice. Reply 1 or 2.',
            );
        }
      }
      return;
    }

    // === 3. User is choosing a maintenance request ===
    if (parsed.type === 'maintenance' && parsed.step === 'no_step') {
      if (!parsed.ids?.length || choice < 1 || choice > parsed.ids.length) {
        await this.whatsappUtil.sendText(
          from,
          'Invalid choice. Please reply with a valid number.',
        );
        return;
      }
      const selectedId = parsed.ids[choice - 1];
      await this.showMaintenanceDetails(from, selectedId);
      return;
    }

    await this.whatsappUtil.sendText(
      from,
      'No active lookup. Please try again.',
    );
  }

  private async handlePropertySelection(from: string, propertyId: string) {
    const property = await this.propertyRepo.findOne({
      where: { id: propertyId },
      relations: ['property_tenants', 'property_tenants.tenant.user'],
    });

    if (!property) {
      await this.whatsappUtil.sendText(from, 'property not found');
      return;
    }

    const tenancy = property.property_tenants?.find(
      (pt) => pt.status === TenantStatusEnum.ACTIVE,
    );

    if (!tenancy) {
      // Vacant Property Menu
      await this.whatsappUtil.sendText(
        from,
        `You selected ${property.name} (Vacant). What would you like to do?\n
1. Add a New Tenant`,
      );

      await this.cache.set(
        this.key(from),
        JSON.stringify({
          type: 'property_action',
          tenancyId: property.id,
          occupied: false,
          step: 'awaiting_action',
        }),
        this.SESSION_TIMEOUT_MS, // now in ms
      );
    }

    console.log({ tenancy });

    const tenantName = tenancy?.tenant?.user
      ? `${tenancy.tenant.user.first_name} ${tenancy.tenant.user.last_name}`
      : null;

    if (tenantName) {
      // Occupied Property Menu
      await this.whatsappUtil.sendText(
        from,
        `You selected ${property.name} (Occupied by ${tenantName}). What would you like to do?\n
1. View Tenancy Details
2. View Maintenance Requests
`,
      );

      await this.cache.set(
        this.key(from),
        JSON.stringify({
          type: 'property_action',
          tenancyId: tenancy?.id,
          occupied: true,
          step: 'awaiting_action',
        }),
        this.SESSION_TIMEOUT_MS, // now in ms
      );
    }
  }

  private async showTenancyDetails(from: string, tenancyId: string) {
    const tenancy = await this.propertyTenantRepo.findOne({
      where: { id: tenancyId },
      relations: ['property', 'property.rents', 'tenant', 'tenant.user'],
    });

    if (!tenancy) {
      await this.whatsappUtil.sendText(from, 'Tenancy not found.');
      return;
    }

    const latestRent = tenancy.property.rents?.at(-1) || null;
    const tenantName = tenancy.tenant?.user
      ? `${tenancy.tenant.user.first_name} ${tenancy.tenant.user.last_name}`
      : 'Vacant';

    const paymentHistory =
      tenancy.property.rents
        ?.map(
          (r) =>
            `${new Date(r.lease_start_date).toLocaleDateString()} - ${r.amount_paid?.toLocaleString(
              'en-NG',
              { style: 'currency', currency: 'NGN' },
            )} (${r.payment_status})`,
        )
        .join('\n') || 'No payments yet';

    const details = `
🏠 Property: ${tenancy.property.name}
👤 Tenant: ${tenantName}
💵 Rent: ${latestRent?.rental_price?.toLocaleString('en-NG', {
      style: 'currency',
      currency: 'NGN',
    })}/yr
📅 Lease: ${latestRent?.lease_start_date?.toLocaleDateString()} → ${latestRent?.lease_end_date?.toLocaleDateString()}
⚖️ Outstanding: ${latestRent?.payment_status === 'OWING' ? 'Yes' : 'No'}

📜 Payment History:
${paymentHistory}
    `;

    await this.whatsappUtil.sendText(from, details);
  }

  private async showMaintenanceList(from: string, tenancyId: string) {
    const tenancy = await this.propertyTenantRepo.findOne({
      where: { id: tenancyId },
      relations: ['property'],
    });

    if (!tenancy) {
      await this.whatsappUtil.sendText(from, 'Property not found.');
      return;
    }

    const requests = await this.serviceRequestRepo.find({
      where: { property_id: tenancy.property.id },
      order: { created_at: 'DESC' },
    });

    if (!requests?.length) {
      await this.whatsappUtil.sendText(
        from,
        `No maintenance requests for ${tenancy.property.name}.`,
      );
      return;
    }

    let message = `🛠 Maintenance Requests for ${tenancy.property.name}:\n`;
    requests.forEach((r, i) => {
      message += `${i + 1}. ${r.issue_category}\n${r.description}\n${r.status}\n`;
    });

    await this.whatsappUtil.sendText(from, message);
    await this.whatsappUtil.sendText(
      from,
      'Reply with the number of the request you want to view.',
    );

    await this.cache.set(
      this.key(from),
      JSON.stringify({
        type: 'maintenance',
        ids: requests.map((r) => r.id),
        step: 'no_step',
      }),
      this.SESSION_TIMEOUT_MS, // now in ms
    );
  }

  private async showMaintenanceDetails(from: string, requestId: string) {
    const maintenance = await this.serviceRequestRepo.findOne({
      where: { id: requestId },
      relations: [
        'property',
        'tenant',
        'tenant.user',
        'facilityManager',
        'notification',
      ],
    });

    if (!maintenance) {
      await this.whatsappUtil.sendText(from, 'Maintenance request not found.');
      return;
    }

    const reportedDate = new Date(maintenance.date_reported).toLocaleDateString(
      'en-NG',
      {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      },
    );

    const tenantName = maintenance.tenant?.user
      ? `${maintenance.tenant.user.first_name} ${maintenance.tenant.user.last_name}`
      : 'Unknown';

    const details = `
🛠️ Maintenance Request
🏠 Property: ${maintenance.property?.name}
👤 Tenant: ${tenantName}
📅 Reported: ${reportedDate}
📂 Category: ${maintenance.issue_category}
📌 Status: ${maintenance.status}
🔧 Facility Manager: ${maintenance.facilityManager?.account.profile_name || '——'}
    `;

    await this.whatsappUtil.sendText(from, details);
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
          { id: 'view_properties', title: 'View properties' },
          { id: 'view_maintenance', title: 'maintenance requests' },
          { id: 'new_tenant', title: 'Add new tenant' },
        ],
      );
      return;
    }
  }

  async handleViewProperties(from: string) {
    await this.whatsappUtil.sendButtons(from, `Property Menu`, [
      { id: 'view_vacant', title: 'Vacant' },
      { id: 'view_occupied', title: 'Occupied ' },
    ]);
    return;
  }

  async handleVacantProperties(from: string) {
    const ownerUser = await this.usersRepo.findOne({
      where: { phone_number: `${from}`, role: RolesEnum.LANDLORD },
      relations: ['accounts'],
    });

    if (!ownerUser) {
      await this.whatsappUtil.sendText(from, 'No property info available.');
      return;
    }

    // Fetch all properties with tenants and rents
    const properties = await this.propertyRepo.find({
      where: {
        owner_id: ownerUser.accounts[0].id,
        property_status: PropertyStatusEnum.VACANT,
      },
      relations: [
        'property_tenants',
        'property_tenants.tenant',
        'property_tenants.tenant.user',
        'rents',
      ],
    });

    if (!properties.length) {
      await this.whatsappUtil.sendText(
        from,
        'You don’t have any properties yet.',
      );
      return;
    }

    // Build property list message
    let message = 'Here are your vacant properties:\n';
    const propertyIds: string[] = [];

    for (const [i, property] of properties.entries()) {
      const activeTenant = property.property_tenants?.find(
        (pt) => pt.status === TenantStatusEnum.ACTIVE,
      );

      const tenantName = activeTenant?.tenant?.user
        ? `${activeTenant.tenant.user.first_name} ${activeTenant.tenant.user.last_name}`
        : null;

      message += `${i + 1}. ${property.name} – ${
        tenantName ? `Occupied (Tenant: ${tenantName})` : 'Vacant'
      }\n`;

      propertyIds.push(property.id);
    }

    await this.whatsappUtil.sendText(
      from,
      message +
        '\nReply with the number of the property you want to assigned to a tenant.',
    );

    // Cache state for next step
    await this.cache.set(
      `service_request_state_landlord_${from}`,
      JSON.stringify({
        type: 'tenancy',
        step: 'no_step',
        ids: propertyIds,
        data: {},
      }),
      this.SESSION_TIMEOUT_MS, // now in ms,
    );
  }

  async handleOccupiedProperties(from: string) {
    const ownerUser = await this.usersRepo.findOne({
      where: { phone_number: `${from}`, role: RolesEnum.LANDLORD },
      relations: ['accounts'],
    });

    if (!ownerUser) {
      await this.whatsappUtil.sendText(from, 'No property info available.');
      return;
    }

    const properties = await this.propertyRepo.find({
      where: {
        owner_id: ownerUser.accounts[0].id,
        property_status: PropertyStatusEnum.OCCUPIED,
      },
      relations: [
        'property_tenants',
        'property_tenants.tenant',
        'property_tenants.tenant.user',
        'rents',
      ],
    });

    if (!properties.length) {
      await this.whatsappUtil.sendText(
        from,
        'You don’t have any occupied properties.',
      );
      return;
    }

    // Sort properties by active rent lease end date
    const sortedProperties = properties.sort((a, b) => {
      const aRent = a.rents?.find(
        (r) => r.rent_status === RentStatusEnum.ACTIVE,
      );
      const bRent = b.rents?.find(
        (r) => r.rent_status === RentStatusEnum.ACTIVE,
      );
      const aDate = aRent ? new Date(aRent.lease_end_date).getTime() : 0;
      const bDate = bRent ? new Date(bRent.lease_end_date).getTime() : 0;
      return aDate - bDate;
    });

    // Build WhatsApp-friendly message
    let message = `*Your Occupied Properties* (by lease end date):\n\n`;
    const propertyIds: string[] = [];

    sortedProperties.forEach((property, i) => {
      const activeTenant = property.property_tenants?.find(
        (pt) => pt.status === TenantStatusEnum.ACTIVE,
      );
      const tenantName = activeTenant?.tenant?.user
        ? `${activeTenant.tenant.user.first_name} ${activeTenant.tenant.user.last_name}`
        : 'Unknown tenant';

      const activeRent = property.rents?.find(
        (r) => r.rent_status === RentStatusEnum.ACTIVE,
      );
      const leaseEnd = activeRent
        ? new Date(activeRent.lease_end_date).toLocaleDateString('en-NG', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })
        : '——';

      const rentPrice = activeRent?.rental_price
        ? `₦${activeRent.rental_price.toLocaleString()}`
        : '——';

      // Adjusted: Removed payment_frequency since it doesn’t exist on Rent
      message += `*${i + 1}. ${property.name}*\n`;
      message += ` Tenant: ${tenantName}\n`;
      message += ` ${rentPrice}\n`;
      message += ` Lease Ends: ${leaseEnd}\n`;
      message += `───────────────────\n`;

      propertyIds.push(property.id);
    });

    await this.whatsappUtil.sendText(
      from,
      message + '\nReply with the number of the property you want to manage.',
    );

    await this.cache.set(
      `service_request_state_landlord_${from}`,
      JSON.stringify({
        type: 'tenancy',
        step: 'no_step',
        ids: propertyIds,
        data: {},
      }),
      this.SESSION_TIMEOUT_MS, // now in ms,
    );
  }

  async handleViewMaintenance(from: string) {
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
      relations: ['property', 'tenant', 'tenant.user', 'facilityManager'],
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
      this.SESSION_TIMEOUT_MS, // now in ms,
    );
  }

  async startAddTenantFlow(from: string) {
    await this.whatsappUtil.sendText(from, 'Starting tenant onboarding...');
    await this.whatsappUtil.sendText(from, "whats your tenant's full name");
    await this.cache.set(
      `service_request_state_landlord_${from}`,
      JSON.stringify({
        type: 'add_tenant',
        step: 'ask_name',
        data: {},
      }),
      this.SESSION_TIMEOUT_MS, // now in ms,
    );
  }
}
