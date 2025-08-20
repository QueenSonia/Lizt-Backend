"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsappBotService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const config_1 = require("@nestjs/config");
const typeorm_2 = require("typeorm");
const whatsapp_1 = __importDefault(require("whatsapp"));
const user_entity_1 = require("../users/entities/user.entity");
const service_request_entity_1 = require("../service-requests/entities/service-request.entity");
const cache_1 = require("../lib/cache");
const flows_1 = require("./flows");
const base_entity_1 = require("../base.entity");
const users_service_1 = require("../users/users.service");
const create_service_request_dto_1 = require("../service-requests/dto/create-service-request.dto");
const utility_service_1 = require("../utils/utility-service");
let WhatsappBotService = class WhatsappBotService {
    usersRepo;
    serviceRequestRepo;
    cache;
    config;
    userService;
    wa = new whatsapp_1.default();
    constructor(usersRepo, serviceRequestRepo, cache, config, userService) {
        this.usersRepo = usersRepo;
        this.serviceRequestRepo = serviceRequestRepo;
        this.cache = cache;
        this.config = config;
        this.userService = userService;
    }
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
                ...flows_1.SCREEN_RESPONSES.WELCOME_SCREEN,
                data: {
                    ...flows_1.SCREEN_RESPONSES.WELCOME_SCREEN.data,
                    is_location_enabled: false,
                    is_date_enabled: false,
                    is_time_enabled: false,
                },
            };
        }
        if (action === 'data_exchange') {
            switch (screen) {
                case 'WELCOME_SCREEN':
                    return { ...flows_1.SCREEN_RESPONSES.SERVICE_REQUEST };
                case 'SERVICE_REQUEST':
                    return { ...flows_1.SCREEN_RESPONSES.REPORT_ISSUE_INPUT };
                case 'REPORT_ISSUE_INPUT':
                    return { ...flows_1.SCREEN_RESPONSES.ISSUE_LOGGED_CONFIRMATION };
                case 'ISSUE_LOGGED_CONFIRMATION':
                    return {
                        ...flows_1.SCREEN_RESPONSES.TERMINAL_SCREEN,
                        ...flows_1.SCREEN_RESPONSES.SUCCESS,
                    };
            }
        }
        console.error('Unhandled request body:', decryptedBody);
        throw new Error('Unhandled endpoint request.');
    }
    async handleMessage(messages) {
        const message = messages[0];
        const from = message?.from;
        if (!from || !message)
            return;
        const userState = await this.cache.get(`service_request_state_${from}`);
        if (message.type === 'text') {
            const text = message.text?.body;
            if (text?.toLowerCase() === 'start flow') {
                this.sendFlow(from);
            }
            if (userState === 'awaiting_description') {
                const user = await this.usersRepo.findOne({
                    where: {
                        phone_number: `+${from}`,
                        accounts: { role: base_entity_1.RolesEnum.TENANT },
                    },
                    relations: ['accounts'],
                });
                if (!user?.accounts?.length) {
                    await this.sendText(from, 'We could not find your tenancy information.');
                    await this.cache.delete(`service_request_state_${from}`);
                    return;
                }
                const tenantData = await this.userService.getTenantAndPropertyInfo(user.accounts[0].id);
                const propertyInfo = tenantData?.property_tenants?.[0];
                if (!propertyInfo) {
                    await this.sendText(from, 'No property found for your account.');
                    await this.cache.delete(`service_request_state_${from}`);
                    return;
                }
                const requestId = utility_service_1.UtilService.generateServiceRequestId();
                const request = this.serviceRequestRepo.create({
                    request_id: requestId,
                    tenant_id: tenantData.id,
                    property_id: propertyInfo.property?.id,
                    tenant_name: tenantData.profile_name,
                    property_name: propertyInfo.property?.name,
                    issue_category: 'service',
                    date_reported: new Date(),
                    description: text,
                    status: create_service_request_dto_1.ServiceRequestStatusEnum.PENDING,
                });
                await this.serviceRequestRepo.save(request);
                await this.sendText(from, '✅ Your service request has been logged.');
                await this.cache.delete(`service_request_state_${from}`);
                return;
            }
            console.log('querying users');
            const user = await this.usersRepo.findOne({
                where: {
                    phone_number: `+${from}`,
                    accounts: { role: base_entity_1.RolesEnum.TENANT },
                },
                relations: ['accounts'],
            });
            console.log('no user here', user);
            if (!user) {
                console.log('no user here');
                await this.sendToAgentWithTemplate(from);
            }
            await this.sendButtons(from, '👋 Welcome to Property Kraft! What would you like to do?', [
                { id: 'service_request', title: 'Make a service request' },
                { id: 'view_tenancy', title: 'View tenancy details' },
                {
                    id: 'view_notices_and_documents',
                    title: 'See notices and documents',
                },
                { id: 'visit_site', title: 'Visit our website' },
            ]);
        }
        if (message.type === 'interactive') {
            const buttonReply = message.interactive?.button_reply;
            if (!buttonReply)
                return;
            switch (buttonReply.id) {
                case 'visit_site':
                    await this.sendText(from, 'Visit our website: https://propertykraft.africa');
                    break;
                case 'view_tenancy':
                    const user = await this.usersRepo.findOne({
                        where: {
                            phone_number: `+${from}`,
                            accounts: { role: base_entity_1.RolesEnum.TENANT },
                        },
                        relations: ['accounts'],
                    });
                    if (!user?.accounts?.length) {
                        await this.sendText(from, 'No tenancy info available.');
                        return;
                    }
                    const accountId = user.accounts[0].id;
                    const tenancy = await this.userService.getTenantAndPropertyInfo(accountId);
                    const properties = tenancy?.property_tenants;
                    if (!properties?.length) {
                        await this.sendText(from, 'No properties found.');
                        return;
                    }
                    await this.sendText(from, 'Here are your properties:');
                    for (const [i, item] of properties.entries()) {
                        const rent = item.property.rents[0];
                        await this.sendText(from, `🏠 Property ${i + 1}: ${item.property.name}
- Rent: ${rent.rental_price}
- Due Date: ${new Date(rent.lease_end_date).toLocaleDateString()}`);
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
                    let service_buttons = [];
                    let response = '📋 Here are your recent maintenance requests:\n';
                    serviceRequests.forEach((req, i) => {
                        service_buttons.push({
                            id: `${req.id}`,
                            title: `${new Date(req.created_at).toLocaleDateString()} - ${req.issue_category} (${req.status})`,
                        });
                    });
                    await this.sendButtons(from, response, service_buttons);
                    break;
                case 'new_service_request':
                    await this.cache.set(`service_request_state_${from}`, 'awaiting_description', 300);
                    await this.sendText(from, 'Please describe the issue you are facing.');
                    break;
                default:
                    await this.sendText(from, '❓ Unknown option selected.');
            }
        }
    }
    async sendWhatsappMessageWithTemplate({ phone_number, template_name, template_language = 'en', template_parameters = [], }) {
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
    async delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    async sendToUserWithTemplate(phone_number, customer_name) {
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
    async sendBulkMessageToCustomer(customer_phone_list, text) {
        const cleanedNumbers = [
            ...new Set(customer_phone_list.map((num) => {
                let normalized = num.replace(/\D/g, '');
                if (!normalized.startsWith('234')) {
                    normalized = '234' + normalized.replace(/^0+/, '');
                }
                return normalized;
            })),
        ];
        const baseDelay = 500;
        const delayStep = 50;
        const delayMs = Math.min(baseDelay + cleanedNumbers.length * delayStep, 2000);
        for (const phone_number of cleanedNumbers) {
            await this.sendText(phone_number, text);
            console.log(`Sent to ${phone_number}, waiting ${delayMs}ms before next...`);
            await this.delay(delayMs);
        }
    }
    async sendText(to, text) {
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
    async sendButtons(to, text = 'Hello, welcome to Property Kraft', buttons) {
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
    async sendCTAButton(to) {
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
    async sendWelcomeMenu(to, name = 'Somto') {
        await this.sendButtons(to, `Hi ${name}, what would you like to do today?`, [
            { id: 'report_issue', title: 'Report an Issue' },
            { id: 'my_details', title: 'View my details' },
        ]);
    }
    async sendFlow(recipientNumber) {
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
    async sendToWhatsappAPI(payload) {
        try {
            const response = await fetch('https://graph.facebook.com/v23.0/746591371864338/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.config.get('CLOUD_API_ACCESS_TOKEN')}`,
                },
                body: JSON.stringify(payload),
            });
            const data = await response.json();
            console.log('Response from WhatsApp API:', data);
        }
        catch (error) {
            console.error('Error sending to WhatsApp API:', error);
        }
    }
};
exports.WhatsappBotService = WhatsappBotService;
exports.WhatsappBotService = WhatsappBotService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(user_entity_1.Users)),
    __param(1, (0, typeorm_1.InjectRepository)(service_request_entity_1.ServiceRequest)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        cache_1.CacheService,
        config_1.ConfigService,
        users_service_1.UsersService])
], WhatsappBotService);
//# sourceMappingURL=whatsapp-bot.service.js.map