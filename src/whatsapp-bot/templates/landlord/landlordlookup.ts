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
import { Not, IsNull } from 'typeorm';
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
    // Since we now generate general links immediately, this method just handles exit/menu
    await this.handleExitOrMenu(from, text);
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

    // Fetch all vacant and ready for marketing properties
    const properties = await this.propertyRepo.find({
      where: [
        {
          owner_id: ownerUser.accounts[0].id,
          property_status: PropertyStatusEnum.VACANT,
        },
        {
          owner_id: ownerUser.accounts[0].id,
          property_status: PropertyStatusEnum.READY_FOR_MARKETING,
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
}
