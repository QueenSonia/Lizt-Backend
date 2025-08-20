"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServiceRequestsController = void 0;
const openapi = require("@nestjs/swagger");
const common_1 = require("@nestjs/common");
const service_requests_service_1 = require("./service-requests.service");
const create_service_request_dto_1 = require("./dto/create-service-request.dto");
const update_service_request_dto_1 = require("./dto/update-service-request.dto");
const swagger_1 = require("@nestjs/swagger");
const paginate_dto_1 = require("./dto/paginate.dto");
const cloudinary_1 = require("../utils/cloudinary");
const platform_express_1 = require("@nestjs/platform-express");
const crypto = __importStar(require("crypto"));
let ServiceRequestsController = class ServiceRequestsController {
    serviceRequestsService;
    fileUploadService;
    constructor(serviceRequestsService, fileUploadService) {
        this.serviceRequestsService = serviceRequestsService;
        this.fileUploadService = fileUploadService;
    }
    async createServiceRequest(body) {
        try {
            return this.serviceRequestsService.createServiceRequest(body);
        }
        catch (error) {
            throw error;
        }
    }
    getAllServiceRequests(query, req) {
        try {
            const user_id = req?.user?.id;
            return this.serviceRequestsService.getAllServiceRequests(user_id, query);
        }
        catch (error) {
            throw error;
        }
    }
    getPendingAndUrgentRequests(query, req) {
        try {
            return this.serviceRequestsService.getPendingAndUrgentRequests(query, req?.user.id);
        }
        catch (error) {
            throw error;
        }
    }
    getServiceRequestByTenant(req) {
        try {
            const status = req?.query?.status || '';
            return this.serviceRequestsService.getServiceRequestByTenant(req?.user.id, status);
        }
        catch (error) {
            throw error;
        }
    }
    getServiceRequestById(id) {
        try {
            return this.serviceRequestsService.getServiceRequestById(id);
        }
        catch (error) {
            throw error;
        }
    }
    async updateServiceRequestById(id, body, files) {
        try {
            if (files?.length) {
                const uploadedUrls = await Promise.all(files.map((file) => this.fileUploadService.uploadFile(file, 'service-requests')));
                body.issue_images = uploadedUrls.map((upload) => upload.secure_url);
            }
            return this.serviceRequestsService.updateServiceRequestById(id, body);
        }
        catch (error) {
            throw error;
        }
    }
    deleteServiceRequestById(id) {
        try {
            return this.serviceRequestsService.deleteServiceRequestById(id);
        }
        catch (error) {
            throw error;
        }
    }
    async handleTawkWebhook(payload, headers, req) {
        try {
            this.validateTawkSignature(req, headers);
            console.log(`Received Tawk webhook: ${payload.event} for chat ${payload.chatId}`);
            console.log('Webhook payload:', JSON.stringify(payload, null, 2));
            if (!payload.event || !payload.chatId || !payload.property?.id) {
                throw new common_1.HttpException('Invalid webhook payload: missing required fields', common_1.HttpStatus.BAD_REQUEST);
            }
            if (this.isSupportedEvent(payload.event)) {
                const serviceRequest = await this.serviceRequestsService.tawkServiceRequest(payload);
                console.log(`Service request created: ${serviceRequest.id} for event: ${payload.event}`);
                return {
                    success: true,
                    serviceRequestId: serviceRequest.id,
                    message: `Service request created successfully for ${payload.event}`,
                    timestamp: new Date().toISOString()
                };
            }
            console.log(`Unsupported event type: ${payload.event}`);
            return {
                success: true,
                message: `Event ${payload.event} received but not processed`,
                timestamp: new Date().toISOString()
            };
        }
        catch (error) {
            console.log('Tawk webhook processing error:', error.stack);
            if (error instanceof common_1.HttpException) {
                throw error;
            }
            throw new common_1.HttpException('Internal server error processing webhook', common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    validateTawkSignature(req, headers) {
        const webhookSecret = process.env.TAWK_WEBHOOK_SECRET;
        if (!webhookSecret) {
            console.log('No TAWK_WEBHOOK_SECRET configured, skipping signature validation');
            return;
        }
        const signature = headers['x-tawk-signature'] || headers['x-hub-signature-256'];
        if (!signature) {
            throw new common_1.HttpException('Missing webhook signature header', common_1.HttpStatus.UNAUTHORIZED);
        }
        const rawBody = req.rawBody || req.body;
        let bodyString;
        if (Buffer.isBuffer(rawBody)) {
            bodyString = rawBody.toString('utf8');
        }
        else if (typeof rawBody === 'string') {
            bodyString = rawBody;
        }
        else {
            bodyString = JSON.stringify(rawBody);
        }
        const expectedSignature = crypto
            .createHmac('sha256', webhookSecret)
            .update(bodyString, 'utf8')
            .digest('hex');
        const formattedExpectedSignature = `sha256=${expectedSignature}`;
        const isValidSignature = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(formattedExpectedSignature));
        if (!isValidSignature) {
            console.log('Invalid Tawk webhook signature');
            throw new common_1.HttpException('Invalid webhook signature', common_1.HttpStatus.UNAUTHORIZED);
        }
        console.log('Tawk webhook signature validated successfully');
    }
    isSupportedEvent(event) {
        return ['chat:start', 'chat:end', 'ticket:create'].includes(event);
    }
    async healthCheck() {
        return {
            status: 'ok',
            service: 'tawk-webhook',
            timestamp: new Date().toISOString()
        };
    }
};
exports.ServiceRequestsController = ServiceRequestsController;
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Create Service Request' }),
    (0, swagger_1.ApiConsumes)('multipart/form-data'),
    (0, swagger_1.ApiBody)({ type: create_service_request_dto_1.CreateServiceRequestDto }),
    (0, swagger_1.ApiCreatedResponse)({ type: create_service_request_dto_1.CreateServiceRequestDto }),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Post)(),
    openapi.ApiResponse({ status: 201, type: require("./dto/create-service-request.dto").CreateServiceRequestDto }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_service_request_dto_1.CreateServiceRequestDto]),
    __metadata("design:returntype", Promise)
], ServiceRequestsController.prototype, "createServiceRequest", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Get All Service Requests' }),
    (0, swagger_1.ApiQuery)({ name: 'page', required: false, type: Number }),
    (0, swagger_1.ApiQuery)({ name: 'size', required: false, type: Number }),
    (0, swagger_1.ApiQuery)({ name: 'tenant_id', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'property_id', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'status', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'start_date', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'end_date', required: false, type: String }),
    (0, swagger_1.ApiOkResponse)({
        type: paginate_dto_1.PaginationResponseDto,
        description: 'Paginated list of service requests',
    }),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Get)(),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_service_request_dto_1.ServiceRequestFilter, Object]),
    __metadata("design:returntype", void 0)
], ServiceRequestsController.prototype, "getAllServiceRequests", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Get Pending and Urgent Requests' }),
    (0, swagger_1.ApiQuery)({ name: 'page', required: false, type: Number }),
    (0, swagger_1.ApiQuery)({ name: 'size', required: false, type: Number }),
    (0, swagger_1.ApiOkResponse)({
        type: paginate_dto_1.PaginationResponseDto,
        description: 'Paginated list of service requests',
    }),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Get)('pending-urgent'),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_service_request_dto_1.ServiceRequestFilter, Object]),
    __metadata("design:returntype", void 0)
], ServiceRequestsController.prototype, "getPendingAndUrgentRequests", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Get One Service Request' }),
    (0, swagger_1.ApiOkResponse)({
        type: create_service_request_dto_1.CreateServiceRequestDto,
        description: 'Service request successfully fetched',
    }),
    (0, swagger_1.ApiNotFoundResponse)({ description: 'Service request not found' }),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Get)('/tenant'),
    openapi.ApiResponse({ status: 200, type: [require("./entities/service-request.entity").ServiceRequest] }),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], ServiceRequestsController.prototype, "getServiceRequestByTenant", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Get One Service Request' }),
    (0, swagger_1.ApiOkResponse)({
        type: create_service_request_dto_1.CreateServiceRequestDto,
        description: 'Service request successfully fetched',
    }),
    (0, swagger_1.ApiNotFoundResponse)({ description: 'Service request not found' }),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Get)(':id'),
    openapi.ApiResponse({ status: 200, type: require("./dto/create-service-request.dto").CreateServiceRequestDto }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ServiceRequestsController.prototype, "getServiceRequestById", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Update Service Request' }),
    (0, swagger_1.ApiConsumes)('multipart/form-data'),
    (0, swagger_1.ApiBody)({ type: update_service_request_dto_1.UpdateServiceRequestResponseDto }),
    (0, swagger_1.ApiOkResponse)({ description: 'Service request successfully updated' }),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Put)(':id'),
    (0, common_1.UseInterceptors)((0, platform_express_1.FilesInterceptor)('issue_images', 20)),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.UploadedFiles)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_service_request_dto_1.UpdateServiceRequestResponseDto,
        Array]),
    __metadata("design:returntype", Promise)
], ServiceRequestsController.prototype, "updateServiceRequestById", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Delete Service Request' }),
    (0, swagger_1.ApiOkResponse)(),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Delete)(':id'),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ServiceRequestsController.prototype, "deleteServiceRequestById", null);
__decorate([
    (0, common_1.Post)('tawk'),
    openapi.ApiResponse({ status: 201, type: Object }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Headers)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], ServiceRequestsController.prototype, "handleTawkWebhook", null);
__decorate([
    (0, common_1.Post)('health'),
    openapi.ApiResponse({ status: 201 }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ServiceRequestsController.prototype, "healthCheck", null);
exports.ServiceRequestsController = ServiceRequestsController = __decorate([
    (0, swagger_1.ApiTags)('Service-Requests'),
    (0, common_1.Controller)('service-requests'),
    __metadata("design:paramtypes", [service_requests_service_1.ServiceRequestsService,
        cloudinary_1.FileUploadService])
], ServiceRequestsController);
//# sourceMappingURL=service-requests.controller.js.map