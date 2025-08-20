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
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsersController = void 0;
const openapi = require("@nestjs/swagger");
const common_1 = require("@nestjs/common");
const users_service_1 = require("./users.service");
const create_user_dto_1 = require("./dto/create-user.dto");
const update_user_dto_1 = require("./dto/update-user.dto");
const role_guard_1 = require("../auth/role.guard");
const role_decorator_1 = require("../auth/role.decorator");
const base_entity_1 = require("../base.entity");
const auth_decorator_1 = require("../auth/auth.decorator");
const swagger_1 = require("@nestjs/swagger");
const paginate_dto_1 = require("./dto/paginate.dto");
const platform_express_1 = require("@nestjs/platform-express");
const create_kyc_dto_1 = require("./dto/create-kyc.dto");
const update_kyc_dto_1 = require("./dto/update-kyc.dto");
let UsersController = class UsersController {
    usersService;
    constructor(usersService) {
        this.usersService = usersService;
    }
    async createUser(body, req) {
        try {
            const user_id = req?.user?.id;
            return this.usersService.createUser(body, user_id);
        }
        catch (error) {
            throw error;
        }
    }
    getAllTenants(query) {
        try {
            return this.usersService.getAllTenants(query);
        }
        catch (error) {
            throw error;
        }
    }
    getProfile(req) {
        try {
            const userId = req.query.user_id || req?.user?.id;
            return this.usersService.getAccountById(userId);
        }
        catch (error) {
            throw error;
        }
    }
    getTenantsOfAnAdmin(query, req) {
        try {
            let creator_id = req?.user?.id;
            return this.usersService.getTenantsOfAnAdmin(creator_id, query);
        }
        catch (error) {
            throw error;
        }
    }
    getSingleTenantOfAnAdmin(req) {
        try {
            let tenant_id = req?.params.tenant_id;
            return this.usersService.getSingleTenantOfAnAdmin(tenant_id);
        }
        catch (error) {
            throw error;
        }
    }
    getTenantAndPropertyInfo(req) {
        try {
            return this.usersService.getTenantAndPropertyInfo(req.user.id);
        }
        catch (error) {
            throw error;
        }
    }
    getUserById(id) {
        try {
            return this.usersService.getUserById(id);
        }
        catch (error) {
            throw error;
        }
    }
    async getUserFields(user_id, fields) {
        if (!fields.length) {
            throw new Error('Fields query parameter is required');
        }
        console.log('fields', fields);
        return this.usersService.getUserFields(user_id, fields);
    }
    getAllUsers(query) {
        try {
            return this.usersService.getAllUsers(query);
        }
        catch (error) {
            throw error;
        }
    }
    updateUserById(id, body) {
        try {
            return this.usersService.updateUserById(id, body);
        }
        catch (error) {
            throw error;
        }
    }
    async login(body, res) {
        try {
            return this.usersService.loginUser(body, res);
        }
        catch (error) {
            throw error;
        }
    }
    async logout(res) {
        try {
            return this.usersService.logoutUser(res);
        }
        catch (error) {
            throw error;
        }
    }
    deleteUserById(id) {
        try {
            return this.usersService.deleteUserById(id);
        }
        catch (error) {
            throw error;
        }
    }
    async forgotPassword(body, res) {
        try {
            const { email } = body;
            await this.usersService.forgotPassword(email);
            return res.status(200).json({ message: 'Check your Email' });
        }
        catch (error) {
            return res.status(500).json({ message: 'Internal Server Error' });
        }
    }
    async validateOtp(body, res) {
        try {
            const { otp } = body;
            const response = await this.usersService.validateOtp(otp);
            return res.status(200).json(response);
        }
        catch (error) {
            return res.status(500).json({ message: 'Internal Server Error' });
        }
    }
    async resendOtp(body, res) {
        try {
            const { token } = body;
            const response = await this.usersService.resendOtp(token);
            return res.status(200).json(response);
        }
        catch (error) {
            return res.status(500).json({ message: 'Internal Server Error' });
        }
    }
    async resetPassword(body, res) {
        const { token, newPassword } = body;
        await this.usersService.resetPassword({ token, newPassword }, res);
        return { message: 'Password reset successful' };
    }
    async uploadLogos(files, req) {
        try {
            const userId = req?.user?.id;
            return await this.usersService.uploadLogos(userId, files);
        }
        catch (error) {
            throw error;
        }
    }
    async completeKyc(userId, createKycDto) {
        return this.usersService.createUserKyc(userId, createKycDto);
    }
    async updateKyc(userId, updateKycDto) {
        return this.usersService.update(userId, updateKycDto);
    }
    async createAdmin(createUserDto) {
        return this.usersService.createAdmin(createUserDto);
    }
    async createCustomerRep(createUserDto) {
        return this.usersService.createCustomerRep(createUserDto);
    }
    async getSubAccounts(req) {
        const adminId = req.user.id;
        return this.usersService.getSubAccounts(adminId);
    }
    async switchAccount(id, req, res) {
        const currentAccount = req.user;
        return this.usersService.switchAccount({
            targetAccountId: id,
            currentAccount,
            res,
        });
    }
};
exports.UsersController = UsersController;
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Create User' }),
    (0, swagger_1.ApiBody)({ type: create_user_dto_1.CreateUserDto }),
    (0, swagger_1.ApiCreatedResponse)({ type: create_user_dto_1.CreateUserDto }),
    (0, swagger_1.ApiResponse)({ status: 422, description: 'User with email already exist' }),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.Post)(),
    (0, common_1.UseGuards)(role_guard_1.RoleGuard),
    (0, role_decorator_1.Roles)(base_entity_1.ADMIN_ROLES.ADMIN),
    openapi.ApiResponse({ status: 201, type: require("./entities/account.entity").Account }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_user_dto_1.CreateUserDto, Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "createUser", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Get All Users' }),
    (0, swagger_1.ApiQuery)({ name: 'page', required: false, type: Number }),
    (0, swagger_1.ApiQuery)({ name: 'size', required: false, type: Number }),
    (0, swagger_1.ApiQuery)({ name: 'first_name', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'last_name', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'role', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'email', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'phone_number', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'start_date', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'end_date', required: false, type: String }),
    (0, swagger_1.ApiOkResponse)({
        type: paginate_dto_1.PaginationResponseDto,
        description: 'Paginated list of users',
    }),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, common_1.UseGuards)(role_guard_1.RoleGuard),
    (0, role_decorator_1.Roles)(base_entity_1.ADMIN_ROLES.ADMIN),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.Get)('/tenants'),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "getAllTenants", null);
__decorate([
    (0, common_1.Get)('/profile'),
    openapi.ApiResponse({ status: 200, type: Object }),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "getProfile", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Get Tenants Created By An Admin' }),
    (0, swagger_1.ApiQuery)({ name: 'page', required: false, type: Number }),
    (0, swagger_1.ApiQuery)({ name: 'size', required: false, type: Number }),
    (0, swagger_1.ApiQuery)({ name: 'first_name', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'last_name', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'email', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'phone_number', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'start_date', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'end_date', required: false, type: String }),
    (0, swagger_1.ApiOkResponse)({
        type: paginate_dto_1.PaginationResponseDto,
        description: 'Paginated list of users',
    }),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Get)('tenant-list'),
    (0, common_1.UseGuards)(role_guard_1.RoleGuard),
    (0, role_decorator_1.Roles)(base_entity_1.ADMIN_ROLES.ADMIN),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Query)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "getTenantsOfAnAdmin", null);
__decorate([
    (0, common_1.Get)('tenant-list/:tenant_id'),
    (0, common_1.UseGuards)(role_guard_1.RoleGuard),
    (0, role_decorator_1.Roles)(base_entity_1.ADMIN_ROLES.ADMIN),
    openapi.ApiResponse({ status: 200, type: Object }),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "getSingleTenantOfAnAdmin", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Get Tenant and Property They Occupy' }),
    (0, swagger_1.ApiOkResponse)({ type: create_user_dto_1.CreateUserDto }),
    (0, swagger_1.ApiNotFoundResponse)({ description: 'Tenant not found' }),
    (0, common_1.Get)('tenant-property'),
    openapi.ApiResponse({ status: 200, type: require("./entities/account.entity").Account }),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "getTenantAndPropertyInfo", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Get One User' }),
    (0, swagger_1.ApiOkResponse)({
        type: create_user_dto_1.CreateUserDto,
        description: 'User successfully fetched',
    }),
    (0, swagger_1.ApiNotFoundResponse)({ description: 'User not found' }),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Get)(':id'),
    openapi.ApiResponse({ status: 200, type: Object }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "getUserById", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Get Specific User Fields' }),
    (0, swagger_1.ApiQuery)({
        name: 'fields',
        required: true,
        type: [String],
        description: 'Array of user fields to retrieve',
        example: [
            'id',
            'first_name',
            'last_name',
            'email',
            'phone_number',
            'role',
            'is_verified',
            'logo_urls',
            'creator_id',
            'created_at',
            'updated_at',
        ],
    }),
    (0, swagger_1.ApiOkResponse)({ description: 'User fields retrieved successfully' }),
    (0, swagger_1.ApiNotFoundResponse)({ description: 'User not found' }),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Get)('fields/:user_id'),
    openapi.ApiResponse({ status: 200, type: Object }),
    __param(0, (0, common_1.Param)('user_id', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Query)('fields')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Array]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "getUserFields", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Get All Users' }),
    (0, swagger_1.ApiQuery)({ name: 'page', required: false, type: Number }),
    (0, swagger_1.ApiQuery)({ name: 'size', required: false, type: Number }),
    (0, swagger_1.ApiQuery)({ name: 'first_name', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'last_name', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'role', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'email', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'phone_number', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'start_date', required: false, type: String }),
    (0, swagger_1.ApiQuery)({ name: 'end_date', required: false, type: String }),
    (0, swagger_1.ApiOkResponse)({
        type: paginate_dto_1.PaginationResponseDto,
        description: 'Paginated list of users',
    }),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Get)(),
    (0, common_1.UseGuards)(role_guard_1.RoleGuard),
    (0, role_decorator_1.Roles)(base_entity_1.ADMIN_ROLES.ADMIN),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "getAllUsers", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Update User' }),
    (0, swagger_1.ApiBody)({ type: update_user_dto_1.UpdateUserDto }),
    (0, swagger_1.ApiOkResponse)({ description: 'User successfully updated' }),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Put)(':id'),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_user_dto_1.UpdateUserDto]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "updateUserById", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'User Login' }),
    (0, swagger_1.ApiBody)({ type: create_user_dto_1.LoginDto }),
    (0, swagger_1.ApiResponse)({ status: 200, type: create_user_dto_1.CreateUserDto }),
    (0, swagger_1.ApiNotFoundResponse)({ description: 'User not found' }),
    (0, swagger_1.ApiUnauthorizedResponse)({ description: 'Invalid password' }),
    (0, swagger_1.ApiCookieAuth)('access_token'),
    (0, auth_decorator_1.SkipAuth)(),
    (0, common_1.Post)('login'),
    openapi.ApiResponse({ status: 201 }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_user_dto_1.LoginDto, Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "login", null);
__decorate([
    (0, swagger_1.ApiOperation)({
        summary: 'Logout User',
        description: 'User successfully logged out',
    }),
    (0, swagger_1.ApiOkResponse)(),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, common_1.Post)('logout'),
    (0, auth_decorator_1.SkipAuth)(),
    openapi.ApiResponse({ status: 201 }),
    __param(0, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "logout", null);
__decorate([
    (0, swagger_1.ApiOperation)({
        summary: 'Delete User',
        description: 'User successfully deleted',
    }),
    (0, swagger_1.ApiOkResponse)(),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Delete)(':id'),
    (0, common_1.UseGuards)(role_guard_1.RoleGuard),
    (0, role_decorator_1.Roles)(base_entity_1.ADMIN_ROLES.ADMIN),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id', new common_1.ParseUUIDPipe())),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "deleteUserById", null);
__decorate([
    (0, auth_decorator_1.SkipAuth)(),
    (0, common_1.Post)('forgot-password'),
    openapi.ApiResponse({ status: 201 }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "forgotPassword", null);
__decorate([
    (0, auth_decorator_1.SkipAuth)(),
    (0, common_1.Post)('validate-otp'),
    openapi.ApiResponse({ status: 201 }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "validateOtp", null);
__decorate([
    (0, auth_decorator_1.SkipAuth)(),
    (0, common_1.Post)('resend-otp'),
    openapi.ApiResponse({ status: 201 }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "resendOtp", null);
__decorate([
    (0, auth_decorator_1.SkipAuth)(),
    (0, common_1.Post)('reset-password'),
    openapi.ApiResponse({ status: 201 }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_user_dto_1.ResetDto, Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "resetPassword", null);
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Upload Admin Logos' }),
    (0, swagger_1.ApiConsumes)('multipart/form-data'),
    (0, swagger_1.ApiBody)({ type: create_user_dto_1.UploadLogoDto }),
    (0, swagger_1.ApiOkResponse)({ description: 'Logos uploaded successfully' }),
    (0, swagger_1.ApiBadRequestResponse)(),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Post)('upload-logos'),
    (0, common_1.UseGuards)(role_guard_1.RoleGuard),
    (0, role_decorator_1.Roles)(base_entity_1.ADMIN_ROLES.ADMIN),
    (0, common_1.UseInterceptors)((0, platform_express_1.FilesInterceptor)('logos', 10)),
    openapi.ApiResponse({ status: 201, type: require("./entities/user.entity").Users }),
    __param(0, (0, common_1.UploadedFiles)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Array, Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "uploadLogos", null);
__decorate([
    (0, auth_decorator_1.SkipAuth)(),
    (0, common_1.Post)('complete-kyc/:userId'),
    openapi.ApiResponse({ status: 201, type: require("./entities/kyc.entity").KYC }),
    __param(0, (0, common_1.Param)('userId')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, create_kyc_dto_1.CreateKycDto]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "completeKyc", null);
__decorate([
    (0, auth_decorator_1.SkipAuth)(),
    (0, common_1.Patch)('update-kyc'),
    openapi.ApiResponse({ status: 200, type: require("./entities/kyc.entity").KYC }),
    __param(0, (0, common_1.Param)('userId')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, update_kyc_dto_1.UpdateKycDto]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "updateKyc", null);
__decorate([
    (0, auth_decorator_1.SkipAuth)(),
    (0, common_1.Post)('admin'),
    openapi.ApiResponse({ status: 201, type: Object }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_user_dto_1.CreateAdminDto]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "createAdmin", null);
__decorate([
    (0, auth_decorator_1.SkipAuth)(),
    (0, common_1.Post)('rep'),
    openapi.ApiResponse({ status: 201, type: Object }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_user_dto_1.CreateCustomerRepDto]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "createCustomerRep", null);
__decorate([
    (0, common_1.Get)('sub-accounts'),
    openapi.ApiResponse({ status: 200, type: [require("./entities/account.entity").Account] }),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "getSubAccounts", null);
__decorate([
    (0, common_1.Get)('switch-account/:id'),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "switchAccount", null);
exports.UsersController = UsersController = __decorate([
    (0, swagger_1.ApiTags)('Users'),
    (0, common_1.Controller)('users'),
    __metadata("design:paramtypes", [users_service_1.UsersService])
], UsersController);
//# sourceMappingURL=users.controller.js.map