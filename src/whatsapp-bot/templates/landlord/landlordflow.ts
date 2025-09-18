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
import { PropertyStatusEnum, TenantStatusEnum } from 'src/properties/dto/create-property.dto';
import { UtilService } from 'src/utils/utility-service';
import {
  RentPaymentStatusEnum,
  RentStatusEnum,
} from 'src/rents/dto/create-rent.dto';
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
      propertyRepo,
      serviceRequestRepo,
      usersRepo,
      rentRepo,
      accountRepo
    );
  }

  /**
   * Handle landlord TEXT input
   */
  async handleText(from: string, text: string) {
    if (['done', 'menu'].includes(text?.toLowerCase())) {
      await this.lookup.handleExitOrMenu(from, text);
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
      await this.lookup.handleAddTenantText(from, text);
    } else if (['tenancy', 'maintenance', 'property_action'].includes(type)) {
       await this.lookup.handleLookup(from, `${text}`);
    } else {
      // await this.whatsappUtil.sendText(
      //   from,
      //   'Invalid state. Please try again.',
      // );
       await this.lookup.handleExitOrMenu(from, text);
    }
  }

  /**
   * Handle landlord INTERACTIVE button clicks
   */
  async handleInteractive(message: any, from: string) {
    const buttonReply = message.interactive?.button_reply;
    if (!buttonReply) return;

    const handlers: Record<string, () => Promise<void>> = {
      view_properties: () => this.lookup.handleViewProperties(from),
      view_vacant: () => this.lookup.handleVacantProperties(from),
      view_occupied: () => this.lookup.handleOccupiedProperties(from),
      view_maintenance: () => this.lookup.handleViewMaintenance(from),
      new_tenant: () => this.lookup.startAddTenantFlow(from),
    };

    const handler = handlers[buttonReply.id];
    if (handler) {
      await handler();
    } 
  }

  // ------------------------
  // TEXT flow pieces
  // ------------------------

}
