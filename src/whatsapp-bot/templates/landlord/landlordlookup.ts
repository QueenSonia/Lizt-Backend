import { ConfigService } from '@nestjs/config';
import { RolesEnum } from 'src/base.entity';
import { CacheService } from 'src/lib/cache';
import { Property } from 'src/properties/entities/property.entity';
import { Account } from 'src/users/entities/account.entity';
import { Users } from 'src/users/entities/user.entity';
import { UtilService } from 'src/utils/utility-service';
import { WhatsappUtils } from 'src/whatsapp-bot/utils/whatsapp';
import { Repository } from 'typeorm/repository/Repository';
import { KYCLinksService } from 'src/kyc-links/kyc-links.service';

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
    private readonly utilService: UtilService,
    private readonly kycLinksService: KYCLinksService,
  ) {
    const config = new ConfigService();
    this.whatsappUtil = new WhatsappUtils(config);
  }

  private key(from: string) {
    return `service_request_state_landlord_${from}`;
  }

  async handleGenerateKYCLinkText(from: string, text: string) {
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

    if (step === 'select_property') {
      const choice = parseInt(text.trim(), 10);
      const properties = data.properties;

      if (isNaN(choice) || choice < 1 || choice > properties.length) {
        await this.whatsappUtil.sendText(
          from,
          'Invalid choice. Please reply with a valid number.',
        );
        return;
      }

      const selectedProperty = properties[choice - 1];

      try {
        // Get landlord account
        const ownerUser = await this.usersRepo.findOne({
          where: { phone_number: `${from}`, role: RolesEnum.LANDLORD },
          relations: ['accounts'],
        });

        if (!ownerUser?.accounts?.[0]) {
          await this.whatsappUtil.sendText(
            from,
            'Account not found. Please try again.',
          );
          await this.cache.delete(`service_request_state_landlord_${from}`);
          return;
        }

        // Generate KYC link
        const kycLinkResponse = await this.kycLinksService.generateKYCLink(
          selectedProperty.id,
          ownerUser.accounts[0].id,
        );

        const baseUrl = process.env.FRONTEND_URL || 'https://www.lizt.co';
        const kycLink = `${baseUrl}/kyc/${kycLinkResponse.token}`;

        await this.whatsappUtil.sendText(
          from,
          `✅ KYC link generated for *${selectedProperty.name}*\n\n🔗 ${kycLink}\n\nShare this link with potential tenants to complete their application.`,
        );

        await this.cache.delete(`service_request_state_landlord_${from}`);
      } catch (error) {
        console.error('Error generating KYC link:', error);
        await this.whatsappUtil.sendText(
          from,
          'Failed to generate KYC link. Please try again or contact support.',
        );
        await this.cache.delete(`service_request_state_landlord_${from}`);
      }
    }
  }

  async handleExitOrMenu(from: string, text: string) {
    if (text.toLowerCase() === 'done') {
      await this.whatsappUtil.sendText(
        from,
        'Thanks! You have exited landlord flow.',
      );
      await this.cache.delete(`service_request_state_landlord_${from}`);
    } else {
      const ownerUser = await this.usersRepo.findOne({
        where: { phone_number: `${from}`, role: RolesEnum.LANDLORD },
        relations: ['accounts'],
      });

      await this.whatsappUtil.sendButtons(
        from,
        `Hello ${ownerUser?.accounts[0]?.profile_name || 'there'}, What do you want to do today?`,
        [
          { id: 'view_properties', title: 'View properties' },
          { id: 'view_maintenance', title: 'Maintenance requests' },
          { id: 'generate_kyc_link', title: 'Generate KYC link' },
        ],
      );
      return;
    }
  }

  async startGenerateKYCLinkFlow(from: string) {
    const ownerUser = await this.usersRepo.findOne({
      where: { phone_number: `${from}`, role: RolesEnum.LANDLORD },
      relations: ['accounts'],
    });

    if (!ownerUser?.accounts?.[0]) {
      await this.whatsappUtil.sendText(
        from,
        'Account not found. Please try again.',
      );
      return;
    }

    // Fetch all properties for this landlord
    const properties = await this.propertyRepo.find({
      where: { owner_id: ownerUser.accounts[0].id },
    });

    if (!properties.length) {
      await this.whatsappUtil.sendText(
        from,
        'You do not have any properties yet. Please add properties on the web app first.',
      );
      return;
    }

    // Build property list message
    let message = '🏘️ Select a property to generate KYC link:\n\n';
    const propertyList = properties.map((p, index) => ({
      id: p.id,
      name: p.name,
    }));

    propertyList.forEach((p, index) => {
      message += `${index + 1}. ${p.name}\n`;
    });

    message += '\nReply with the number of the property.';

    await this.whatsappUtil.sendText(from, message);

    // Cache state for next step
    await this.cache.set(
      `service_request_state_landlord_${from}`,
      JSON.stringify({
        type: 'generate_kyc_link',
        step: 'select_property',
        data: { properties: propertyList },
      }),
      this.SESSION_TIMEOUT_MS,
    );
  }
}
