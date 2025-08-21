import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';

import WhatsApp from 'whatsapp';
import { Users } from 'src/users/entities/user.entity';
import { ServiceRequest } from 'src/service-requests/entities/service-request.entity';
import { CacheService } from 'src/lib/cache';

import { SCREEN_RESPONSES } from './flows';
import { RolesEnum } from 'src/base.entity';
import { UsersService } from 'src/users/users.service';
import { ServiceRequestStatusEnum } from 'src/service-requests/dto/create-service-request.dto';
import { UtilService } from 'src/utils/utility-service';
import { IncomingMessage } from './utils';

@Injectable()
export class WhatsappBotService {
  private wa = new WhatsApp();

  constructor(
    @InjectRepository(Users)
    private usersRepo: Repository<Users>,

    @InjectRepository(ServiceRequest)
    private readonly serviceRequestRepo: Repository<ServiceRequest>,

    private readonly cache: CacheService,
    private readonly config: ConfigService,
    private readonly userService: UsersService,
  ) {}

  async getNextScreen(decryptedBody) {
    const { screen, data, action } = decryptedBody;

    console.log('Received request body:', decryptedBody);

    if (action === 'ping') {
      return { data: { status: 'active' } };
    }

    if (data?.error) {
      console.warn('Received client error:', data);
      return { data: { acknowledged: true } };
    }

    if (action === 'INIT') {
      return {
        ...SCREEN_RESPONSES.WELCOME_SCREEN,
        data: {
          ...SCREEN_RESPONSES.WELCOME_SCREEN.data,
          is_location_enabled: false,
          is_date_enabled: false,
          is_time_enabled: false,
        },
      };
    }

    if (action === 'data_exchange') {
      switch (screen) {
        case 'WELCOME_SCREEN':
          return { ...SCREEN_RESPONSES.SERVICE_REQUEST };

        case 'SERVICE_REQUEST':
          return { ...SCREEN_RESPONSES.REPORT_ISSUE_INPUT };

        case 'REPORT_ISSUE_INPUT':
          return { ...SCREEN_RESPONSES.ISSUE_LOGGED_CONFIRMATION };

        case 'ISSUE_LOGGED_CONFIRMATION':
          return {
            ...SCREEN_RESPONSES.TERMINAL_SCREEN,
            ...SCREEN_RESPONSES.SUCCESS,
          };
      }
    }

    console.error('Unhandled request body:', decryptedBody);
    throw new Error('Unhandled endpoint request.');
  }

  async handleMessage(messages: IncomingMessage[]) {
    const message = messages[0];
    const from = message?.from;
    if (!from || !message) return;

    const userState = await this.cache.get(`service_request_state_${from}`);

    if (message.type === 'text') {
      const text = message.text?.body;

      if (text?.toLowerCase() === 'start flow') {
        this.sendFlow(from); // Call the send flow logic
      }

      if (userState === 'awaiting_description') {
        const user = await this.usersRepo.findOne({
          where: {
            phone_number: `+${from}`,
            accounts: { role: RolesEnum.TENANT },
          },
          relations: ['accounts'],
        });

        if (!user?.accounts?.length) {
          await this.sendText(
            from,
            'We could not find your tenancy information.',
          );
          await this.cache.delete(`service_request_state_${from}`);
          return;
        }

        const tenantData = await this.userService.getTenantAndPropertyInfo(
          user.accounts[0].id,
        );
        const propertyInfo = tenantData?.property_tenants?.[0];

        if (!propertyInfo) {
          await this.sendText(from, 'No property found for your account.');
          await this.cache.delete(`service_request_state_${from}`);
          return;
        }

        const requestId = UtilService.generateServiceRequestId();

        const request = this.serviceRequestRepo.create({
          request_id: requestId,
          tenant_id: tenantData.id,
          property_id: propertyInfo.property?.id,
          tenant_name: tenantData.profile_name,
          property_name: propertyInfo.property?.name,
          issue_category: 'service',
          date_reported: new Date(),
          description: text,
          status: ServiceRequestStatusEnum.PENDING,
        });

        await this.serviceRequestRepo.save(request);
        await this.sendText(from, '✅ Your service request has been logged.');
        await this.cache.delete(`service_request_state_${from}`);
        return;
      }

      const user = await this.usersRepo.findOne({
        where: {
          phone_number: `+${from}`,
          accounts: { role: RolesEnum.TENANT },
        },
        relations: ['accounts'],
      });

      if (!user) {
        await this.sendToAgentWithTemplate(from);
      }
      await this.sendButtons(
        from,
        '👋 Welcome to Property Kraft! What would you like to do?',
        [
          { id: 'service_request', title: 'Make a service request' },
          { id: 'view_tenancy', title: 'View tenancy details' },
          // {
          //   id: 'view_notices_and_documents',
          //   title: 'See notices and documents',
          // },
          { id: 'visit_site', title: 'Visit our website' },
        ],
      );
    }

    if (message.type === 'interactive') {
      const buttonReply = message.interactive?.button_reply;
      if (!buttonReply) return;

      switch (buttonReply.id) {
        case 'visit_site':
          await this.sendText(
            from,
            'Visit our website: https://propertykraft.africa',
          );
          break;

        case 'view_tenancy':
          const user = await this.usersRepo.findOne({
            where: {
              phone_number: `+${from}`,
              accounts: { role: RolesEnum.TENANT },
            },
            relations: ['accounts'],
          });

          if (!user?.accounts?.length) {
            await this.sendText(from, 'No tenancy info available.');
            return;
          }

          const accountId = user.accounts[0].id;
          const tenancy =
            await this.userService.getTenantAndPropertyInfo(accountId);
          const properties = tenancy?.property_tenants;

          if (!properties?.length) {
            await this.sendText(from, 'No properties found.');
            return;
          }

          await this.sendText(from, 'Here are your properties:');
          for (const [i, item] of properties.entries()) {
            const rent = item.property.rents[0];
            await this.sendText(
              from,
              `🏠 Property ${i + 1}: ${item.property.name}
- Rent: ${rent.rental_price}
- Due Date: ${new Date(rent.lease_end_date).toLocaleDateString()}`,
            );
          }
          break;

        case 'service_request':
          await this.sendButtons(from, '🛠️ What would you like to do?', [
            {
              id: 'new_service_request',
              title: 'Make a New Maintenance Request',
            },
            {
              id: 'view_service_request',
              title: 'View Status of Previous Requests',
            },
          ]);
          break;

        case 'view_service_request':
          const serviceRequests = await this.serviceRequestRepo.find({
            where: { tenant: { user: { phone_number: `+${from}` } } },
            relations: ['tenant'],
          });

          if (!serviceRequests.length) {
            await this.sendText(from, 'You have no service requests.');
            return;
          }

          let service_buttons: any = [];

          let response = '📋 Here are your recent maintenance requests:\n';
          serviceRequests.forEach((req: any, i) => {
            service_buttons.push({
              id: `${req.id}`,
              title: `${new Date(req.created_at).toLocaleDateString()} - ${req.issue_category} (${req.status})`,
            });
          });

          await this.sendButtons(from, response, service_buttons);
          break;

        case 'new_service_request':
          await this.cache.set(
            `service_request_state_${from}`,
            'awaiting_description',
            300,
          );
          await this.sendText(
            from,
            'Please describe the issue you are facing.',
          );
          break;

        default:
          await this.sendText(from, '❓ Unknown option selected.');
      }
    }
  }

  async sendWhatsappMessageWithTemplate({
    phone_number,
    template_name,
    template_language = 'en',
    template_parameters = [],
  }: {
    phone_number: string;
    template_name: string;
    template_language?: string;
    template_parameters?: Array<{
      type: 'text';
      text: string;
      parameter_name?: string;
    }>;
  }) {
    const payload = {
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

  private async delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async sendToUserWithTemplate(phone_number: string, customer_name: string) {
    const payload = {
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

  async sendToAgentWithTemplate(phone_number) {
    const payload = {
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

  async sendBulkMessageToCustomer(customer_phone_list: string[], text: string) {
    // Remove duplicates & clean phone numbers
    const cleanedNumbers = [
      ...new Set(
        customer_phone_list.map((num) => {
          let normalized = num.replace(/\D/g, ''); // Remove non-digits
          if (!normalized.startsWith('234')) {
            normalized = '234' + normalized.replace(/^0+/, ''); // Remove leading 0s
          }
          return normalized;
        }),
      ),
    ];

    // Calculate dynamic delay: at least 500ms, up to 2000ms
    const baseDelay = 500;
    const delayStep = 50; // extra ms per recipient
    const delayMs = Math.min(
      baseDelay + cleanedNumbers.length * delayStep,
      2000,
    );

    for (const phone_number of cleanedNumbers) {
      await this.sendText(phone_number, text);
      console.log(
        `Sent to ${phone_number}, waiting ${delayMs}ms before next...`,
      );
      await this.delay(delayMs);
    }
  }

  async sendText(to: string, text: string) {
    const payload = {
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

  async sendButtons(
    to: string,
    text: string = 'Hello, welcome to Property Kraft',
    buttons: { id: string; title: string }[],
  ) {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text },
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

  async sendCTAButton(to: string) {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: {
          text: 'Check out our website or contact us!',
        },
        action: {
          buttons: [
            {
              type: 'url',
              url: 'https://propertykraft.com',
              title: 'Visit Website',
            },
            {
              type: 'call',
              phone_number: '+2348100000000',
              title: 'Call Us',
            },
          ],
        },
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  async sendWelcomeMenu(to: string, name = 'Somto') {
    await this.sendButtons(to, `Hi ${name}, what would you like to do today?`, [
      { id: 'report_issue', title: 'Report an Issue' },
      { id: 'my_details', title: 'View my details' },
    ]);
  }

  async sendFlow(recipientNumber: string) {
    const payload = {
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
            flow_id: '1435187147817037', // your flow_id
            flow_action: 'navigate',
            flow_message_version: '3',
            flow_cta: 'Not shown in draft mode',
            mode: 'draft',
            // flow_token: 'optional_prefill_token', // optional
            // flow_navigation: {
            //   screen: 'SERVICE_REQUEST', // start screen
            // },
          },
        },
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  private async sendToWhatsappAPI(payload: object) {
    try {
      const response = await fetch(
        'https://graph.facebook.com/v23.0/746591371864338/messages',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.get('CLOUD_API_ACCESS_TOKEN')}`,
          },
          body: JSON.stringify(payload),
        },
      );

      const data = await response.json();
      console.log('Response from WhatsApp API:', data);
    } catch (error) {
      console.error('Error sending to WhatsApp API:', error);
    }
  }
}
