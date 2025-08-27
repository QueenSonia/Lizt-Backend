import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ILike, Repository } from 'typeorm';

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
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { ServiceRequestsService } from 'src/service-requests/service-requests.service';

// ✅ Reusable buttons
const MAIN_MENU_BUTTONS = [
  { id: 'service_request', title: 'Make service request' },
  { id: 'view_tenancy', title: 'View tenancy details' },
  { id: 'visit_site', title: 'Visit our website' },
];

@Injectable()
export class WhatsappBotService {
  private wa = new WhatsApp();

  constructor(
    @InjectRepository(Users)
    private usersRepo: Repository<Users>,

    @InjectRepository(ServiceRequest)
    private readonly serviceRequestRepo: Repository<ServiceRequest>,

    @InjectRepository(PropertyTenant)
    private readonly propertyTenantRepo: Repository<PropertyTenant>,

    private readonly serviceRequestService: ServiceRequestsService,
    private readonly cache: CacheService,
    private readonly config: ConfigService,
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

    if (message.type === 'interactive') {
      this.handleInteractive(message, from);
    }

    if (message.type === 'text') {
      this.handleText(message, from);
    }
  }

  async handleText(message: any, from: string) {
    const text = message.text?.body;

    if (text?.toLowerCase() === 'start flow') {
      this.sendFlow(from); // Call the send flow logic
    }

    if (text?.toLowerCase() === 'menu') {
      await this.sendButtons(from, 'Menu Options', [
        { id: 'service_request', title: 'Make service request' },
        { id: 'view_tenancy', title: 'View tenancy details' },
        // {
        //   id: 'view_notices_and_documents',
        //   title: 'See notices and documents',
        // },
        { id: 'visit_site', title: 'Visit our website' },
      ]);
      return;
    }

    if (text.toLowerCase() === 'done') {
      await this.cache.delete(`service_request_state_${from}`);
      await this.sendText(from, 'Thank you!  Your session has ended.');
      return;
    }

    //handle redis cache
    this.cachedResponse(from, text);
  }

  async cachedResponse(from, text) {
    const userState = await this.cache.get(`service_request_state_${from}`);
    const facilityState = await this.cache.get(
      `service_request_state_facility_${from}`,
    );

    if (facilityState === 'acknowledged') {
      const serviceRequest = await this.serviceRequestRepo.findOne({
        where: {
          request_id: text,
        },
        relations: ['tenant', 'facilityManager'],
      });

      if (!serviceRequest) {
        await this.sendText(
          from,
          'No service requests found with that ID. try again',
        );
        await this.cache.delete(`service_request_state_facility_${from}`);
        return;
      }

      serviceRequest.status = ServiceRequestStatusEnum.IN_PROGRESS;
      await this.serviceRequestRepo.save(serviceRequest);
      await this.sendText(
        from,
        `You have acknowledged service request ID: ${text}`,
      );
      await this.sendText(
        UtilService.normalizePhoneNumber(
          serviceRequest.tenant.user.phone_number,
        ),
        `Your service request with ID: ${text} is being processed by ${UtilService.toSentenceCase(serviceRequest.facilityManager.account.profile_name)}.`,
      );
      await this.cache.delete(`service_request_state_facility_${from}`);
    }

    // const facility_manager = await this.usersRepo.findOne({
    //   where: {
    //     phone_number: `+${from}`,
    //     accounts: { role: RolesEnum.FACILITY_MANAGER },
    //   },
    //   relations: ['accounts'],
    // });
    // if (facility_manager) {
    //   await this.sendToAgentWithTemplate(from);
    //   return;
    // }

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

      try {
        const new_service_request =
          await this.serviceRequestService.createServiceRequest({
            tenant_id: user.accounts[0].id,
            text,
          });

        if (new_service_request) {
          const {
            created_at,
            facility_manager_phone,
            facility_manager_name,
            property_name,
            property_location,
            request_id,
          } = new_service_request as any;
          await this.sendText(from, '✅ Your service request has been logged.');
          await this.cache.delete(`service_request_state_${from}`);

          await this.sendText(
            facility_manager_phone,
            `New service request: \n Property:${property_name} \n Address: ${property_location} \n Tenant:  ${UtilService.toSentenceCase(user.first_name)} ${UtilService.toSentenceCase(user.last_name)}  \n Issue: ${text} \n Contact Tenant: ${user.phone_number} \n Time: ${new Date(created_at).toLocaleString()}`,
          );

          await this.sendFacilityServiceRequest({
            phone_number: facility_manager_phone,
            manager_name: facility_manager_name,
            property_name: property_name,
            property_location: property_location,
            service_request: text,
            tenant_name: ` ${UtilService.toSentenceCase(user.first_name)} ${UtilService.toSentenceCase(user.last_name)}`,
            tenant_phone_number: user.phone_number,
            date_created: new Date(created_at).toLocaleDateString(),
          })

          await this.sendButtons(
            facility_manager_phone,
            `Confirm request for request_id: ${request_id}`,
            [
              {
                id: 'acknowledge_request',
                title: 'Acknowledge',
              },
            ],
          );
        }
      } catch (error) {
        await this.sendText(
          from,
          error.message || 'An error occurred while logging your request.',
        );
        await this.cache.delete(`service_request_state_${from}`);
      }

      return;
    } else if (userState === 'view_single_service_request') {
      const serviceRequests = await this.serviceRequestRepo.find({
        where: {
          tenant: { user: { phone_number: `+${from}` } },
          description: ILike(`%${text}%`),
        },
        relations: ['tenant'],
      });

      if (!serviceRequests.length) {
        await this.sendText(
          from,
          'No service requests found matching that description.',
        );
        await this.cache.delete(`service_request_state_${from}`);
        return;
      }

      let response = 'Here are the matching service requests:\n';
      serviceRequests.forEach((req: any, i) => {
        response += `${req.description} (${new Date(req.created_at).toLocaleDateString()}) \n Status: ${req.status}\n Notes: ${req.notes || 'N/A'}\n\n`;
      });

      await this.sendText(from, response);
      await this.cache.delete(`service_request_state_${from}`);

      await this.sendButtons(from, 'back', [
        {
          id: 'service_request',
          title: 'Back to Requests',
        },
      ]);

      return;
    } else {
      const user = await this.usersRepo.findOne({
        where: {
          phone_number: `+${from}`,
          accounts: { role: RolesEnum.TENANT },
        },
        relations: ['accounts'],
      });

      if (!user) {
        await this.sendToAgentWithTemplate(from);
      } else {
        await this.sendButtons(
          from,
          `Hello ${UtilService.toSentenceCase(user.first_name)} Welcome to Property Kraft! What would you like to do today?`,
          [
            { id: 'service_request', title: 'Make service request' },
            { id: 'view_tenancy', title: 'View tenancy details' },
            // {
            //   id: 'view_notices_and_documents',
            //   title: 'See notices and documents',
            // },
            { id: 'visit_site', title: 'Visit our website' },
          ],
        );
      }
    }
  }

  async handleInteractive(message: any, from: string) {
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
        // const tenancy =
        //   await this.userService.getTenantAndPropertyInfo(accountId);

        const properties = await this.propertyTenantRepo.find({
          where: { tenant_id: accountId },
          relations: ['property', 'property.rents'],
        });

        // const properties = tenancy?.property_tenants;

        if (!properties?.length) {
          await this.sendText(from, 'No properties found.');
          return;
        }

        await this.sendText(from, 'Here are your properties:');
        for (const [i, item] of properties.entries()) {
          const rent = item.property.rents[0];
          await this.sendText(
            from,
            `Property ${i + 1}: ${item.property.name}\n Amount: ${rent.rental_price.toLocaleString(
              'en-NG',
              {
                style: 'currency',
                currency: 'NGN',
              },
            )}\n Due Date: ${new Date(rent.lease_end_date).toLocaleDateString()}`,
          );

          await this.cache.set(
            `service_request_state_${from}`,
            'other_options',
            300,
          );
          await this.sendText(
            from,
            'Type "menu" to see other options or "done" to finish.',
          );
        }
        break;

      case 'service_request':
        await this.sendButtons(from, 'What would you like to do?', [
          {
            id: 'new_service_request',
            title: 'New Request',
          },
          {
            id: 'view_service_request',
            title: 'Previous Requests',
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

        let response = 'Here are your recent maintenance requests:\n';
        serviceRequests.forEach((req: any, i) => {
          response += `${new Date(req.created_at).toLocaleDateString()} - \n Description: ${req.description}\n`;
        });

        await this.sendText(from, response);

        await this.cache.set(
          `service_request_state_${from}`,
          'view_single_service_request',
          300,
        );
        await this.sendText(
          from,
          'Type your service request description to view more info on service request or "done" to finish.',
        );
        break;

      case 'new_service_request':
        await this.cache.set(
          `service_request_state_${from}`,
          'awaiting_description',
          300,
        );
        await this.sendText(from, 'Please describe the issue you are facing.');
        break;
      case 'acknowledge_request':
        await this.cache.set(
          `service_request_state_facility_${from}`,
          'acknowledged',
          300,
        );

        await this.sendText(
          from,
          'Please input service_request ID to acknowledge',
        );
        break;

      default:
        await this.sendText(from, '❓ Unknown option selected.');
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
   async sendToFacilityManagerWithTemplate({ phone_number, name, team, role }) {
    const payload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'facility_manager', // Your template name
        language: {
          code: 'en', // must match the language you set in WhatsApp template
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                parameter_name:'name',
                text: name,
              },
              {
                type: 'text',
                 parameter_name:'team',
                text: team,
              },
              {
                type: 'text',
                 parameter_name:'role',
                text: role,
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  async sendFacilityServiceRequest({ phone_number, manager_name, property_name, property_location, service_request, tenant_name, tenant_phone_number, date_created }) {
    const payload = {
      messaging_product: 'whatsapp',
      to: phone_number,
      type: 'template',
      template: {
        name: 'facility_service_request', // Your template name
        language: {
          code: 'en', // must match the language you set in WhatsApp template
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                parameter_name:'manager_name',
                text: manager_name,
              },
              {
                type: 'text',
                parameter_name:'property_name',
                text: property_name,
              },
              {
                type: 'text',
                 parameter_name:'property_location',
                text: property_location,
              },
              {
                type: 'text',
                 parameter_name:'service_request',
                text: service_request,
              },
              {
                type: 'text',
                 parameter_name:'tenant_name',
                text: tenant_name,
              },
              {
                type: 'text',
                 parameter_name:'tenant_phone_number',
                text: tenant_phone_number,
              },
               {
                type: 'text',
                 parameter_name:'date_created',
                text: date_created,
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
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
