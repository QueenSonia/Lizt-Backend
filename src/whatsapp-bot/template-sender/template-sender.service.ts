import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ChatLogService } from '../chat-log.service';

/**
 * Template parameter for WhatsApp message templates
 */
interface TemplateBodyParameter {
  type: 'text';
  text: string;
  parameter_name?: string;
}

/**
 * Template component for WhatsApp message templates
 */
interface TemplateComponent {
  type: 'header' | 'body' | 'button';
  sub_type?: 'quick_reply' | 'url';
  index?: number | string;
  parameters: Array<
    | TemplateBodyParameter
    | { type: 'payload'; payload: string }
    | { type: 'text'; text: string }
  >;
}

/**
 * WhatsApp template structure
 */
interface WhatsAppTemplate {
  name: string;
  language: { code: string };
  components?: TemplateComponent[];
}

/**
 * WhatsApp API payload structure
 */
interface WhatsAppPayload {
  messaging_product: 'whatsapp';
  recipient_type?: 'individual';
  to: string;
  type: 'template' | 'text' | 'interactive';
  template?: WhatsAppTemplate;
  text?: {
    preview_url: boolean;
    body: string;
  };
  interactive?: {
    type: 'button' | 'flow';
    body: { text: string };
    footer?: { text: string };
    action: Record<string, unknown>;
  };
}

/**
 * Parameters for sendWhatsappMessageWithTemplate
 */
export interface SendTemplateParams {
  phone_number: string;
  template_name: string;
  template_language?: string;
  template_parameters?: Array<{
    type: 'text';
    text: string;
    parameter_name?: string;
  }>;
}

/**
 * Parameters for facility manager template
 */
export interface FMTemplateParams {
  phone_number: string;
  name: string;
  team: string;
  role: string;
}

/**
 * Parameters for property created template
 */
export interface PropertyCreatedParams {
  phone_number: string;
  name: string;
  property_name: string;
}

/**
 * Parameters for user added template
 */
export interface UserAddedParams {
  phone_number: string;
  name: string;
  user: string;
  property_name: string;
}

/**
 * Parameters for tenant welcome template
 */
export interface TenantWelcomeParams {
  phone_number: string;
  tenant_name: string;
  landlord_name: string;
  apartment_name?: string;
}

/**
 * Parameters for tenant confirmation template
 */
export interface TenantConfirmationParams {
  phone_number: string;
  tenant_name: string;
  request_description: string;
  request_id: string;
}

/**
 * Parameters for tenant attachment notification
 */
export interface TenantAttachmentParams {
  phone_number: string;
  tenant_name: string;
  landlord_name: string;
  apartment_name: string;
}

/**
 * Parameters for KYC application notification
 */
export interface KYCApplicationNotificationParams {
  phone_number: string;
  landlord_name: string;
  tenant_name: string;
  property_name: string;
  application_id: string;
  frontend_url: string;
}

/**
 * Parameters for KYC submission confirmation
 */
export interface KYCSubmissionConfirmationParams {
  phone_number: string;
  tenant_name: string;
}

/**
 * Parameters for agent KYC notification
 */
export interface AgentKYCNotificationParams {
  phone_number: string;
  agent_name: string;
  tenant_name: string;
  property_name: string;
  landlord_name: string;
}

/**
 * Parameters for facility service request
 */
export interface FacilityServiceRequestParams {
  phone_number: string;
  manager_name: string;
  property_name: string;
  property_location: string;
  service_request: string;
  tenant_name: string;
  tenant_phone_number: string;
  date_created: string;
  is_landlord?: boolean;
}

/**
 * Parameters for KYC completion link
 */
export interface KYCCompletionLinkParams {
  phone_number: string;
  tenant_name: string;
  landlord_name: string;
  property_name: string;
  kyc_link_id: string;
}

/**
 * Parameters for KYC completion notification
 */
export interface KYCCompletionNotificationParams {
  phone_number: string;
  landlord_name: string;
  tenant_name: string;
  property_name: string;
  tenant_id: string;
}

/**
 * Parameters for offer letter notification
 */
export interface OfferLetterNotificationParams {
  phone_number: string;
  tenant_name: string;
  property_name: string;
  offer_letter_token: string;
  frontend_url: string;
}

/**
 * Parameters for OTP authentication template
 */
export interface OTPAuthenticationParams {
  phone_number: string;
  otp_code: string;
}

/**
 * Parameters for offer letter status notification to landlord
 */
export interface OfferLetterStatusNotificationParams {
  phone_number: string;
  landlord_name: string;
  tenant_name: string;
  property_name: string;
  property_id: string;
  status: 'accepted' | 'rejected';
}

/**
 * Parameters for landlord payment received notification
 * Used for ALL payment notifications (partial and full)
 */
export interface LandlordPaymentReceivedParams {
  phone_number: string;
  landlord_name: string;
  tenant_name: string;
  property_name: string;
  amount: number;
  outstanding_balance: number; // Will be 0 when payment is complete
}

/**
 * Parameters for landlord payment complete notification
 * DEPRECATED: No longer used - replaced by LandlordPaymentReceivedParams
 */
export interface LandlordPaymentCompleteParams {
  phone_number: string;
  landlord_name: string;
  tenant_name: string;
  property_name: string;
  total_amount: number;
  property_id: string;
}

/**
 * Parameters for tenant payment success notification
 */
export interface TenantPaymentSuccessParams {
  phone_number: string;
  tenant_name: string;
  property_name: string;
  total_amount: number;
}

/**
 * Parameters for tenant payment refund notification
 */
export interface TenantPaymentRefundParams {
  phone_number: string;
  tenant_name: string;
  property_name: string;
  amount_paid: number;
}

/**
 * Parameters for landlord race condition notification
 */
export interface LandlordRaceConditionParams {
  phone_number: string;
  landlord_name: string;
  tenant_name: string;
  property_name: string;
  amount: number;
}

/**
 * Parameters for tenant race condition notification
 */
export interface TenantRaceConditionParams {
  phone_number: string;
  tenant_name: string;
  property_name: string;
  amount: number;
}

/**
 * Button definition for interactive messages
 */
export interface ButtonDefinition {
  id: string;
  title: string;
}

/**
 * TemplateSenderService handles all WhatsApp template message sending operations.
 * This service is extracted from WhatsappBotService to centralize template management.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.5
 */
@Injectable()
export class TemplateSenderService {
  private readonly logger = new Logger(TemplateSenderService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly chatLogService: ChatLogService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Send a message using a WhatsApp template with custom parameters
   * Requirements: 1.2
   */
  async sendWhatsappMessageWithTemplate({
    phone_number,
    template_name,
    template_language = 'en',
    template_parameters = [],
  }: SendTemplateParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: template_name,
        language: { code: template_language },
        components: [
          {
            type: 'body',
            parameters: template_parameters,
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send main menu template to user
   */
  async sendToUserWithTemplate(
    phone_number: string,
    customer_name: string,
  ): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'main_menu',
        language: {
          code: 'en',
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                parameter_name: 'name',
                text: customer_name,
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send agent welcome template
   */
  async sendToAgentWithTemplate(phone_number: string): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'agent_welcome',
        language: {
          code: 'en',
        },
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send facility manager template
   */
  async sendToFacilityManagerWithTemplate({
    phone_number,
    name,
    team,
    role,
  }: FMTemplateParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'facility_manager',
        language: {
          code: 'en',
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                parameter_name: 'name',
                text: name,
              },
              {
                type: 'text',
                parameter_name: 'team',
                text: team,
              },
              {
                type: 'text',
                parameter_name: 'role',
                text: role,
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send property created template
   */
  async sendToPropertiesCreatedTemplate({
    phone_number,
    name,
    property_name,
  }: PropertyCreatedParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'properties_created',
        language: {
          code: 'en',
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                parameter_name: 'name',
                text: name,
              },
              {
                type: 'text',
                parameter_name: 'property_name',
                text: property_name,
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send user added template
   */
  async sendUserAddedTemplate({
    phone_number,
    name,
    user,
    property_name,
  }: UserAddedParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'user_added',
        language: {
          code: 'en',
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                parameter_name: 'name',
                text: name,
              },
              {
                type: 'text',
                parameter_name: 'user',
                text: user,
              },
              {
                type: 'text',
                parameter_name: 'property_name',
                text: property_name,
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send tenant welcome template
   */
  async sendTenantWelcomeTemplate({
    phone_number,
    tenant_name,
    landlord_name,
    apartment_name,
  }: TenantWelcomeParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'tenant_welcome',
        language: {
          code: 'en',
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                parameter_name: 'tenant_name',
                text: tenant_name,
              },
              {
                type: 'text',
                parameter_name: 'landlord_name',
                text: landlord_name,
              },
              {
                type: 'text',
                parameter_name: 'apartment_name',
                text: apartment_name || 'your property',
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send tenant confirmation template for service requests
   */
  async sendTenantConfirmationTemplate({
    phone_number,
    tenant_name,
    request_description,
    request_id,
  }: TenantConfirmationParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'service_request_confirmation',
        language: {
          code: 'en',
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                parameter_name: 'tenant_name',
                text: tenant_name,
              },
              {
                type: 'text',
                parameter_name: 'request_description',
                text: request_description,
              },
            ],
          },
          {
            type: 'button',
            sub_type: 'quick_reply',
            index: 0,
            parameters: [
              {
                type: 'payload',
                payload: `confirm_resolution_yes:${request_id}`,
              },
            ],
          },
          {
            type: 'button',
            sub_type: 'quick_reply',
            index: 1,
            parameters: [
              {
                type: 'payload',
                payload: `confirm_resolution_no:${request_id}`,
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send tenant attachment notification via WhatsApp
   * Notifies tenant when they've been successfully attached to a property
   */
  async sendTenantAttachmentNotification({
    phone_number,
    tenant_name,
    landlord_name,
    apartment_name,
  }: TenantAttachmentParams): Promise<void> {
    await this.sendTenantWelcomeTemplate({
      phone_number,
      tenant_name,
      landlord_name,
      apartment_name,
    });
  }

  /**
   * Send KYC application notification to landlord via WhatsApp
   */
  async sendKYCApplicationNotification({
    phone_number,
    landlord_name,
    tenant_name,
    property_name,
    application_id,
  }: KYCApplicationNotificationParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'tenant_application_notification',
        language: {
          code: 'en',
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                text: landlord_name,
              },
              {
                type: 'text',
                text: tenant_name,
              },
              {
                type: 'text',
                text: property_name,
              },
            ],
          },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [
              {
                type: 'text',
                text: application_id,
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send KYC submission confirmation to tenant via WhatsApp
   */
  async sendKYCSubmissionConfirmation({
    phone_number,
    tenant_name,
  }: KYCSubmissionConfirmationParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'kyc_submission_confirmation',
        language: {
          code: 'en',
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                text: tenant_name,
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send KYC application notification to referral agent via WhatsApp
   */
  async sendAgentKYCNotification({
    phone_number,
    agent_name,
    tenant_name,
    property_name,
    landlord_name,
  }: AgentKYCNotificationParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'agent_kyc_notification',
        language: {
          code: 'en',
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                text: agent_name,
              },
              {
                type: 'text',
                text: tenant_name,
              },
              {
                type: 'text',
                text: property_name,
              },
              {
                type: 'text',
                text: landlord_name,
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send facility service request notification
   */
  async sendFacilityServiceRequest({
    phone_number,
    property_name,
    service_request,
    tenant_name,
    tenant_phone_number,
    date_created,
    is_landlord = false,
  }: FacilityServiceRequestParams): Promise<void> {
    if (is_landlord) {
      const payload: WhatsAppPayload = {
        messaging_product: 'whatsapp',
        to: phone_number,
        type: 'template',
        template: {
          name: 'landlord_service_request_notification',
          language: {
            code: 'en',
          },
          components: [
            {
              type: 'body',
              parameters: [
                {
                  type: 'text',
                  text: tenant_name,
                },
                {
                  type: 'text',
                  text: property_name,
                },
                {
                  type: 'text',
                  text: service_request,
                },
                {
                  type: 'text',
                  text: date_created,
                },
              ],
            },
          ],
        },
      };

      await this.sendToWhatsappAPI(payload);
      return;
    }

    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'fm_service_request_notification',
        language: {
          code: 'en',
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                text: tenant_name,
              },
              {
                type: 'text',
                text: property_name,
              },
              {
                type: 'text',
                text: service_request,
              },
              {
                type: 'text',
                text: date_created,
              },
              {
                type: 'text',
                text: tenant_phone_number,
              },
            ],
          },
          {
            type: 'button',
            sub_type: 'quick_reply',
            index: 0,
            parameters: [
              {
                type: 'payload',
                payload: 'view_all_service_requests',
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send KYC completion link to existing tenant via WhatsApp
   */
  async sendKYCCompletionLink({
    phone_number,
    tenant_name,
    landlord_name,
    property_name,
    kyc_link_id,
  }: KYCCompletionLinkParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'kyc_completion_link',
        language: {
          code: 'en',
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                text: tenant_name,
              },
              {
                type: 'text',
                text: landlord_name,
              },
              {
                type: 'text',
                text: property_name,
              },
            ],
          },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [
              {
                type: 'text',
                text: kyc_link_id,
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send KYC completion notification to landlord via WhatsApp
   */
  async sendKYCCompletionNotification({
    phone_number,
    landlord_name,
    tenant_name,
    property_name,
    tenant_id,
  }: KYCCompletionNotificationParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'kyc_completion_notification',
        language: {
          code: 'en',
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                text: landlord_name,
              },
              {
                type: 'text',
                text: tenant_name,
              },
              {
                type: 'text',
                text: property_name,
              },
            ],
          },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [
              {
                type: 'text',
                text: tenant_id,
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send offer letter notification to tenant via WhatsApp
   * Uses a template message with a URL button to view the offer letter
   * Requirements: 7.1, 7.2
   */
  async sendOfferLetterNotification({
    phone_number,
    tenant_name,
    property_name,
    offer_letter_token,
    frontend_url,
  }: OfferLetterNotificationParams): Promise<void> {
    const offerLetterUrl = `${frontend_url}/offer-letters/${offer_letter_token}`;

    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'offer_letter_notification',
        language: {
          code: 'en',
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                text: tenant_name,
              },
              {
                type: 'text',
                text: property_name,
              },
            ],
          },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [
              {
                type: 'text',
                text: offerLetterUrl,
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send OTP authentication code via WhatsApp authentication template
   * Uses WhatsApp's authentication template category for OTP delivery
   * Requirements: 9.1
   */
  async sendOTPAuthentication({
    phone_number,
    otp_code,
  }: OTPAuthenticationParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'offer_letter_otp',
        language: {
          code: 'en',
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                text: otp_code,
              },
            ],
          },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [
              {
                type: 'text',
                text: otp_code,
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send offer letter status notification to landlord via WhatsApp
   * Notifies landlord when tenant accepts or rejects an offer letter
   * Requirements: 9.4, 9.8
   */
  async sendOfferLetterStatusNotification({
    phone_number,
    landlord_name,
    tenant_name,
    property_name,
    property_id,
    status,
  }: OfferLetterStatusNotificationParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'offer_letter_status_notification',
        language: {
          code: 'en',
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                text: landlord_name,
              },
              {
                type: 'text',
                text: tenant_name,
              },
              {
                type: 'text',
                text: property_name,
              },
              {
                type: 'text',
                text: status,
              },
            ],
          },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [
              {
                type: 'text',
                text: property_id,
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send landlord payment received notification (for ANY payment - partial or full)
   * Requirements: Phase 5 - Task 19.3
   * Template: ll_payment_received (20 chars)
   */
  async sendLandlordPaymentReceived({
    phone_number,
    landlord_name,
    tenant_name,
    property_name,
    amount,
    outstanding_balance,
  }: LandlordPaymentReceivedParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'll_payment_received',
        language: {
          code: 'en',
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                text: landlord_name,
              },
              {
                type: 'text',
                text: tenant_name,
              },
              {
                type: 'text',
                text: `₦${amount.toLocaleString()}`,
              },
              {
                type: 'text',
                text: property_name,
              },
              {
                type: 'text',
                text: `₦${outstanding_balance.toLocaleString()}`,
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send landlord payment complete notification (100% paid, property secured)
   * Requirements: Phase 5 - Task 19.4
   * Template: ll_payment_complete (19 chars)
   */
  async sendLandlordPaymentComplete({
    phone_number,
    landlord_name,
    tenant_name,
    property_name,
    total_amount,
    property_id,
  }: LandlordPaymentCompleteParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'll_payment_complete',
        language: {
          code: 'en',
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                text: landlord_name,
              },
              {
                type: 'text',
                text: tenant_name,
              },
              {
                type: 'text',
                text: `₦${total_amount.toLocaleString()}`,
              },
              {
                type: 'text',
                text: property_name,
              },
            ],
          },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [
              {
                type: 'text',
                text: property_id,
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send tenant payment success notification (winning tenant)
   * Requirements: Phase 5 - Task 19.1
   * Template: tenant_payment_success (22 chars)
   */
  async sendTenantPaymentSuccess({
    phone_number,
    tenant_name,
    property_name,
    total_amount,
  }: TenantPaymentSuccessParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'tenant_payment_success',
        language: {
          code: 'en',
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                text: tenant_name,
              },
              {
                type: 'text',
                text: `₦${total_amount.toLocaleString()}`,
              },
              {
                type: 'text',
                text: property_name,
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send tenant payment refund notification (losing tenant)
   * Requirements: Phase 5 - Task 19.2
   * Template: tenant_payment_refund (21 chars)
   */
  async sendTenantPaymentRefund({
    phone_number,
    tenant_name,
    property_name,
    amount_paid,
  }: TenantPaymentRefundParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'tenant_payment_refund',
        language: {
          code: 'en',
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                text: tenant_name,
              },
              {
                type: 'text',
                text: property_name,
              },
              {
                type: 'text',
                text: `₦${amount_paid.toLocaleString()}`,
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send landlord race condition notification
   * Requirements: Phase 5 - Task 19.5.1
   * Template: ll_payment_race (15 chars)
   */
  async sendLandlordRaceCondition({
    phone_number,
    landlord_name,
    tenant_name,
    property_name,
    amount,
  }: LandlordRaceConditionParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'll_payment_race',
        language: {
          code: 'en',
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                text: landlord_name,
              },
              {
                type: 'text',
                text: tenant_name,
              },
              {
                type: 'text',
                text: `₦${amount.toLocaleString()}`,
              },
              {
                type: 'text',
                text: property_name,
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send tenant race condition notification
   * Requirements: Phase 5 - Task 19.5.2
   * Template: tenant_payment_race (19 chars)
   */
  async sendTenantRaceCondition({
    phone_number,
    tenant_name,
    property_name,
    amount,
  }: TenantRaceConditionParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'tenant_payment_race',
        language: {
          code: 'en',
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                text: tenant_name,
              },
              {
                type: 'text',
                text: `₦${amount.toLocaleString()}`,
              },
              {
                type: 'text',
                text: property_name,
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Parameters for invoice reminder template
   */
  /**
   * Send invoice payment reminder to tenant via WhatsApp
   * Template: invoice_reminder
   */
  async sendInvoiceReminder(params: {
    phone_number: string;
    tenant_name: string;
    landlord_name: string;
    property_name: string;
    invoice_number: string;
    outstanding_balance: number;
  }): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: params.phone_number,
      type: 'template',
      template: {
        name: 'invoice_reminder',
        language: {
          code: 'en',
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                text: params.tenant_name,
              },
              {
                type: 'text',
                text: params.landlord_name,
              },
              {
                type: 'text',
                text: params.invoice_number,
              },
              {
                type: 'text',
                text: `₦${params.outstanding_balance.toLocaleString()}`,
              },
              {
                type: 'text',
                text: params.property_name,
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send plain text message
   */
  async sendText(to: string, text: string): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: {
        preview_url: false,
        body: text,
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send interactive button message
   */
  async sendButtons(
    to: string,
    text: string = 'Hello, welcome to Property Kraft',
    buttons: ButtonDefinition[],
    footer?: string,
  ): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text },
        ...(footer && { footer: { text: footer } }),
        action: {
          buttons: buttons.map((btn) => ({
            type: 'reply',
            reply: {
              id: btn.id,
              title: btn.title,
            },
          })),
        },
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send landlord main menu with URL buttons
   */
  async sendLandlordMainMenu(to: string, landlordName: string): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: 'landlord_main_menu',
        language: {
          code: 'en',
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                text: landlordName,
              },
            ],
          },
          {
            type: 'button',
            sub_type: 'quick_reply',
            index: 2,
            parameters: [
              {
                type: 'payload',
                payload: 'generate_kyc_link',
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send WhatsApp flow
   */
  async sendFlow(recipientNumber: string): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: recipientNumber,
      type: 'interactive',
      interactive: {
        type: 'flow',
        body: {
          text: 'Please fill out this form:',
        },
        footer: {
          text: 'Powered by WhatsApp Flows',
        },
        action: {
          name: 'flow',
          parameters: {
            flow_id: '1435187147817037',
            flow_action: 'navigate',
            flow_message_version: '3',
            flow_cta: 'Not shown in draft mode',
            mode: 'draft',
          },
        },
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Core method to send messages to WhatsApp API
   * Handles both simulation mode and production mode
   * Requirements: 1.3
   */
  async sendToWhatsappAPI(payload: WhatsAppPayload): Promise<unknown> {
    try {
      const simulatorMode = this.config.get('WHATSAPP_SIMULATOR');
      const isSimulationMode = this.validateSimulationMode(simulatorMode);

      console.log('🎭 Simulation mode detection:', {
        environmentVariable: simulatorMode,
        isSimulationMode,
        messageType: this.extractPayloadMessageType(payload),
        recipient: payload?.to,
      });

      if (isSimulationMode) {
        console.log('🎭 Simulation mode: Intercepting outbound message');
        console.log(
          '📤 Intercepted payload:',
          JSON.stringify(payload, null, 2),
        );

        try {
          this.eventEmitter.emit('whatsapp.outbound', payload);
          console.log('✅ Successfully emitted to WebSocket gateway');
        } catch (emitError) {
          console.error('❌ Failed to emit to WebSocket:', emitError);
        }

        const recipientPhone = payload?.to;
        if (recipientPhone) {
          try {
            console.log('📝 Logging simulated outbound message:', {
              recipient: recipientPhone,
              messageType: this.extractPayloadMessageType(payload),
              isSimulated: true,
              simulationMode: 'intercepted',
            });

            await this.chatLogService.logOutboundMessage(
              recipientPhone,
              this.extractPayloadMessageType(payload),
              this.extractPayloadContent(payload),
              {
                ...payload,
                is_simulated: true,
                simulation_status: 'simulator_message',
                message_source: 'whatsapp_simulator',
                simulation_mode: simulatorMode,
              },
              'sim_msg_id_' + Date.now(),
            );
            console.log('✅ Successfully logged simulated outbound message');
          } catch (loggingError) {
            console.error(
              '⚠️ Failed to log simulated outbound message (continuing):',
              {
                errorType: (loggingError as Error).constructor.name,
                errorMessage: (loggingError as Error).message,
                recipient: recipientPhone,
                messageType: this.extractPayloadMessageType(payload),
                timestamp: new Date().toISOString(),
              },
            );
          }
        }

        const simulatedResponse = this.createSimulatedResponse(payload);
        console.log('📋 Returning simulated response:', simulatedResponse);
        return simulatedResponse;
      }

      console.log('🚀 Production mode: Sending to WhatsApp Cloud API');

      const phoneNumberId = this.config.get('WA_PHONE_NUMBER_ID');
      const accessToken = this.config.get('CLOUD_API_ACCESS_TOKEN');

      if (!phoneNumberId) {
        const configError = new Error(
          'WhatsApp phone number ID (WA_PHONE_NUMBER_ID) is not configured.',
        );
        console.error('❌ Configuration error:', {
          error: configError.message,
          mode: 'production',
          missingConfig: 'WA_PHONE_NUMBER_ID',
          timestamp: new Date().toISOString(),
        });
        throw configError;
      }
      if (!accessToken) {
        const configError = new Error(
          'WhatsApp access token (CLOUD_API_ACCESS_TOKEN) is not configured.',
        );
        console.error('❌ Configuration error:', {
          error: configError.message,
          mode: 'production',
          missingConfig: 'CLOUD_API_ACCESS_TOKEN',
          timestamp: new Date().toISOString(),
        });
        throw configError;
      }

      let response: Response;
      let data: Record<string, unknown>;

      try {
        response = await fetch(
          `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(payload),
          },
        );

        data = (await response.json()) as Record<string, unknown>;
        console.log('📨 Response from WhatsApp API:', data);
        console.log('📊 Response status:', response.status);
      } catch (networkError) {
        const errorContext = {
          mode: 'production',
          errorType: 'NetworkError',
          errorMessage: (networkError as Error).message,
          recipient: payload?.to,
          messageType: this.extractPayloadMessageType(payload),
          timestamp: new Date().toISOString(),
        };

        console.error('❌ Network error calling WhatsApp API:', errorContext);
        throw new Error(`Network error: ${(networkError as Error).message}`);
      }

      if (!response.ok) {
        const apiErrorContext = {
          mode: 'production',
          httpStatus: response.status,
          httpStatusText: response.statusText,
          whatsappError: data,
          recipient: payload?.to,
          messageType: this.extractPayloadMessageType(payload),
          timestamp: new Date().toISOString(),
        };

        console.error('❌ WhatsApp API Error:', apiErrorContext);

        const errorData = data as { error?: { message?: string } };
        const errorMessage = `WhatsApp API Error (${response.status}): ${
          errorData?.error?.message || response.statusText
        }`;

        throw new Error(errorMessage);
      }

      try {
        const responseData = data as { messages?: Array<{ id?: string }> };
        const wamid = responseData?.messages?.[0]?.id;
        const recipientPhone = payload?.to;

        if (recipientPhone) {
          console.log('📝 Logging production outbound message:', {
            recipient: recipientPhone,
            messageType: this.extractPayloadMessageType(payload),
            isSimulated: false,
            wamid,
          });

          await this.chatLogService.logOutboundMessage(
            recipientPhone,
            this.extractPayloadMessageType(payload),
            this.extractPayloadContent(payload),
            {
              ...payload,
              is_simulated: false,
              simulation_status: 'production_message',
              whatsapp_response: data,
            },
            wamid,
          );
          console.log('✅ Successfully logged production outbound message');
        }
      } catch (loggingError) {
        const loggingErrorContext = {
          mode: 'production',
          errorType: (loggingError as Error).constructor.name,
          errorMessage: (loggingError as Error).message,
          recipient: payload?.to,
          messageType: this.extractPayloadMessageType(payload),
          timestamp: new Date().toISOString(),
        };

        console.error(
          '⚠️ Failed to log outbound message, continuing with response:',
          loggingErrorContext,
        );
      }

      return data;
    } catch (error) {
      const errorContext = {
        errorType: (error as Error).constructor.name,
        errorMessage: (error as Error).message,
        recipient: payload?.to,
        messageType: this.extractPayloadMessageType(payload),
        timestamp: new Date().toISOString(),
      };

      console.error('❌ Error in sendToWhatsappAPI:', errorContext);
      throw error;
    }
  }

  /**
   * Validates the WHATSAPP_SIMULATOR environment variable
   */
  private validateSimulationMode(simulatorValue: string | undefined): boolean {
    console.log('🔍 Validating simulation mode configuration:', {
      rawValue: simulatorValue,
      type: typeof simulatorValue,
    });

    if (simulatorValue === undefined || simulatorValue === null) {
      console.log('✅ Simulation mode disabled (undefined/null)');
      return false;
    }

    const normalizedValue = simulatorValue.toString().toLowerCase().trim();
    console.log('🔄 Normalized value:', normalizedValue);

    if (normalizedValue === 'true') {
      console.log(
        '⚠️ WARNING: Simulation mode is ENABLED - no real WhatsApp messages will be sent',
      );
      return true;
    }

    if (normalizedValue === 'false' || normalizedValue === '') {
      console.log('✅ Simulation mode disabled (false/empty)');
      return false;
    }

    console.warn(
      '⚠️ Invalid WHATSAPP_SIMULATOR value:',
      simulatorValue,
      'treating as disabled',
    );
    return false;
  }

  /**
   * Creates a properly formatted simulated WhatsApp API response
   */
  private createSimulatedResponse(
    payload: WhatsAppPayload,
  ): Record<string, unknown> {
    const recipientPhone = payload?.to || 'unknown';
    const messageId =
      'sim_msg_id_' +
      Date.now() +
      '_' +
      Math.random().toString(36).substr(2, 9);

    console.log('🎭 Creating simulated response for:', {
      recipient: recipientPhone,
      messageId,
      messageType: this.extractPayloadMessageType(payload),
    });

    const simulatedResponse = {
      messaging_product: 'whatsapp',
      contacts: [
        {
          input: recipientPhone,
          wa_id: recipientPhone.replace(/^\+/, ''),
        },
      ],
      messages: [
        {
          id: messageId,
        },
      ],
    };

    console.log('📋 Generated simulated response:', simulatedResponse);
    return simulatedResponse;
  }

  /**
   * Helper method to extract message type from outbound payload
   */
  private extractPayloadMessageType(payload: WhatsAppPayload): string {
    if (payload.text) return 'text';
    if (payload.interactive) return 'interactive';
    if (payload.template) return 'template';
    return 'unknown';
  }

  /**
   * Helper method to extract content from outbound payload
   */
  private extractPayloadContent(payload: WhatsAppPayload): string {
    if (payload.text?.body) {
      return payload.text.body;
    }
    if (payload.interactive?.body?.text) {
      return payload.interactive.body.text;
    }
    if (payload.template?.name) {
      // Extract template parameters for better simulator display
      const templateName = payload.template.name;
      const params = payload.template.components
        ?.flatMap((c) => c.parameters || [])
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join(', ');

      if (params) {
        return `Template: ${templateName} [${params}]`;
      }
      return `Template: ${templateName}`;
    }
    return 'Outbound message content';
  }
}
