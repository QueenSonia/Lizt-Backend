import { ConfigService } from '@nestjs/config';
import { RolesEnum } from 'src/base.entity';
import { CacheService } from 'src/lib/cache';
import { Property } from 'src/properties/entities/property.entity';
import { PropertyStatusEnum } from 'src/properties/dto/create-property.dto';
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

        // Generate or retrieve existing KYC link
        const kycLinkResponse = await this.kycLinksService.generateKYCLink(
          selectedProperty.id,
          ownerUser.accounts[0].id,
        );

        const baseUrl = process.env.FRONTEND_URL || 'https://www.lizt.co';
        const kycLink = `${baseUrl}/kyc/${kycLinkResponse.token}`;

        // No expiration date needed
        await this.whatsappUtil.sendText(
          from,
          `✅ KYC link for *${selectedProperty.name}*\n\n🔗 ${kycLink}\n\n🔄 This link remains active until the property is rented\n\nShare this link with potential tenants to complete their application.`,
        );

        await this.cache.delete(`service_request_state_landlord_${from}`);
      } catch (error) {
        console.error('Error generating KYC link:', error);

        // Extract meaningful error message
        let errorMessage =
          'Failed to generate KYC link. Please try again or contact support.';

        if (error.response?.message) {
          // Handle NestJS HttpException errors
          const message = error.response.message;
          if (message.includes('already has an active tenant')) {
            errorMessage = `❌ Cannot generate KYC link for *${selectedProperty.name}*\n\nThis property already has an active tenant. KYC links can only be generated for vacant properties.`;
          } else if (message.includes('not found')) {
            errorMessage = `❌ Property not found. Please try again.`;
          } else if (message.includes('not authorized')) {
            errorMessage = `❌ You are not authorized to generate a KYC link for this property.`;
          } else {
            errorMessage = `❌ ${message}`;
          }
        } else if (error.message) {
          // Handle generic errors
          errorMessage = `❌ ${error.message}`;
        }

        await this.whatsappUtil.sendText(from, errorMessage);
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

      const landlordName =
        ownerUser?.accounts[0]?.profile_name ||
        ownerUser?.first_name ||
        'there';

      // Use template with URL buttons for direct redirects
      await this.whatsappUtil.sendLandlordMainMenu(from, landlordName);
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

    // Fetch only vacant properties for this landlord
    const properties = await this.propertyRepo.find({
      where: {
        owner_id: ownerUser.accounts[0].id,
        property_status: PropertyStatusEnum.VACANT,
      },
    });

    if (!properties.length) {
      await this.whatsappUtil.sendText(
        from,
        '🏠 You do not have any vacant properties at the moment.\n\nKYC links can only be generated for vacant properties. Once a property becomes vacant, you can generate a KYC link for it.',
      );
      return;
    }

    // Build property list message
    let message = '🏘️ Select a vacant property to generate KYC link:\n\n';
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
