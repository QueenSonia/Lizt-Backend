import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  ForbiddenException,
  Req,
  Res,
  HttpCode,
  BadRequestException,
  Logger,
  Param,
  Request,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { FileUploadService } from 'src/utils/cloudinary';
import { ConfigService } from '@nestjs/config';
import { Request as ExpressRequest, Response } from 'express';

import { WhatsappBotService } from './whatsapp-bot.service';
import { CreateWhatsAppBotMessage } from './dto/create-whatsapp-bot-message.dto';
import { SkipAuth } from 'src/auth/auth.decorator';
import {
  decryptRequest,
  encryptResponse,
  FlowEndpointException,
  WhatsAppWebhookPayload,
} from './utils';
import { isRequestSignatureValid } from './utils/validate-request';
import { Public } from 'src/auth/public.decorator';
import { WebhookHandler } from './webhook-handler.service';
import { InjectRepository } from '@nestjs/typeorm';
import { ArrayContains, Repository, In, IsNull } from 'typeorm';
import { Account } from 'src/users/entities/account.entity';
import { Team } from 'src/users/entities/team.entity';
import { TeamMember } from 'src/users/entities/team-member.entity';
import { KYCApplication } from 'src/kyc-links/entities/kyc-application.entity';
import { UtilService } from 'src/utils/utility-service';
import { RolesEnum } from 'src/base.entity';

@Controller('whatsapp')
export class WhatsappBotController {
  private readonly logger = new Logger(WhatsappBotController.name);

  constructor(
    private readonly whatsappBotService: WhatsappBotService,
    private readonly config: ConfigService,
    private readonly webhookHandler: WebhookHandler,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(Team)
    private readonly teamRepository: Repository<Team>,
    @InjectRepository(TeamMember)
    private readonly teamMemberRepository: Repository<TeamMember>,
    @InjectRepository(KYCApplication)
    private readonly kycApplicationRepository: Repository<KYCApplication>,
    private readonly utilService: UtilService,
    private readonly fileUploadService: FileUploadService,
  ) {}

  @SkipAuth()
  @Get('webhook')
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    const verifyToken = this.config.get('WEBHOOK_VERIFICATION_TOKEN');
    console.log(
      `Webhook verification: mode=${mode}, token=${token}, challenge=${challenge}`,
    );

    if (mode === 'subscribe' && token === verifyToken) return challenge;

    throw new ForbiddenException();
  }

  @SkipAuth()
  @Post('webhook')
  async create(
    @Body() payload: WhatsAppWebhookPayload,
    @Req() req: ExpressRequest,
  ) {
    try {
      this.logger.log('Received webhook payload');

      // Check if this is a simulator message payload
      const isSimulatorPayload = this.isSimulatorPayload(payload);

      if (isSimulatorPayload) {
        this.logger.log('🎭 Processing simulator webhook payload');
      }

      // Enhanced error handling for unified architecture
      // Validates: Requirements 8.1, 8.2, 8.3, 8.4

      // For non-simulator messages, we could add signature validation here if needed
      // Currently, the webhook endpoint doesn't validate signatures for real WhatsApp messages either
      // This maintains backward compatibility while allowing simulator messages to bypass validation
      // Validates: Requirements 8.2, 8.3

      // Validate payload structure with enhanced error context
      // Validates: Requirements 5.5, 1.2, 1.4, 8.4
      if (!this.webhookHandler.validateWebhookPayload(payload)) {
        const errorContext = {
          isSimulatorPayload,
          payloadStructure: {
            hasEntry: !!payload?.entry,
            entryCount: payload?.entry?.length || 0,
            hasChanges: !!payload?.entry?.[0]?.changes,
            changesCount: payload?.entry?.[0]?.changes?.length || 0,
          },
          timestamp: new Date().toISOString(),
        };

        this.logger.warn('Received malformed webhook payload', errorContext);

        // Always return 2xx to Meta — a 4xx triggers retries and persistent
        // failures can disable the webhook subscription. Anything we can't
        // process is logged above and acknowledged here.
        return { received: true, processed: false };
      }

      // Process the webhook payload using the WebhookHandler with enhanced error handling
      // This handles both message webhooks and status update webhooks
      // Validates: Requirements 5.4, 5.5, 1.2, 1.4, 8.1, 8.2
      try {
        await this.webhookHandler.processWebhookPayload(payload);
      } catch (processingError) {
        // Enhanced error context for debugging
        // Validates: Requirements 8.4
        const errorContext = {
          isSimulatorPayload,
          errorType: processingError.constructor.name,
          errorMessage: processingError.message,
          payloadSummary: {
            messageCount: this.extractMessageCount(payload),
            statusCount: this.extractStatusCount(payload),
          },
          timestamp: new Date().toISOString(),
        };

        this.logger.error('Webhook payload processing failed:', {
          error: processingError,
          context: errorContext,
        });

        // Re-throw with enhanced context but maintain same error response format
        // Validates: Requirements 8.1, 8.3
        throw new Error(
          `Webhook processing failed: ${processingError.message}`,
        );
      }

      // Legacy message handling for backward compatibility with enhanced error handling
      // This ensures existing functionality continues to work
      // Validates: Requirements 8.1, 8.2
      const value: any = payload?.entry?.[0]?.changes?.[0]?.value;
      const messages = value?.messages;
      if (Array.isArray(messages)) {
        try {
          await this.whatsappBotService.handleMessage(messages);
        } catch (messageHandlingError) {
          // Enhanced error context for message handling failures
          // Validates: Requirements 8.4
          const errorContext = {
            isSimulatorPayload,
            messageCount: messages.length,
            messageTypes: messages.map((m) => m.type),
            errorType: messageHandlingError.constructor.name,
            timestamp: new Date().toISOString(),
          };

          this.logger.error('Message handling failed:', {
            error: messageHandlingError,
            context: errorContext,
          });

          // Don't throw - allow webhook to complete successfully
          // This maintains webhook reliability while providing debugging context
          // Validates: Requirements 8.1, 8.4
        }
      }

      this.logger.log('Successfully processed webhook payload');
    } catch (error) {
      // Enhanced error handling with consistent response format
      // Validates: Requirements 8.1, 8.2, 8.3, 8.4
      const isSimulatorPayload = this.isSimulatorPayload(payload);

      const errorContext = {
        isSimulatorPayload,
        mode: isSimulatorPayload ? 'simulator' : 'production',
        errorType: error.constructor.name,
        errorMessage: error.message,
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] || 'unknown',
      };

      this.logger.error('Webhook processing error:', {
        error: error,
        context: errorContext,
      });

      // For malformed payloads, throw BadRequestException with consistent format
      // Validates: Requirements 5.5, 8.1, 8.3
      if (error instanceof BadRequestException) {
        throw error;
      }

      // For other errors, provide consistent error response format
      // but don't throw to ensure webhook reliability
      // Validates: Requirements 5.2, 8.1, 8.3
      this.logger.error(
        'Non-critical webhook error, continuing operation:',
        errorContext,
      );
    }
  }

  @SkipAuth()
  @HttpCode(200)
  @Post('')
  async handleRequest(@Req() req: ExpressRequest, @Res() res: Response) {
    console.log('hi');
    if (!process.env.PRIVATE_KEY) {
      throw new Error(
        'Private key is empty. Please check your env variable "PRIVATE_KEY".',
      );
    }

    const app_secret = this.config.get('M4D_APP_SECRET');

    if (!isRequestSignatureValid(req, app_secret)) {
      // Return status code 432 if request signature does not match.
      // To learn more about return error codes visit: https://developers.facebook.com/docs/whatsapp/flows/reference/error-codes#endpoint_error_codes
      return res.status(432).send();
    }

    let decryptedRequest: any = null;
    try {
      decryptedRequest = decryptRequest(
        req.body,
        process.env.PRIVATE_KEY,
        process.env.PASSPHRASE!,
      );
    } catch (err) {
      console.error(err);
      if (err instanceof FlowEndpointException) {
        return res.status(err.statusCode).send();
      }
      return res.status(500).send();
    }

    const { aesKeyBuffer, initialVectorBuffer, decryptedBody } =
      decryptedRequest;
    // console.log('💬 Decrypted Request:', decryptedBody);

    // TODO: Uncomment this block and add your flow token validation logic.
    // If the flow token becomes invalid, return HTTP code 427 to disable the flow and show the message in `error_msg` to the user
    // Refer to the docs for details https://developers.facebook.com/docs/whatsapp/flows/reference/error-codes#endpoint_error_codes

    /*
  if (!isValidFlowToken(decryptedBody.flow_token)) {
    const error_response = {
      error_msg: `The message is no longer available`,
    };
    return res
      .status(427)
      .send(
        encryptResponse(error_response, aesKeyBuffer, initialVectorBuffer)
      );
  }
  */

    const screenResponse =
      await this.whatsappBotService.getNextScreen(decryptedBody);
    console.log('👉 Response to Encrypt:', screenResponse);

    res.send(
      encryptResponse(screenResponse, aesKeyBuffer, initialVectorBuffer),
    );
  }

  /**
   * Simulator-only Flow submission. Bypasses Meta's signature check and
   * AES encryption so the in-house WhatsApp simulator can exercise the
   * Flow webhook (`getNextScreen`) end-to-end without round-tripping
   * through Meta. Body shape mirrors what `decryptRequest` would produce
   * for a real Flow request: `{flow_token, action, screen?, data?}`.
   *
   * Guarded by `WHATSAPP_SIMULATOR=true` — refuses to run in production.
   */
  @SkipAuth()
  @Post('/simulator-flow')
  async simulatorFlow(@Req() req: ExpressRequest) {
    const simulatorMode = this.config.get('WHATSAPP_SIMULATOR');
    if (simulatorMode !== 'true' && simulatorMode !== true) {
      throw new ForbiddenException(
        'simulator-flow is only available when WHATSAPP_SIMULATOR=true',
      );
    }

    const body = req.body as {
      flow_token?: string;
      action: 'INIT' | 'data_exchange' | 'ping';
      screen?: string;
      data?: Record<string, unknown>;
    };

    if (!body?.action) {
      throw new BadRequestException('action is required');
    }

    const screenResponse = await this.whatsappBotService.getNextScreen(body);
    return screenResponse;
  }

  /**
   * Simulator-only media upload. Pushes a file to Cloudinary and returns its
   * public URL so the in-house simulator can stand in for Meta-hosted media:
   * the returned `url` is sent back as the `link` on a simulated inbound
   * image/video message (or a Flow PhotoPicker item), and the media services
   * use it directly instead of round-tripping Meta's encrypted CDN.
   *
   * Guarded by `WHATSAPP_SIMULATOR=true` — refuses to run in production.
   */
  @SkipAuth()
  @Post('/simulator-upload')
  @UseInterceptors(FileInterceptor('file'))
  async simulatorUpload(@UploadedFile() file?: Express.Multer.File) {
    const simulatorMode = this.config.get('WHATSAPP_SIMULATOR');
    if (simulatorMode !== 'true' && simulatorMode !== true) {
      throw new ForbiddenException(
        'simulator-upload is only available when WHATSAPP_SIMULATOR=true',
      );
    }
    if (!file) {
      throw new BadRequestException('file is required');
    }

    // Keep simulator test media in its own Cloudinary folder so it's isolated
    // from real attachments and easy to bulk-delete from the Media Library.
    const SIMULATOR_MEDIA_FOLDER = 'simulator-tests';
    const isVideo = file.mimetype.startsWith('video');
    const upload = isVideo
      ? await this.fileUploadService.uploadMediaBuffer(file.buffer, {
          resourceType: 'video',
          folder: SIMULATOR_MEDIA_FOLDER,
        })
      : await this.fileUploadService.uploadFile(file, SIMULATOR_MEDIA_FOLDER);

    return {
      id: `sim_media_${upload.public_id ?? upload.asset_id ?? ''}`,
      url: upload.secure_url,
      type: isVideo ? 'video' : 'image',
      mime_type: file.mimetype,
    };
  }

  @Post('/send-custom-message')
  async sendCustomMessage(@Req() req: ExpressRequest) {
    try {
      const { phone_number, message } = req.body as {
        phone_number: string;
        message: string;
      };
      if (!phone_number || !message) {
        throw new BadRequestException('phone_number and message are required');
      }
      await this.whatsappBotService.sendText(phone_number, message);
      return { success: true };
    } catch (error) {
      console.error('Error sending custom WhatsApp message:', error);
      throw error;
    }
  }

  @Post('/user-message')
  async sendToUserWithTemplate(@Req() req: ExpressRequest) {
    try {
      const { phone_number, customer_name } = req.body as {
        phone_number: string;
        customer_name: string;
      };
      const response =
        await this.whatsappBotService.sendToAgentWithTemplate(phone_number);
      return response;
    } catch (error) {
      console.error('Error sending user message:', error);
      throw error;
    }
  }

  @Post('/facility-message')
  async sendToFacilityManagerWithTemplate(@Req() req: ExpressRequest) {
    try {
      const { phone_number, name, team, role } = req.body;
      const response =
        await this.whatsappBotService.sendToFacilityManagerWithTemplate({
          phone_number,
          name,
          team,
          role,
        });
      return response;
    } catch (error) {
      console.error('Error sending user message:', error);
      throw error;
    }
  }

  @Post('/facility-maintenance-request')
  async sendToFacilityMaintenanceRequest(@Req() req: ExpressRequest) {
    try {
      const {
        phone_number,
        manager_name,
        property_name,
        property_location,
        maintenance_request,
        tenant_name,
        tenant_phone_number,
        date_created,
      } = req.body;
      const response =
        await this.whatsappBotService.sendFacilityMaintenanceRequest({
          phone_number,
          manager_name,
          property_name,
          property_location,
          maintenance_request,
          tenant_name,
          tenant_phone_number,
          date_created,
        });
      return response;
    } catch (error) {
      console.error('Error sending user message:', error);
      throw error;
    }
  }

  @SkipAuth()
  @Get('simulator/landlord-users/:landlordId')
  async getSimulatorLandlordUsers(
    @Param('landlordId') landlordId: string,
    @Request() req,
  ) {
    this.logger.log(`🔍 Fetching users for landlord ID: ${landlordId}`);

    try {
      // Enhanced error context for debugging
      // Validates: Requirements 8.4
      const requestContext = {
        landlordId,
        requestId: req.headers['x-request-id'] || 'unknown',
        timestamp: new Date().toISOString(),
        userAgent: req.headers['user-agent'] || 'unknown',
      };

      // The landlordId is actually the requesting Account ID (a landlord —
      // or, on the property-manager dashboard, an ADMIN spanning every
      // landlord they manage).
      const IDENTITY_RELATIONS = [
        'user',
        'properties',
        'properties.property_tenants',
        'properties.property_tenants.tenant',
        'properties.property_tenants.tenant.user',
      ];

      const requestedAccount = await this.accountRepository.findOne({
        where: { id: landlordId },
        relations: ['user'],
      });
      const isAdminRequester = !!requestedAccount?.roles?.includes(
        RolesEnum.ADMIN,
      );

      // The landlord accounts whose tenants/properties populate the contact
      // list: the requester itself, or every landlord the admin manages.
      let landlordAccounts: Account[] = [];
      if (isAdminRequester) {
        landlordAccounts = await this.accountRepository.find({
          where: {
            creator_id: landlordId,
            roles: ArrayContains([RolesEnum.LANDLORD]),
          },
          relations: IDENTITY_RELATIONS,
        });
      } else if (requestedAccount?.roles?.includes(RolesEnum.LANDLORD)) {
        const fullLandlord = await this.accountRepository.findOne({
          where: { id: landlordId },
          relations: IDENTITY_RELATIONS,
        });
        if (fullLandlord) landlordAccounts = [fullLandlord];
      }

      if (!isAdminRequester && !landlordAccounts.length) {
        // Enhanced error response with consistent format
        // Validates: Requirements 8.1, 8.3
        const errorResponse = {
          status: 'error',
          message: 'Landlord not found',
          users: [],
          context: {
            ...requestContext,
            accountExists: !!requestedAccount,
            actualRoles: requestedAccount?.roles,
            searchedRole: RolesEnum.LANDLORD,
          },
          timestamp: new Date().toISOString(),
        };

        this.logger.error(`❌ Landlord not found for ID: ${landlordId}`, {
          context: errorResponse.context,
        });

        return errorResponse;
      }

      const usersMap = new Map(); // Use Map to avoid duplicates

      const accountDisplayName = (account: Account, fallback: string) =>
        account.profile_name ||
        `${account.user?.first_name || ''} ${account.user?.last_name || ''}`.trim() ||
        fallback;

      // Add the requester themselves for chat simulation. An admin chats as
      // the property manager (this is where redirected landlord notifications
      // now land); a landlord keeps the existing landlord identity.
      if (isAdminRequester && requestedAccount) {
        usersMap.set(requestedAccount.id, {
          id: requestedAccount.id,
          name: accountDisplayName(requestedAccount, 'Property Manager'),
          phone: this.utilService.normalizePhoneNumber(
            requestedAccount.user.phone_number,
          ),
          userType: 'admin',
          properties: landlordAccounts.flatMap(
            (l) => l.properties?.map((p) => p.name) || [],
          ),
        });
      }

      for (const landlordAccount of landlordAccounts) {
        // Add the landlord themselves for chat simulation
        // Use Account.profile_name as primary source for name, with fallbacks
        if (!usersMap.has(landlordAccount.id)) {
          usersMap.set(landlordAccount.id, {
            id: landlordAccount.id,
            name: accountDisplayName(landlordAccount, 'Landlord'),
            phone: this.utilService.normalizePhoneNumber(
              landlordAccount.user.phone_number,
            ),
            userType: 'landlord',
            properties: landlordAccount.properties?.map((p) => p.name) || [],
          });
        }

        // Get all tenants from the landlord's properties
        for (const property of landlordAccount.properties ?? []) {
          if (property.property_tenants) {
            for (const propertyTenant of property.property_tenants) {
              const tenantAccount = propertyTenant.tenant;
              const tenantUser = tenantAccount?.user;

              if (tenantUser && tenantAccount) {
                const existingUser = usersMap.get(tenantAccount.id);

                if (existingUser) {
                  // Add property to existing user
                  existingUser.properties.push(property.name);
                } else {
                  // Create new user entry
                  const tenantUserData = {
                    id: tenantAccount.id,
                    name:
                      tenantAccount.profile_name ||
                      `${tenantUser.first_name} ${tenantUser.last_name}`,
                    phone: this.utilService.normalizePhoneNumber(
                      tenantUser.phone_number,
                    ),
                    userType: tenantAccount.roles?.[0],
                    properties: [property.name],
                  };

                  usersMap.set(tenantAccount.id, tenantUserData);
                }
              }
            }
          }
        }
      }

      const allPropertyNames = landlordAccounts.flatMap(
        (l) => l.properties?.map((p) => p.name) || [],
      );

      // Get facility managers from team members with enhanced error handling
      try {
        // Post-reparent the FMs sit on the managing admin's team, not the
        // landlord's own; accept either as the team owner so the simulator's
        // contact list still includes the relevant facility managers. For an
        // admin requester the team is keyed on the admin id directly.
        const teamOwnerIds = Array.from(
          new Set(
            [landlordId, ...landlordAccounts.map((l) => l.creator_id)].filter(
              (v): v is string => !!v,
            ),
          ),
        );
        const teams = await this.teamRepository.find({
          where: { creatorId: In(teamOwnerIds) },
        });

        if (teams.length) {
          const members = await this.teamMemberRepository.find({
            where: { teamId: In(teams.map((t) => t.id)) },
            relations: ['account', 'account.user'],
          });

          this.logger.log(
            `🤝 Found ${members.length} team members across ${teams.length} team(s).`,
          );

          for (const teamMember of members) {
            const memberAccount = teamMember.account;
            const memberUser = memberAccount?.user;

            if (
              memberUser &&
              memberAccount &&
              teamMember.role === 'facility_manager'
            ) {
              const facilityManagerData = {
                id: memberAccount.id,
                name:
                  memberAccount.profile_name ||
                  `${memberUser.first_name} ${memberUser.last_name}`,
                phone: this.utilService.normalizePhoneNumber(
                  memberUser.phone_number,
                ),
                userType: 'facility_manager',
                properties: allPropertyNames,
              };

              usersMap.set(memberAccount.id, facilityManagerData);
              this.logger.log(
                `✅ Added facility manager: ${facilityManagerData.name}`,
              );
            }
          }
        } else {
          this.logger.log('No team found for this landlord.');
        }
      } catch (teamError) {
        // Enhanced error handling for team member fetching
        // Validates: Requirements 8.1, 8.4
        this.logger.error('Failed to fetch team members:', {
          error: teamError,
          context: {
            ...requestContext,
            errorType: teamError.constructor.name,
            errorMessage: teamError.message,
          },
        });

        // Continue processing without team members rather than failing completely
        // This maintains partial functionality when team data is unavailable
      }

      // Get KYC applicants who haven't been converted to tenants yet
      try {
        const propertyIds = landlordAccounts.flatMap(
          (l) => l.properties?.map((p) => p.id) || [],
        );
        if (propertyIds.length > 0) {
          const kycApplications = await this.kycApplicationRepository.find({
            where: {
              property_id: In(propertyIds),
              tenant_id: IsNull(), // Only get applicants not yet converted to tenants
            },
            relations: ['property'],
          });

          this.logger.log(
            `📋 Found ${kycApplications.length} KYC applicants for landlord's properties`,
          );

          for (const application of kycApplications) {
            // Use phone number as unique identifier for applicants
            const applicantPhone = this.utilService.normalizePhoneNumber(
              application.phone_number,
            );

            // Check if this phone number is already in the map (might be a tenant already)
            const existingUser = Array.from(usersMap.values()).find(
              (u) => u.phone === applicantPhone,
            );

            if (!existingUser) {
              const applicantData = {
                id: application.id, // Use application ID as unique identifier
                name: `${application.first_name} ${application.last_name}`,
                phone: applicantPhone,
                userType: 'kyc_applicant',
                properties: [application.property?.name || 'Unknown Property'],
              };

              // Use a unique key combining type and phone to avoid conflicts
              usersMap.set(`kyc_${applicantPhone}`, applicantData);
              this.logger.log(
                `✅ Added KYC applicant: ${applicantData.name} (${applicantPhone})`,
              );
            }
          }
        }
      } catch (kycError) {
        this.logger.error('Failed to fetch KYC applicants:', {
          error: kycError,
          context: {
            ...requestContext,
            errorType: kycError.constructor.name,
            errorMessage: kycError.message,
          },
        });
        // Continue processing without KYC applicants
      }

      const usersWithProperties = Array.from(usersMap.values());

      this.logger.log(
        `📊 Final users count: ${usersWithProperties.length} (${usersWithProperties.filter((u) => u.userType === 'tenant').length} tenants, ${usersWithProperties.filter((u) => u.userType === 'facility_manager').length} facility managers, ${usersWithProperties.filter((u) => u.userType === 'kyc_applicant').length} KYC applicants)`,
      );

      // Consistent success response format
      // Validates: Requirements 8.1, 8.3
      return {
        status: 'success',
        users: usersWithProperties,
        context: {
          ...requestContext,
          userCounts: {
            total: usersWithProperties.length,
            tenants: usersWithProperties.filter((u) => u.userType === 'tenant')
              .length,
            facilityManagers: usersWithProperties.filter(
              (u) => u.userType === 'facility_manager',
            ).length,
            landlords: usersWithProperties.filter(
              (u) => u.userType === 'landlord',
            ).length,
            kycApplicants: usersWithProperties.filter(
              (u) => u.userType === 'kyc_applicant',
            ).length,
          },
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      // Enhanced error handling with consistent response format
      // Validates: Requirements 8.1, 8.2, 8.3, 8.4
      const errorContext = {
        landlordId,
        errorType: error.constructor.name,
        errorMessage: error.message,
        requestId: req.headers['x-request-id'] || 'unknown',
        timestamp: new Date().toISOString(),
      };

      this.logger.error('💥 Error fetching landlord users:', {
        error: error,
        context: errorContext,
      });

      // Consistent error response format for both simulator and production modes
      // Validates: Requirements 8.1, 8.3
      return {
        status: 'error',
        message: 'Failed to fetch users',
        users: [],
        context: errorContext,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Check if a webhook payload contains simulator messages
   * Validates: Requirements 1.2, 8.2
   */
  private isSimulatorPayload(payload: WhatsAppWebhookPayload): boolean {
    try {
      if (!payload?.entry) {
        return false;
      }

      for (const entry of payload.entry) {
        if (!entry.changes) {
          continue;
        }

        for (const change of entry.changes) {
          if (change.field !== 'messages' || !change.value) {
            continue;
          }

          // Check if this is a message payload (not status update)
          const value = change.value as any;
          if (!value.messages || !Array.isArray(value.messages)) {
            continue;
          }

          // Check if any message in the payload has the is_simulated flag
          for (const message of value.messages) {
            if (message.is_simulated === true) {
              return true;
            }
          }
        }
      }

      return false;
    } catch (error) {
      this.logger.error('Error checking if payload is from simulator:', error);
      return false;
    }
  }

  /**
   * Extract message count from webhook payload for error context
   * Validates: Requirements 8.4
   */
  private extractMessageCount(payload: WhatsAppWebhookPayload): number {
    try {
      let messageCount = 0;

      if (!payload?.entry) {
        return 0;
      }

      for (const entry of payload.entry) {
        if (!entry.changes) {
          continue;
        }

        for (const change of entry.changes) {
          if (change.field === 'messages' && change.value) {
            const value = change.value as any;
            if (value.messages && Array.isArray(value.messages)) {
              messageCount += value.messages.length;
            }
          }
        }
      }

      return messageCount;
    } catch (error) {
      this.logger.error('Error extracting message count:', error);
      return 0;
    }
  }

  /**
   * Extract status update count from webhook payload for error context
   * Validates: Requirements 8.4
   */
  private extractStatusCount(payload: WhatsAppWebhookPayload): number {
    try {
      let statusCount = 0;

      if (!payload?.entry) {
        return 0;
      }

      for (const entry of payload.entry) {
        if (!entry.changes) {
          continue;
        }

        for (const change of entry.changes) {
          if (change.field === 'messages' && change.value) {
            const value = change.value as any;
            if (value.statuses && Array.isArray(value.statuses)) {
              statusCount += value.statuses.length;
            }
          }
        }
      }

      return statusCount;
    } catch (error) {
      this.logger.error('Error extracting status count:', error);
      return 0;
    }
  }
}
