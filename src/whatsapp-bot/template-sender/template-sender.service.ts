import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ChatLogService } from '../chat-log.service';
import { RenewalPDFService } from 'src/pdf/renewal-pdf.service';

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
    | {
        type: 'document';
        // Meta accepts either a pre-uploaded media id OR a public URL.
        // For renewal-letter-signed we ship the Cloudinary URL via `link`
        // since the PDF is freshly rendered per send and there's no
        // benefit to a separate /media upload step.
        document:
          | { id: string; filename: string }
          | { link: string; filename: string };
      }
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
  property_name: string;
  property_id: string;
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
  property_name: string;
  property_id: string;
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
  action_text?: string; // "complete" or "update"
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
 * Parameters for payment invoice link notification to tenant
 */
export interface PaymentInvoiceLinkParams {
  phone_number: string;
  tenant_name: string;
  property_name: string;
  invoice_url: string;
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
  outstanding_balance: number;
}

/**
 * Parameters for landlord payment complete notification
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
  landlord_name: string;
  receipt_token?: string;
}

/**
 * Parameters for tenant payment refund notification
 */
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
 * Parameters for renewal link notification to tenant
 */
export interface RenewalLinkParams {
  phone_number: string;
  tenant_name: string;
  renewal_token: string;
  frontend_url: string;
}

/**
 * Parameters for renewal letter link (new flow — tenant must accept before invoice)
 */
export interface RenewalLetterLinkParams {
  phone_number: string;
  tenant_name: string;
  property_name: string;
  landlord_name: string;
  renewal_token: string;
}

/**
 * Parameters for landlord notification when tenant declines a renewal letter
 */
export interface RenewalLetterDeclinedNoticeParams {
  phone_number: string;
  landlord_name: string;
  tenant_name: string;
  property_name: string;
}

/**
 * Parameters for landlord notification when tenant accepts a renewal letter
 */
export interface RenewalLetterAcceptedNoticeParams {
  phone_number: string;
  landlord_name: string;
  tenant_name: string;
  property_name: string;
}

/**
 * Parameters for the signed-letter PDF dispatch sent to the tenant after
 * they accept or decline a renewal letter. One template handles both
 * outcomes — `outcome` flips the body's verb between "accepted" and
 * "declined" while every other parameter stays the same.
 */
export interface RenewalLetterSignedParams {
  phone_number: string;
  /** Used in the body greeting — pass first name for a friendly read. */
  tenant_first_name: string;
  property_name: string;
  /** Lower-case verb interpolated into the body — `accepted` or `declined`. */
  outcome: 'accepted' | 'declined';
  /** Pre-formatted decision date (e.g. "April 27, 2026"). */
  decision_date: string;
  /**
   * Public URL to the rendered PDF. Must be reachable by Meta's servers
   * at send time — they fetch and cache the document during template
   * delivery; later 404s are tolerated.
   */
  pdf_url: string;
  /**
   * Filename surfaced as the document title in the WhatsApp chat.
   * Pick something tenant-readable (e.g. "Renewal Letter — Sunset
   * Heights — 2026-04-27.pdf").
   */
  pdf_filename: string;
}

/**
 * Parameters for renewal payment confirmation to tenant
 */
export interface RenewalPaymentTenantParams {
  phone_number: string;
  tenant_name: string;
  amount: number;
  property_name: string;
  receipt_token: string;
  period_start: string | Date;
  period_end: string | Date;
  rent_amount: number;
  service_charge: number;
  payment_frequency: string;
}

/**
 * Parameters for renewal payment notification to landlord
 */
export interface RenewalPaymentLandlordParams {
  phone_number: string;
  landlord_name: string;
  tenant_name: string;
  amount: number;
  property_name: string;
}

/**
 * Parameters for outstanding balance payment notification to tenant
 */
export interface OutstandingBalancePaidTenantParams {
  phone_number: string;
  tenant_name: string;
  amount: number;
  property_name: string;
  remaining_balance: number;
}

/**
 * Parameters for outstanding balance payment notification to landlord
 */
export interface OutstandingBalancePaidLandlordParams {
  phone_number: string;
  landlord_name: string;
  tenant_name: string;
  amount: number;
  property_name: string;
  remaining_balance: number;
}

/**
 * Parameters for full renewal payment (OB cleared + renewed) to landlord
 */
export interface FullRenewalPaymentLandlordParams {
  phone_number: string;
  landlord_name: string;
  tenant_name: string;
  amount: number;
  property_name: string;
}

/**
 * Parameters for rent reminder to tenant
 */
export interface RentReminderParams {
  phone_number: string;
  tenant_name: string;
  property_name: string;
  rent_amount: string;
  expiry_date: string;
}

/**
 * Parameters for rent reminder with renewal link to tenant
 */
export interface RentReminderWithRenewalParams {
  phone_number: string;
  tenant_name: string;
  property_name: string;
  rent_amount: string;
  expiry_date: string;
  renewal_token: string;
  frontend_url: string;
  payment_frequency: string;
}

/**
 * Parameters for rent overdue reminder to tenant
 */
export interface RentOverdueParams {
  phone_number: string;
  tenant_name: string;
  property_name: string;
  rent_amount: string;
  expiry_date: string;
}

/**
 * Parameters for rent overdue reminder with renewal link to tenant
 */
export interface RentOverdueWithRenewalParams {
  phone_number: string;
  tenant_name: string;
  rent_amount: string;
  period: string;
  property_name: string;
  renewal_token: string;
  frontend_url: string;
}

/**
 * Parameters for payment plan installment reminder to tenant
 */
export interface InstallmentReminderParams {
  phone_number: string;
  tenant_name: string;
  property_name: string;
  charge_name: string;
  installment_label: string; // e.g. "2 of 4"
  amount: string;
  due_date: string;
  pay_token: string; // installment id used as URL path
}

/**
 * Parameters for installment receipt to tenant (after payment)
 */
export interface InstallmentReceiptTenantParams {
  phone_number: string;
  tenant_name: string;
  amount: number;
  charge_name: string;
  property_name: string;
  receipt_token: string;
}

/**
 * Parameters for installment paid notification to landlord
 */
export interface InstallmentPaidLandlordParams {
  phone_number: string;
  tenant_name: string;
  installment_label: string; // e.g. "2 of 4"
  charge_name: string;
  property_name: string;
  amount: number;
}

/**
 * Parameters for payment plan completion to tenant (charge-scope plans only)
 */
export interface PaymentPlanCompletedTenantParams {
  phone_number: string;
  tenant_name: string;
  charge_name: string;
  property_name: string;
  total_amount: number;
}

/**
 * Parameters for payment plan completion to landlord
 */
export interface PaymentPlanCompletedLandlordParams {
  phone_number: string;
  tenant_name: string;
  charge_name: string;
  property_name: string;
  total_amount: number;
}

/**
 * Parameters for payment plan creation notice to tenant.
 * Sent whether the plan was landlord-initiated or created from an approved
 * tenant request — message is intentionally generic.
 */
export interface PaymentPlanCreatedTenantParams {
  phone_number: string;
  tenant_name: string;
  charge_name: string;
  property_name: string;
  total_amount: number;
  installments_summary: string;
  first_installment_id: string;
}

/**
 * Parameters for ad-hoc invoice pay-link to tenant (sent on invoice creation)
 */
export interface AdhocInvoiceLinkTenantParams {
  phone_number: string;
  tenant_name: string;
  fees: string;
  public_token: string;
}

/**
 * Parameters for ad-hoc invoice paid receipt link to tenant
 */
export interface AdhocInvoicePaidTenantParams {
  phone_number: string;
  amount: number;
  receipt_token: string;
}

/**
 * Parameters for ad-hoc invoice paid notification to landlord
 */
export interface AdhocInvoicePaidLandlordParams {
  phone_number: string;
  tenant_name: string;
  amount: number;
  fees: string;
}

/**
 * Parameters for the confirmation a tenant receives after submitting a request
 */
export interface PaymentPlanRequestSubmittedTenantParams {
  phone_number: string;
  tenant_name: string;
  property_name: string;
  total_amount: number;
  preferred_schedule: string;
  tenant_note: string;
}

/**
 * Parameters for the heads-up a landlord receives when a tenant submits a request
 */
export interface PaymentPlanRequestLandlordNotifyParams {
  phone_number: string;
  landlord_name: string;
  tenant_name: string;
  property_name: string;
  total_amount: number;
  preferred_schedule: string;
  tenant_note: string;
}

/**
 * Parameters for the approved/declined notification to a tenant
 */
export interface PaymentPlanRequestDecisionTenantParams {
  phone_number: string;
  tenant_name: string;
  property_name: string;
  total_amount: number;
  decline_reason?: string;
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
  constructor(
    private readonly config: ConfigService,
    private readonly chatLogService: ChatLogService,
    private readonly eventEmitter: EventEmitter2,
    private readonly renewalPDFService: RenewalPDFService,
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
   * Send tenant welcome template (welcome_tenant — Utility category)
   */
  async sendTenantWelcomeTemplate({
    phone_number,
    tenant_name,
    landlord_name,
    property_name,
    property_id,
  }: TenantWelcomeParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'welcome_tenant',
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
                parameter_name: 'property_name',
                text: property_name,
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
                payload: `confirm_tenancy_details:${property_id}`,
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
                text: tenant_name,
              },
              {
                type: 'text',
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
    property_name,
    property_id,
  }: TenantAttachmentParams): Promise<void> {
    await this.sendTenantWelcomeTemplate({
      phone_number,
      tenant_name,
      landlord_name,
      property_name,
      property_id,
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
   * Template: "Hi {{1}}, {{2}} has listed you as their agent and has just completed their KYC form for {{3}}Thank you"
   */
  async sendAgentKYCNotification({
    phone_number,
    agent_name,
    tenant_name,
    property_name,
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
    action_text = 'complete', // Default to 'complete'
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
              {
                type: 'text',
                text: action_text, // New parameter for "complete" or "update"
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
                text: offer_letter_token,
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
   * Send payment invoice link to tenant via WhatsApp after offer acceptance
   * Template: payment_invoice_link
   */
  async sendPaymentInvoiceLink({
    phone_number,
    tenant_name,
    property_name,
    invoice_url,
  }: PaymentInvoiceLinkParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'payment_invoice_link',
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
                text: invoice_url,
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
   * Template: landlord_partial_payment
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
        name: 'landlord_partial_payment',
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
    landlord_name,
    receipt_token,
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
              {
                type: 'text',
                text: landlord_name,
              },
            ],
          },
          ...(receipt_token
            ? [
                {
                  type: 'button' as const,
                  sub_type: 'url' as const,
                  index: '0',
                  parameters: [
                    {
                      type: 'text' as const,
                      text: receipt_token,
                    },
                  ],
                },
              ]
            : []),
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
   * Send renewal link to tenant via WhatsApp
   * Uses a template message with a URL button to access the renewal invoice
   * Requirements: 1.2, 1.4, 1.5
   * Template: renewal_link
   */
  async sendRenewalLink({
    phone_number,
    tenant_name,
    renewal_token,
    frontend_url: _frontend_url,
  }: RenewalLinkParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'renewal_link',
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
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [
              {
                type: 'text',
                text: renewal_token,
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send renewal LETTER link (new flow — tenant accepts before receiving an
   * invoice). URL button resolves to /renewal-letters/{token} on the frontend.
   * Template: renewal_letter_link
   */
  async sendRenewalLetterLink({
    phone_number,
    tenant_name,
    property_name,
    landlord_name,
    renewal_token,
  }: RenewalLetterLinkParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'renewal_letter_link',
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: tenant_name },
              { type: 'text', text: property_name },
              { type: 'text', text: landlord_name },
            ],
          },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: renewal_token }],
          },
        ],
      },
    };
    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Notify landlord that the tenant declined the renewal letter.
   * Template: renewal_letter_declined_landlord_notice
   */
  async sendRenewalLetterDeclinedNotice({
    phone_number,
    landlord_name,
    tenant_name,
    property_name,
  }: RenewalLetterDeclinedNoticeParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'renewal_letter_declined_landlord_notice',
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: landlord_name },
              { type: 'text', text: tenant_name },
              { type: 'text', text: property_name },
            ],
          },
        ],
      },
    };
    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Notify landlord that the tenant accepted the renewal letter.
   * Template: renewal_letter_accepted_landlord_notice
   */
  async sendRenewalLetterAcceptedNotice({
    phone_number,
    landlord_name,
    tenant_name,
    property_name,
  }: RenewalLetterAcceptedNoticeParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'renewal_letter_accepted_landlord_notice',
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: landlord_name },
              { type: 'text', text: tenant_name },
              { type: 'text', text: property_name },
            ],
          },
        ],
      },
    };
    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Deliver the signed renewal-letter PDF to the tenant after they accept
   * or decline. One template, both outcomes — the body flips on the
   * `outcome` verb, the document header carries the same render in either
   * case (with the appropriate ACCEPTED / DECLINED stamp baked in).
   *
   * Template: renewal_letter_signed
   *
   * Body (must be submitted to Meta exactly as below — every variable is
   * wrapped in literal text on both sides per the project rule that Meta
   * rejects templates with leading/trailing variables):
   *
   *   Hi {{1}},
   *
   *   Your renewal letter for *{{2}}* has been *{{3}}* on {{4}}.
   *
   *   The signed copy is attached above for your records.
   *
   * Parameters:
   *   {{1}} tenant_first_name  e.g. "Sonia"
   *   {{2}} property_name      e.g. "Sunset Heights — Flat 3B"
   *   {{3}} outcome            "accepted" | "declined" (lower-case verb)
   *   {{4}} decision_date      e.g. "April 27, 2026"
   *
   * Header: DOCUMENT (link) — public Cloudinary URL of the rendered PDF.
   * No buttons (the payment link, when applicable, was already sent by
   * sendRenewalLink in the same accept flow — this template's job is the
   * audit artefact, not the call-to-action).
   */
  async sendRenewalLetterSigned({
    phone_number,
    tenant_first_name,
    property_name,
    outcome,
    decision_date,
    pdf_url,
    pdf_filename,
  }: RenewalLetterSignedParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'renewal_letter_signed',
        language: { code: 'en' },
        components: [
          {
            type: 'header',
            parameters: [
              {
                type: 'document',
                document: { link: pdf_url, filename: pdf_filename },
              },
            ],
          },
          {
            type: 'body',
            parameters: [
              { type: 'text', text: tenant_first_name },
              { type: 'text', text: property_name },
              { type: 'text', text: outcome },
              { type: 'text', text: decision_date },
            ],
          },
        ],
      },
    };
    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send outstanding balance invoice link to tenant
   * Template: outstanding_balance_link
   */
  async sendOutstandingBalanceLink({
    phone_number,
    tenant_name,
    renewal_token,
    frontend_url: _frontend_url,
  }: RenewalLinkParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'outstanding_balance_link',
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
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [
              {
                type: 'text',
                text: renewal_token,
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send renewal payment confirmation to tenant
   * Requirements: 7.1, 7.3
   * Template: renewal_payment_tenant
   */
  async sendRenewalPaymentTenant({
    phone_number,
    tenant_name,
    amount,
    property_name,
    receipt_token,
    period_start,
    period_end,
    rent_amount,
    service_charge,
    payment_frequency,
  }: RenewalPaymentTenantParams): Promise<void> {
    const simulatorMode = this.config.get('WHATSAPP_SIMULATOR');
    const isSimulationMode = this.validateSimulationMode(simulatorMode);

    const filename = this.renewalPDFService.generateReceiptFilename(
      property_name,
    );

    // In simulator mode, skip Puppeteer + Meta media upload entirely.
    // The frontend simulator renders a placeholder card from the stub id.
    const mediaId = isSimulationMode
      ? `sim_media_${Date.now()}`
      : await (async () => {
          const pdfBuffer =
            await this.renewalPDFService.generateRenewalReceiptPDF(
              receipt_token,
            );
          return this.uploadDocumentToMeta(pdfBuffer, filename);
        })();

    const formatPeriodDate = (d: string | Date): string =>
      new Date(d).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });

    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'renewal_payment_tenant',
        language: {
          code: 'en',
        },
        components: [
          {
            type: 'header',
            parameters: [
              {
                type: 'document',
                document: { id: mediaId, filename },
              },
            ],
          },
          {
            type: 'body',
            parameters: [
              { type: 'text', text: tenant_name },
              { type: 'text', text: `₦${amount.toLocaleString()}` },
              { type: 'text', text: property_name },
              { type: 'text', text: formatPeriodDate(period_start) },
              { type: 'text', text: formatPeriodDate(period_end) },
              { type: 'text', text: `₦${rent_amount.toLocaleString()}` },
              { type: 'text', text: payment_frequency },
              { type: 'text', text: `₦${service_charge.toLocaleString()}` },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Upload a document (PDF) buffer to Meta's media endpoint and return the
   * resulting media_id. Valid for 30 days on Meta's side.
   *
   * Gotchas baked in:
   *  - Form field order: `messaging_product`, then `type`, then `file` last.
   *    undici/native-fetch FormData is order-sensitive.
   *  - `type` must be the MIME string, not shorthand.
   *  - The Blob's filename is what Meta stores; the recipient-facing filename
   *    is set separately in the template `document` parameter.
   *  - One-shot upload fits PDFs up to 100MB — don't use /uploads (Flows only).
   */
  private async uploadDocumentToMeta(
    buffer: Buffer,
    filename: string,
  ): Promise<string> {
    const phoneNumberId = this.config.get('WA_PHONE_NUMBER_ID');
    const accessToken = this.config.get('CLOUD_API_ACCESS_TOKEN');

    if (!phoneNumberId) {
      throw new Error(
        'WhatsApp phone number ID (WA_PHONE_NUMBER_ID) is not configured.',
      );
    }
    if (!accessToken) {
      throw new Error(
        'WhatsApp access token (CLOUD_API_ACCESS_TOKEN) is not configured.',
      );
    }

    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', 'application/pdf');
    form.append(
      'file',
      new Blob([new Uint8Array(buffer)], { type: 'application/pdf' }),
      filename,
    );

    const response = await fetch(
      `https://graph.facebook.com/v19.0/${phoneNumberId}/media`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      },
    );

    const data = (await response.json()) as { id?: string; error?: unknown };

    if (!response.ok || !data.id) {
      throw new Error(
        `Meta media upload failed (${response.status}): ${JSON.stringify(
          data.error ?? data,
        )}`,
      );
    }

    return data.id;
  }

  /**
   * Send renewal payment notification to landlord
   * Requirements: 7.2, 7.4
   * Template: renewal_payment_landlord
   */
  async sendRenewalPaymentLandlord({
    phone_number,
    landlord_name,
    tenant_name,
    amount,
    property_name,
  }: RenewalPaymentLandlordParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'renewal_payment_landlord',
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
   * Send outstanding balance payment notification to tenant
   * Template: outstanding_balance_paid_tenant
   */
  async sendOutstandingBalancePaidTenant({
    phone_number,
    tenant_name,
    amount,
    property_name,
    remaining_balance,
  }: OutstandingBalancePaidTenantParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'outstanding_balance_paid_tenant',
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
              {
                type: 'text',
                text: `₦${remaining_balance.toLocaleString()}`,
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send outstanding balance payment notification to landlord
   * Template: outstanding_balance_paid_landlord
   */
  async sendOutstandingBalancePaidLandlord({
    phone_number,
    landlord_name,
    tenant_name,
    amount,
    property_name,
    remaining_balance,
  }: OutstandingBalancePaidLandlordParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'outstanding_balance_paid_landlord',
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
                text: `₦${remaining_balance.toLocaleString()}`,
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send full renewal payment notification to landlord (OB cleared + tenancy renewed)
   * Template: full_renewal_payment_landlord
   */
  async sendFullRenewalPaymentLandlord({
    phone_number,
    landlord_name,
    tenant_name,
    amount,
    property_name,
  }: FullRenewalPaymentLandlordParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'full_renewal_payment_landlord',
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
      Math.random().toString(36).substring(2, 11);

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
   * Send rent reminder template to tenant via WhatsApp
   * Requirements: 1.2
   */
  async sendRentReminderTemplate({
    phone_number,
    tenant_name,
    property_name,
    rent_amount,
    expiry_date,
  }: RentReminderParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'rent_reminders',
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
                text: expiry_date,
              },
              {
                type: 'text',
                text: rent_amount,
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send rent reminder with renewal link template to tenant via WhatsApp.
   * Used for the last 3 days before rent expiry.
   * Template: rent_reminder_with_renewal
   */
  async sendRentReminderWithRenewalTemplate({
    phone_number,
    tenant_name,
    property_name,
    rent_amount,
    expiry_date,
    renewal_token,
    frontend_url: _frontend_url,
    payment_frequency,
  }: RentReminderWithRenewalParams): Promise<void> {
    // Map payment frequency to period text
    const getPeriodText = (frequency: string): string => {
      switch (frequency?.toLowerCase()) {
        case 'monthly':
          return "month's";
        case 'quarterly':
          return "quarter's";
        case 'bi-annually':
          return "half-year's";
        case 'annually':
          return "year's";
        default:
          return '';
      }
    };

    const periodText = getPeriodText(payment_frequency);

    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'rent_reminder_with_renewal',
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
                text: periodText,
              },
              {
                type: 'text',
                text: property_name,
              },
              {
                type: 'text',
                text: expiry_date,
              },
              {
                type: 'text',
                text: rent_amount,
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
                text: renewal_token,
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send rent overdue reminder with renewal link to tenant via WhatsApp.
   * Used the day after a rent auto-renews but the previous period was unpaid.
   * Template: rent_overdue_with_renewal
   */
  async rent_overdue_with_renewal({
    phone_number,
    tenant_name,
    rent_amount,
    period,
    property_name,
    renewal_token,
    frontend_url: _frontend_url,
  }: RentOverdueWithRenewalParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'rent_overdue_with_renewal',
        language: {
          code: 'en',
        },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: tenant_name },
              { type: 'text', text: rent_amount },
              { type: 'text', text: period },
              { type: 'text', text: property_name },
            ],
          },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [
              {
                type: 'text',
                text: renewal_token,
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send rent overdue reminder template to tenant via WhatsApp
   * Requirements: 1.2
   */
  async sendRentOverdueTemplate({
    phone_number,
    tenant_name,
    property_name,
    rent_amount,
    expiry_date,
  }: RentOverdueParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'rent_overdue',
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
                text: expiry_date,
              },
              {
                type: 'text',
                text: rent_amount,
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send payment plan installment reminder template to tenant via WhatsApp.
   * Fired 1 day before and on the installment due date.
   * Template: installment_reminder
   */
  async sendInstallmentReminderTemplate({
    phone_number,
    tenant_name,
    property_name,
    charge_name,
    installment_label,
    amount,
    due_date,
    pay_token,
  }: InstallmentReminderParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'installment_reminder',
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: tenant_name },
              { type: 'text', text: installment_label },
              { type: 'text', text: charge_name },
              { type: 'text', text: property_name },
              { type: 'text', text: amount },
              { type: 'text', text: due_date },
            ],
          },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [
              {
                type: 'text',
                text: pay_token,
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send installment receipt to tenant after a successful payment.
   * Template: installment_receipt_tenant
   */
  async sendInstallmentReceiptTenant({
    phone_number,
    tenant_name,
    amount,
    charge_name,
    property_name,
    receipt_token,
  }: InstallmentReceiptTenantParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'installment_receipt_tenant',
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: tenant_name },
              { type: 'text', text: `₦${amount.toLocaleString()}` },
              { type: 'text', text: charge_name },
              { type: 'text', text: property_name },
            ],
          },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: receipt_token }],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Notify landlord that an installment was paid.
   * Template: installment_paid_landlord
   */
  async sendInstallmentPaidLandlord({
    phone_number,
    tenant_name,
    installment_label,
    charge_name,
    property_name,
    amount,
  }: InstallmentPaidLandlordParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'installment_paid_landlord',
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: tenant_name },
              { type: 'text', text: installment_label },
              { type: 'text', text: charge_name },
              { type: 'text', text: property_name },
              { type: 'text', text: `₦${amount.toLocaleString()}` },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Notify tenant that their payment plan has been created by the landlord.
   * Same message whether landlord-initiated or from an approved tenant request.
   * Template: payment_plan_created_tenant
   */
  async sendPaymentPlanCreatedTenant({
    phone_number,
    tenant_name,
    charge_name,
    property_name,
    total_amount,
    installments_summary,
    first_installment_id,
  }: PaymentPlanCreatedTenantParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'payment_plan_created_tenant',
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: tenant_name },
              { type: 'text', text: charge_name },
              { type: 'text', text: property_name },
              { type: 'text', text: `₦${total_amount.toLocaleString()}` },
              { type: 'text', text: installments_summary },
            ],
          },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: first_installment_id }],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Congratulate tenant on completing a charge-scope payment plan.
   * Template: payment_plan_completed_tenant
   */
  async sendPaymentPlanCompletedTenant({
    phone_number,
    tenant_name,
    charge_name,
    property_name,
    total_amount,
  }: PaymentPlanCompletedTenantParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'payment_plan_completed_tenant',
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: tenant_name },
              { type: 'text', text: charge_name },
              { type: 'text', text: property_name },
              { type: 'text', text: `₦${total_amount.toLocaleString()}` },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Notify landlord that a tenant completed their payment plan.
   * Template: payment_plan_completed_landlord
   */
  async sendPaymentPlanCompletedLandlord({
    phone_number,
    tenant_name,
    charge_name,
    property_name,
    total_amount,
  }: PaymentPlanCompletedLandlordParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'payment_plan_completed_landlord',
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: tenant_name },
              { type: 'text', text: charge_name },
              { type: 'text', text: property_name },
              { type: 'text', text: `₦${total_amount.toLocaleString()}` },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send ad-hoc invoice pay-link to tenant (on invoice creation).
   * Template: adhoc_invoice_link_tenant
   */
  async sendAdhocInvoiceLinkTenant({
    phone_number,
    tenant_name,
    fees,
    public_token,
  }: AdhocInvoiceLinkTenantParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'adhoc_invoice_link_tenant',
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: tenant_name },
              { type: 'text', text: fees },
            ],
          },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: public_token }],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send ad-hoc invoice receipt link to tenant after payment.
   * Template: adhoc_invoice_paid_tenant
   */
  async sendAdhocInvoicePaidTenant({
    phone_number,
    amount,
    receipt_token,
  }: AdhocInvoicePaidTenantParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'adhoc_invoice_paid_tenant',
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: `₦${amount.toLocaleString()}` },
            ],
          },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: receipt_token }],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Notify landlord that an ad-hoc invoice was paid.
   * Template: adhoc_invoice_paid_landlord
   */
  async sendAdhocInvoicePaidLandlord({
    phone_number,
    tenant_name,
    amount,
    fees,
  }: AdhocInvoicePaidLandlordParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'adhoc_invoice_paid_landlord',
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: tenant_name },
              { type: 'text', text: `₦${amount.toLocaleString()}` },
              { type: 'text', text: fees },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send the submission confirmation to the tenant after they POST a request.
   * Free-form text (we're inside the 24h window — they just navigated here
   * from the WhatsApp link tap).
   */
  async sendPaymentPlanRequestSubmittedTenant({
    phone_number,
    tenant_name,
    property_name,
    total_amount,
    preferred_schedule,
    tenant_note,
  }: PaymentPlanRequestSubmittedTenantParams): Promise<void> {
    const lines = [
      `Hi ${tenant_name}, your payment plan request for ${property_name} has been received.`,
      '',
      `Total due: ₦${total_amount.toLocaleString()}`,
      `Preferred schedule: ${preferred_schedule || 'No preference'}`,
    ];
    if (tenant_note) lines.push(`Note: ${tenant_note}`);
    lines.push('', 'Your landlord will review the request and respond on WhatsApp.');

    await this.sendText(phone_number, lines.join('\n'));
  }

  /**
   * Notify the landlord that a tenant submitted a payment-plan request.
   * Template: payment_plan_request_landlord_notify
   */
  async sendPaymentPlanRequestLandlordNotify({
    phone_number,
    landlord_name,
    tenant_name,
    property_name,
    total_amount,
    preferred_schedule,
    tenant_note,
  }: PaymentPlanRequestLandlordNotifyParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'payment_plan_request_landlord_notify',
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: this.toDisplayName(landlord_name) },
              { type: 'text', text: this.toDisplayName(tenant_name) },
              { type: 'text', text: property_name },
              { type: 'text', text: `₦${total_amount.toLocaleString()}` },
              { type: 'text', text: preferred_schedule || 'No preference' },
              { type: 'text', text: tenant_note || 'No note' },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Notify the tenant that their request was declined.
   * Template: payment_plan_request_declined
   */
  async sendPaymentPlanRequestDeclinedTenant({
    phone_number,
    tenant_name,
    property_name,
    decline_reason,
  }: PaymentPlanRequestDecisionTenantParams): Promise<void> {
    const payload: WhatsAppPayload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'payment_plan_request_declined',
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: tenant_name },
              { type: 'text', text: property_name },
              { type: 'text', text: decline_reason || 'No reason provided' },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  // ----------------------------------------------------------------------
  // Internal API method
  // ----------------------------------------------------------------------
  /**
   * Helper method to extract message type from outbound payload
   */
  private extractPayloadMessageType(payload: WhatsAppPayload): string {
    if (payload.text) return 'text';
    if (payload.interactive) return 'interactive';
    if (payload.template) return 'template';
    return 'unknown';
  }

  // Title-case a DB name for display (e.g. "tunji oginni" -> "Tunji Oginni").
  // Leaves already-capitalized segments alone so "McDonald" / "O'Brien" survive.
  private toDisplayName(name: string): string {
    return (name ?? '')
      .split(/(\s+)/)
      .map((seg) =>
        /^\s+$/.test(seg) || seg === '' || /[A-Z]/.test(seg)
          ? seg
          : seg.charAt(0).toUpperCase() + seg.slice(1),
      )
      .join('');
  }

  /**
   * Map of WhatsApp template names to their exact message bodies from Meta.
   * Uses {{1}}, {{2}}, etc. as placeholders for body parameters.
   */
  private static readonly TEMPLATE_CONTENT_MAP: Record<string, string> = {
    main_menu:
      'Hi {{1}},\n\nYour landlord Panda Homes is now managing your apartment with Lizt by Property Kraft — a platform designed to make renting smooth and stress-free.\n\nWith Lizt, you can:\n\t•\tGet timely rent reminders\n\t•\tView tenancy details\n\t•\tRequest maintenance\n\t•\tAccess important documents\n\t•\tReach support anytime\n\nMore features coming soon: flexible rent payments, loans, and access to a vetted artisan network.\n\nReply "Hi" to get started.\n\n— The Lizt team',
    agent_welcome:
      "Hi, thanks for connecting with Property Kraft!\n\nYou're now plugged in to receive the latest property updates, sweet deals, and housing opportunities directly on WhatsApp. ✨\n\nIn the meantime, you can also visit our website here: https://propertykraft.africa 🌍\n\nStay ahead with Property Kraft! 🚀",
    facility_manager:
      'Hello {{1}},\n\nYou have been added to the {{2}} team as a {{3}}.\nWelcome aboard!',
    properties_created:
      'Hello {{1}}\n\nA new property with name {{2}} was created.\n\nThank you.\n-The Lizt Team',
    user_added:
      'Hello {{1}}\n\n{{2}} was added to your {{3}} property.\nThank you.\n- The Lizt Team',
    tenant_welcome:
      'Hi {{1}},\n\nYour landlord, {{2}}, is using Lizt by Property Kraft — a tenancy management app — to manage {{3}} and make your rental experience smooth and stress-free.\n\nWith Lizt, you can handle everything about your home in one place — from getting important updates, tracking rent, reporting issues easily, and staying connected throughout your tenancy.\n\nReply Hi to get started.\n\n— The Lizt Team',
    welcome_tenant:
      'Hi {{1}},\n\n{{2}} has added you as a tenant for {{3}} on Lizt.\n\nPlease confirm your tenancy details to continue setup.',
    service_request_confirmation:
      'Hi {{1}} 👋🏽\n\nYour service request about "{{2}}" has been marked as resolved.\n\nCan you confirm if everything is fixed?',
    tenant_application_notification:
      'A KYC application was submitted by {{2}} for the property {{3}}, assigned to {{1}}.\n\nUse the link below to view the application.',
    kyc_submission_confirmation:
      "Hello {{1}}, Your KYC form has been submitted. The landlord is reviewing your details, and we'll keep you updated.",
    agent_kyc_notification:
      'Hi {{1}},\n\n{{2}} has listed you as their agent and has just completed their KYC form for {{3}}\n\nThank you',
    landlord_service_request_notification:
      'Service Request Notification\n\nA new service request has been created.\n\nIssue: {{3}}\nTenant: {{1}}\nProperty: {{2}}\nReported: {{4}} on record.',
    fm_service_request_notification:
      'A new service request has been created.\n\nIssue: {{3}}\nTenant: {{1}}\nPhone: {{5}}\nProperty: {{2}}\nReported: {{4}} on record.',
    kyc_completion_link:
      'Hello {{1}},\n\n{{2}} has added you as a tenant for {{3}} using Lizt by Property Kraft — a tenancy management app designed to make your rental experience simple and stress-free.\n\nWith Lizt, you can receive important updates, track rent, and manage everything about your tenancy in one place.\n\nPlease {{4}} your KYC information using the link below to get started:',
    kyc_completion_notification:
      'Hello {{1}}, {{2}} has completed their KYC information for {{3}}.\n\nYou can now view their full tenant details.',
    offer_letter_notification:
      'Hello {{1}}, you have received an offer letter for {{2}}.\n\nPlease review and respond.',
    offer_letter_otp:
      '{{1}} is your verification code.\nExpires in 10 minutes.',
    kyc_otp_verification:
      '{{1}} is your verification code. For your security, do not share this code.\nExpires in 10 minutes.',
    offer_letter_status_notification:
      'Hi {{1}}, {{2}} has {{4}} your offer letter for {{3}}.\n\nLog in to your dashboard to view details and take next steps.',
    payment_invoice_link:
      'Hi {{1}}, your offer for {{2}} has been accepted successfully.\n\nAn invoice has been prepared for you. Please complete your payment to secure the property and proceed with your tenancy.',
    landlord_partial_payment:
      'Hello {{1}}, {{2}} has made a payment of {{3}} for {{4}}.\n\nOutstanding balance: {{5}}. View details in your dashboard.',
    ll_payment_complete:
      'Hello {{1}}, {{2}} has completed their full payment of {{3}} for {{4}}.\n\nThank you',
    tenant_payment_success:
      'Hi {{1}},\n\nCongratulations! Your payment of {{2}} for {{3}} has been confirmed.\n\nYou can view your receipt below:\n\nYour landlord, {{4}}, uses Lizt by Property Kraft — a simple app designed to make your rental experience smooth and stress-free.\n\nWith Lizt, you can receive important updates, track rent, report issues easily, and stay connected throughout your tenancy — all in one place.\n\nReply Hi to get started.\n\n— The Lizt Team',
    ll_payment_race:
      'Hello {{1}}, {{2}} completed payment of {{3}} for {{4}}, but the property was already secured by another tenant.\n\nThe payment is being held. Please process a refund through your dashboard.',
    tenant_payment_race:
      'Hello {{1}}, your payment of {{2}} for {{3}} was received, but the property was secured by another applicant moments earlier.\n\nYour payment is being held and the landlord will process your refund shortly.\n\nWe apologize for this situation.',
    invoice_reminder:
      'Hi {{1}}, this is a reminder from {{2}} regarding invoice {{3}}. Outstanding balance: {{4}} for {{5}}.',
    landlord_main_menu: 'Hello {{1}}, What do you want to do today?',
    outstanding_balance_link:
      'Hi {{1}},\n\nPlease click the button below to view your invoice and make payment for your outstanding balance.',
    renewal_link:
      'Hi {{1}}, your landlord has initiated a tenancy renewal.\n\nPlease use the link below to view your renewal invoice and complete payment.',
    renewal_letter_link:
      'Hi {{1}}, your landlord {{3}} has prepared a renewal offer for {{2}}. Tap below to review and accept it.',
    renewal_letter_signed:
      'Hi {{1}},\n\nYour renewal letter for *{{2}}* has been *{{3}}* on {{4}}.\n\nThe signed copy is attached above for your records.',
    renewal_letter_declined_landlord_notice:
      'Hi {{1}}, {{2}} has declined the renewal offer for {{3}}. Open your Lizt dashboard to decide whether to revise the offer or market the unit.',
    renewal_payment_tenant:
      'Congratulations {{1}}!\n\nYour renewal payment of {{2}} for {{3}} has been confirmed.\n\nHere are your updated tenancy details:\nTenancy period: {{4}} - {{5}}\nRent amount: {{6}} {{7}}\nService charge: {{8}}\n\nYour receipt is attached above.',
    renewal_payment_landlord:
      'Hello {{1}}, {{2}} has completed their renewal payment of {{3}} for {{4}}.\n\nThank you.',
    renewal_receipt:
      'Hi {{1}}, your payment of {{2}} for {{3}} has been received successfully.\n\nYour receipt is ready: {{4}}\n\nThank you for your payment!',
    rent_reminders:
      'Hi {{1}},\n\nThis is a friendly reminder that your rent for {{2}} is due on {{3}}.\n\nAmount due: {{4}}\n\nThank you.',
    rent_reminder_with_renewal:
      'Hi {{1}},\n\nThis is a friendly reminder that your next {{2}} rent for {{3}} is due on {{4}}.\n\nAmount due: {{5}}\n\nPlease use the link below to view your invoice and complete your payment.',
    rent_overdue:
      'Hi {{1}},\n\nYour rent for {{2}} was due on {{3}} and is now overdue.\n\nAmount due: {{4}}\n\nPlease make payment as soon as possible to avoid additional charges.\n\nThank you for your prompt attention to this matter.',
    installment_reminder:
      'Hi {{1}},\n\nThis is a reminder for installment {{2}} of your {{3}} payment plan at {{4}}.\n\nAmount: {{5}}\nDue date: {{6}}\n\nPlease use the link below to complete your payment.',
    installment_receipt_tenant:
      'Hi {{1}}, your installment payment of {{2}} for {{3}} at {{4}} has been received.\n\nClick the button below to view your receipt.',
    installment_paid_landlord:
      'Your tenant {{1}} has just paid installment {{2}} for {{3}} at {{4}}.\n\nAmount received: {{5}}.\n\nThe payment has been recorded and the tenant balance has been updated automatically on your dashboard.',
    payment_plan_created_tenant:
      'Hi {{1}},\n\nYour payment plan for {{2}} at {{3}} has been created by your landlord.\n\nTotal: {{4}}\nNumber of installments: {{5}}\n\nTap the button below to view your full plan and pay.',
    payment_plan_completed_tenant:
      'Congratulations {{1}}! You have completed your {{2}} payment plan at {{3}}.\n\nTotal paid: {{4}}. Thank you.',
    payment_plan_completed_landlord:
      'Your tenant {{1}} has just completed their {{2}} payment plan at {{3}}.\n\nTotal received across all installments: {{4}}.\n\nThe plan has been closed automatically and no further reminders will be sent.',
    adhoc_invoice_link_tenant:
      'Hi {{1}},\n\nA new invoice for {{2}} has been issued to you.\n\nClick the button below to view the invoice and complete your payment.',
    adhoc_invoice_paid_tenant:
      'Your payment of {{1}} has been received. Thank you.\n\nClick the button to view your receipt.',
    adhoc_invoice_paid_landlord:
      'Hi,\n\n{{1}} has made a payment of {{2}} for the invoice of {{3}}.\n\nPlease check your dashboard for the receipt.',
    payment_plan_request_landlord_notify:
      'Hi {{1}},\n\n{{2}} has requested a payment plan for {{3}}.\n\nTotal due: {{4}}\nPreferred schedule: {{5}}\nNote: {{6}}\n\nReview and respond from your dashboard.',
    payment_plan_request_declined:
      'Hi {{1}}, your payment plan request for {{2}} was declined.\n\nReason: {{3}}.\n\nPlease contact your landlord for more info',
  };

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
      const templateName = payload.template.name;
      const bodyParams =
        payload.template.components
          ?.filter((c) => c.type === 'body')
          .flatMap((c) => c.parameters || [])
          .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
          .map((p) => p.text) || [];

      const templateBody =
        TemplateSenderService.TEMPLATE_CONTENT_MAP[templateName];

      if (templateBody) {
        // Replace {{1}}, {{2}}, etc. with actual parameter values
        let content = templateBody;
        bodyParams.forEach((param, index) => {
          content = content.replace(`{{${index + 1}}}`, param);
        });
        return content;
      }

      // Fallback for unknown/new templates
      if (bodyParams.length > 0) {
        return `Template: ${templateName} [${bodyParams.join(', ')}]`;
      }
      return `Template: ${templateName}`;
    }
    return 'Outbound message content';
  }
}
