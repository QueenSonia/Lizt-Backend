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
import {
  PropertyStatusEnum,
  TenantStatusEnum,
} from 'src/properties/dto/create-property.dto';
import { UtilService } from 'src/utils/utility-service';
import {
  RentPaymentStatusEnum,
  RentStatusEnum,
} from 'src/rents/dto/create-rent.dto';
import { Rent } from 'src/rents/entities/rent.entity';
import { KYCLinksService } from 'src/kyc-links/kyc-links.service';

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
    private readonly utilService: UtilService,
    private readonly kycLinksService: KYCLinksService,
  ) {
    const config = new ConfigService();
    this.whatsappUtil = new WhatsappUtils(config);
    this.lookup = new LandlordLookup(
      cache,
      propertyRepo,
      usersRepo,
      accountRepo,
      utilService,
      kycLinksService,
    );
  }

  /**
   * Handle landlord TEXT input
   */
  async handleText(from: string, text: string) {
    // Handle "switch role" command for multi-role users
    if (
      text?.toLowerCase() === 'switch role' ||
      text?.toLowerCase() === 'switch'
    ) {
      await this.cache.delete(`selected_role_${from}`);
      await this.whatsappUtil.sendText(
        from,
        'Role cleared. Send any message to select a new role.',
      );
      return;
    }

    if (['done', 'menu'].includes(text?.toLowerCase())) {
      await this.lookup.handleExitOrMenu(from, text);
      return;
    }

    const raw = await this.cache.get(`service_request_state_landlord_${from}`);
    if (!raw) {
      await this.lookup.handleExitOrMenu(from, text);
      return;
    }

    const { type } = raw;

    console.log({ type });

    if (type === 'generate_kyc_link') {
      await this.lookup.handleGenerateKYCLinkText(from, text);
    } else {
      await this.lookup.handleExitOrMenu(from, text);
    }
  }

  /**
   * Handle landlord INTERACTIVE button clicks
   */
  async handleInteractive(message: any, from: string) {
    // Handle both interactive button_reply and direct button formats
    const buttonReply = message.interactive?.button_reply || message.button;
    const buttonId = buttonReply?.id || buttonReply?.payload;

    console.log('🔘 Landlord Button clicked:', {
      messageType: message.type,
      buttonReply,
      buttonId,
      from,
    });

    if (!buttonReply || !buttonId) {
      console.log('❌ No button reply found in message');
      return;
    }

    const handlers: Record<string, () => Promise<void>> = {
      view_properties: () =>
        this.whatsappUtil.sendText(
          from,
          '🏠 View your properties here: https://www.lizt.co/landlord/properties',
        ),
      view_maintenance: () =>
        this.whatsappUtil.sendText(
          from,
          '🛠️ View maintenance requests here: https://www.lizt.co/landlord/service-requests',
        ),
      view_all_service_requests: () =>
        this.whatsappUtil.sendText(
          from,
          '🛠️ View maintenance requests here: https://www.lizt.co/landlord/service-requests',
        ),
      generate_kyc_link: () => this.lookup.startGenerateKYCLinkFlow(from),
    };

    const handler = handlers[buttonId];
    console.log('🔍 Handler lookup:', {
      buttonId: buttonId,
      handlerFound: !!handler,
      availableHandlers: Object.keys(handlers),
    });

    if (handler) {
      console.log('✅ Executing handler for:', buttonId);
      await handler();
    } else {
      console.log('❌ No handler found for button:', buttonId);
    }
  }

  // ------------------------
  // TEXT flow pieces
  // ------------------------
}
