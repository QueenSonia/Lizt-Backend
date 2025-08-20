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
exports.UsersService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const user_entity_1 = require("./entities/user.entity");
const typeorm_2 = require("typeorm");
const config_1 = require("@nestjs/config");
const auth_service_1 = require("../auth/auth.service");
const base_entity_1 = require("../base.entity");
const utility_service_1 = require("../utils/utility-service");
const email_template_1 = require("../utils/email-template");
const query_filter_1 = require("../filters/query-filter");
const moment_1 = __importDefault(require("moment"));
const config_2 = require("../config");
const create_rent_dto_1 = require("../rents/dto/create-rent.dto");
const rent_entity_1 = require("../rents/entities/rent.entity");
const uuid_1 = require("uuid");
const password_reset_token_entity_1 = require("./entities/password-reset-token.entity");
const property_entity_1 = require("../properties/entities/property.entity");
const property_tenants_entity_1 = require("../properties/entities/property-tenants.entity");
const create_property_dto_1 = require("../properties/dto/create-property.dto");
const property_history_entity_1 = require("../property-history/entities/property-history.entity");
const date_helper_1 = require("../utils/date.helper");
const cloudinary_1 = require("../utils/cloudinary");
const kyc_entity_1 = require("./entities/kyc.entity");
const event_emitter_1 = require("@nestjs/event-emitter");
const account_entity_1 = require("./entities/account.entity");
const twilio_service_1 = require("../whatsapp/services/twilio.service");
const team_entity_1 = require("./entities/team.entity");
const team_member_entity_1 = require("./entities/team-member.entity");
let UsersService = class UsersService {
    usersRepository;
    configService;
    authService;
    passwordResetRepository;
    propertyTenantRepository;
    rentRepository;
    fileUploadService;
    kycRepository;
    eventEmitter;
    accountRepository;
    twilioService;
    teamRepository;
    teamMemberRepository;
    dataSource;
    constructor(usersRepository, configService, authService, passwordResetRepository, propertyTenantRepository, rentRepository, fileUploadService, kycRepository, eventEmitter, accountRepository, twilioService, teamRepository, teamMemberRepository, dataSource) {
        this.usersRepository = usersRepository;
        this.configService = configService;
        this.authService = authService;
        this.passwordResetRepository = passwordResetRepository;
        this.propertyTenantRepository = propertyTenantRepository;
        this.rentRepository = rentRepository;
        this.fileUploadService = fileUploadService;
        this.kycRepository = kycRepository;
        this.eventEmitter = eventEmitter;
        this.accountRepository = accountRepository;
        this.twilioService = twilioService;
        this.teamRepository = teamRepository;
        this.teamMemberRepository = teamMemberRepository;
        this.dataSource = dataSource;
    }
    async createUser(data, creatorId) {
        const { email, phone_number } = data;
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
            const userRole = data?.role
                ? base_entity_1.RolesEnum[data.role.toUpperCase()]
                : base_entity_1.RolesEnum.TENANT;
            let user = await queryRunner.manager.findOne(user_entity_1.Users, { where: { email } });
            if (!user) {
                user = await queryRunner.manager.save(user_entity_1.Users, {
                    email,
                    phone_number,
                    first_name: data.first_name,
                    last_name: data.last_name,
                    creator_id: userRole === base_entity_1.RolesEnum.TENANT ? creatorId : null,
                    gender: data.gender,
                    marital_status: data.marital_status,
                    employment_status: data.employment_status,
                    date_of_birth: data.date_of_birth,
                    state_of_origin: data.state_of_origin,
                    lga: data.lga,
                    nationality: data.nationality,
                    lease_start_date: data.lease_start_date,
                    lease_end_date: data.lease_end_date,
                    property_id: data.property_id,
                    rental_price: data.rental_price,
                    security_deposit: data.security_deposit,
                    service_charge: data.service_charge,
                    employer_name: data.employer_name,
                    job_title: data.job_title,
                    employer_address: data.employer_address,
                    monthly_income: data.monthly_income,
                    work_email: data.work_email,
                    business_name: data.business_name,
                    nature_of_business: data.nature_of_business,
                    business_address: data.business_address,
                    business_monthly_income: data.business_monthly_income,
                    business_website: data.business_website,
                    spouse_full_name: data.spouse_full_name,
                    spouse_phone_number: data.spouse_phone_number,
                    spouse_occupation: data.spouse_occupation,
                    spouse_employer: data.spouse_employer,
                    source_of_funds: data.source_of_funds,
                    monthly_income_estimate: data.monthly_income_estimate,
                });
            }
            const existingAccount = await queryRunner.manager.findOne(account_entity_1.Account, {
                where: { email, role: userRole },
            });
            if (existingAccount) {
                throw new common_1.HttpException(`Account with email: ${email} already exists`, common_1.HttpStatus.UNPROCESSABLE_ENTITY);
            }
            const property = await queryRunner.manager.findOne(property_entity_1.Property, {
                where: { id: data.property_id },
            });
            if (!property?.id) {
                throw new common_1.HttpException(`Property with id: ${data.property_id} not found`, common_1.HttpStatus.NOT_FOUND);
            }
            const hasActiveRent = await queryRunner.manager.exists(rent_entity_1.Rent, {
                where: {
                    property_id: data.property_id,
                    rent_status: create_rent_dto_1.RentStatusEnum.ACTIVE,
                },
            });
            if (hasActiveRent) {
                throw new common_1.HttpException(`Property is already rented out`, common_1.HttpStatus.UNPROCESSABLE_ENTITY);
            }
            const tenantAccount = queryRunner.manager.create(account_entity_1.Account, {
                user,
                creator_id: creatorId,
                email,
                role: userRole,
                profile_name: `${utility_service_1.UtilService.toSentenceCase(user.first_name)} ${utility_service_1.UtilService.toSentenceCase(user.last_name)}`,
                is_verified: false,
            });
            await queryRunner.manager.save(account_entity_1.Account, tenantAccount);
            await queryRunner.manager.save(rent_entity_1.Rent, {
                tenant_id: tenantAccount.id,
                lease_start_date: data.lease_start_date,
                lease_end_date: data.lease_end_date,
                property_id: property.id,
                amount_paid: data.rental_price,
                rental_price: data.rental_price,
                security_deposit: data.security_deposit,
                service_charge: data.service_charge,
                payment_status: create_rent_dto_1.RentPaymentStatusEnum.PAID,
                rent_status: create_rent_dto_1.RentStatusEnum.ACTIVE,
            });
            await Promise.all([
                queryRunner.manager.save(property_tenants_entity_1.PropertyTenant, {
                    property_id: property.id,
                    tenant_id: tenantAccount.id,
                    status: create_property_dto_1.TenantStatusEnum.ACTIVE,
                }),
                queryRunner.manager.update(property_entity_1.Property, property.id, {
                    property_status: create_property_dto_1.PropertyStatusEnum.NOT_VACANT,
                }),
                queryRunner.manager.save(property_history_entity_1.PropertyHistory, {
                    property_id: property.id,
                    tenant_id: tenantAccount.id,
                    move_in_date: date_helper_1.DateService.getStartOfTheDay(new Date()),
                    monthly_rent: data.rental_price,
                    owner_comment: null,
                    tenant_comment: null,
                    move_out_date: null,
                    move_out_reason: null,
                }),
            ]);
            const token = await this.generatePasswordResetToken(tenantAccount.id, queryRunner);
            const resetLink = `${this.configService.get('FRONTEND_URL')}/reset-password?token=${token}`;
            const emailContent = (0, email_template_1.clientSignUpEmailTemplate)(user.first_name, resetLink);
            const whatsappContent = (0, email_template_1.clientSignUpWhatsappTemplate)(user.first_name, resetLink);
            const pandaEmail = this.configService.get('GMAIL_USER');
            await Promise.all([
                utility_service_1.UtilService.sendEmail(email, email_template_1.EmailSubject.WELCOME_EMAIL, emailContent),
                utility_service_1.UtilService.sendEmail(pandaEmail, email_template_1.EmailSubject.WELCOME_EMAIL, emailContent),
                this.twilioService.sendWhatsAppMessage(phone_number, whatsappContent),
            ]);
            await queryRunner.commitTransaction();
            this.eventEmitter.emit('user.added', {
                user_id: property.owner_id,
                property_id: data.property_id,
                property_name: property.name,
                profile_name: tenantAccount.profile_name,
                role: userRole,
            });
            let result = {
                ...tenantAccount,
                password_link: resetLink,
            };
            return result;
        }
        catch (error) {
            await queryRunner.rollbackTransaction();
            console.error('Transaction rolled back due to:', error);
            throw new common_1.HttpException(error?.message || 'An error occurred while creating user', common_1.HttpStatus.UNPROCESSABLE_ENTITY);
        }
        finally {
            await queryRunner.release();
        }
    }
    async createUserOld(data, user_id) {
        const { email, phone_number } = data;
        const emailExist = await this.usersRepository.exists({ where: { email } });
        if (emailExist) {
            throw new common_1.HttpException(`User with email: ${email} already exist`, common_1.HttpStatus.UNPROCESSABLE_ENTITY);
        }
        const queryRunner = this.usersRepository.manager.connection.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
            const userRole = data?.role
                ? base_entity_1.RolesEnum[data?.role.toUpperCase()]
                : base_entity_1.RolesEnum.TENANT;
            const newUser = {
                ...data,
                role: userRole,
                creator_id: userRole === base_entity_1.RolesEnum.TENANT ? user_id : null,
            };
            const createdUser = await queryRunner.manager.save(user_entity_1.Users, newUser);
            if (!createdUser?.id) {
                throw new Error('User ID is missing after creation');
            }
            await queryRunner.manager.save(account_entity_1.Account, {
                role: userRole,
                user: createdUser,
                profile_name: `${createdUser.first_name || 'User'}'s ${userRole} Account`,
            });
            const property = await queryRunner.manager.findOne(property_entity_1.Property, {
                where: {
                    id: data.property_id,
                },
            });
            if (!property?.id) {
                throw new common_1.HttpException(`Property with id: ${data?.property_id} not found`, common_1.HttpStatus.NOT_FOUND);
            }
            const hasActiveRent = await queryRunner.manager.exists(rent_entity_1.Rent, {
                where: {
                    property_id: data?.property_id,
                    rent_status: (0, typeorm_2.Not)(create_rent_dto_1.RentStatusEnum.ACTIVE),
                },
            });
            if (hasActiveRent) {
                throw new common_1.HttpException(`Property with id: ${data?.property_id} is already rented`, common_1.HttpStatus.UNPROCESSABLE_ENTITY);
            }
            const rent = {
                tenant_id: createdUser.id,
                lease_start_date: data?.lease_start_date,
                lease_end_date: data?.lease_end_date,
                property_id: property?.id,
                amount_paid: data?.rental_price,
                rental_price: data?.rental_price,
                security_deposit: data?.security_deposit,
                service_charge: data?.service_charge,
                payment_status: create_rent_dto_1.RentPaymentStatusEnum.PAID,
                rent_status: create_rent_dto_1.RentStatusEnum.ACTIVE,
            };
            await queryRunner.manager.save(rent_entity_1.Rent, rent);
            await queryRunner.manager.save(property_tenants_entity_1.PropertyTenant, {
                property_id: property.id,
                tenant_id: createdUser.id,
                status: create_property_dto_1.TenantStatusEnum.ACTIVE,
            });
            await queryRunner.manager.update(property_entity_1.Property, property.id, {
                property_status: create_property_dto_1.PropertyStatusEnum.NOT_VACANT,
            });
            await queryRunner.manager.save(property_history_entity_1.PropertyHistory, {
                property_id: property?.id,
                tenant_id: createdUser?.id,
                move_in_date: date_helper_1.DateService.getStartOfTheDay(new Date()),
                monthly_rent: data?.rental_price,
                owner_comment: null,
                tenant_comment: null,
                move_out_date: null,
                move_out_reason: null,
            });
            await queryRunner.commitTransaction();
            this.eventEmitter.emit('user.added', {
                user_id: property.owner_id,
                property_id: data.property_id,
                property_name: property.name,
                role: createdUser.role,
            });
            return createdUser;
        }
        catch (error) {
            await queryRunner.rollbackTransaction();
            throw new common_1.HttpException(error?.message || 'An error occurred while creating user', common_1.HttpStatus.UNPROCESSABLE_ENTITY);
        }
        finally {
            await queryRunner.release();
        }
    }
    async generatePasswordResetToken(userId, queryRunner) {
        const token = (0, uuid_1.v4)();
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 24);
        const passwordReset = queryRunner.manager.create(password_reset_token_entity_1.PasswordResetToken, {
            id: (0, uuid_1.v4)(),
            user_id: userId,
            token,
            expires_at: expiresAt,
        });
        await queryRunner.manager.save(password_reset_token_entity_1.PasswordResetToken, passwordReset);
        return token;
    }
    async getAllUsers(queryParams) {
        const page = queryParams?.page
            ? Number(queryParams?.page)
            : config_2.config.DEFAULT_PAGE_NO;
        const size = queryParams?.size
            ? Number(queryParams.size)
            : config_2.config.DEFAULT_PER_PAGE;
        const skip = (page - 1) * size;
        const query = await (0, query_filter_1.buildUserFilter)(queryParams);
        const [users, count] = await this.usersRepository.findAndCount({
            where: query,
            skip,
            take: size,
            order: { created_at: 'DESC' },
            relations: ['property_tenants', 'property_tenants.property'],
        });
        const totalPages = Math.ceil(count / size);
        return {
            users,
            pagination: {
                totalRows: count,
                perPage: size,
                currentPage: page,
                totalPages,
                hasNextPage: page < totalPages,
            },
        };
    }
    async getAllTenants(queryParams) {
        const page = queryParams?.page
            ? Number(queryParams?.page)
            : config_2.config.DEFAULT_PAGE_NO;
        const size = queryParams?.size
            ? Number(queryParams.size)
            : config_2.config.DEFAULT_PER_PAGE;
        const skip = (page - 1) * size;
        queryParams.role = base_entity_1.RolesEnum.TENANT;
        const qb = this.usersRepository
            .createQueryBuilder('user')
            .leftJoinAndSelect('user.property_tenants', 'property_tenants')
            .leftJoinAndSelect('property_tenants.property', 'property')
            .leftJoinAndSelect('user.rents', 'rents')
            .where('user.role = :role', { role: base_entity_1.RolesEnum.TENANT.toLowerCase() });
        (0, query_filter_1.buildUserFilterQB)(qb, queryParams);
        qb.orderBy('user.created_at', 'DESC').skip(skip).take(size);
        const [users, count] = await qb.getManyAndCount();
        const totalPages = Math.ceil(count / size);
        return {
            users,
            pagination: {
                totalRows: count,
                perPage: size,
                currentPage: page,
                totalPages,
                hasNextPage: page < totalPages,
            },
        };
    }
    async getUserById(id) {
        const user = await this.usersRepository.findOne({ where: { id } });
        if (!user?.id) {
            throw new common_1.HttpException(`User with id: ${id} not found`, common_1.HttpStatus.NOT_FOUND);
        }
        return user;
    }
    async getAccountById(id) {
        const user = await this.accountRepository.findOne({ where: { id } });
        if (!user?.id) {
            throw new common_1.HttpException(`User with id: ${id} not found`, common_1.HttpStatus.NOT_FOUND);
        }
        return user;
    }
    async getUserFields(user_id, fields) {
        const selectFields = fields.reduce((acc, field) => {
            acc[field] = true;
            return acc;
        }, {});
        const user = await this.usersRepository.findOne({
            where: { id: user_id },
            select: selectFields,
        });
        if (!user) {
            throw new common_1.HttpException(`User with id: ${user_id} not found`, common_1.HttpStatus.NOT_FOUND);
        }
        return user;
    }
    async updateUserById(id, data) {
        const account = await this.accountRepository.findOne({
            where: { id },
        });
        if (!account?.id) {
            throw new common_1.NotFoundException(`Account with userId: ${id} not found`);
        }
        await this.accountRepository.update(account.id, {
            profile_name: `${data.first_name} ${data.last_name}`,
        });
        return this.usersRepository.update(account.userId, data);
    }
    async deleteUserById(id) {
        return this.usersRepository.delete(id);
    }
    async loginUser(data, res) {
        const { email, password } = data;
        const [adminAccount, tenantAccount, repAccount] = await Promise.all([
            this.accountRepository.findOne({
                where: { email, role: base_entity_1.RolesEnum.ADMIN },
                relations: ['user'],
            }),
            this.accountRepository.findOne({
                where: { email, role: base_entity_1.RolesEnum.TENANT },
                relations: ['user'],
            }),
            this.accountRepository.findOne({
                where: { email, role: base_entity_1.RolesEnum.REP },
                relations: ['user'],
            }),
        ]);
        if (!tenantAccount && !adminAccount && !repAccount) {
            throw new common_1.NotFoundException(`User with email: ${email} not found`);
        }
        if (!tenantAccount?.is_verified &&
            !adminAccount?.is_verified &&
            !repAccount?.is_verified) {
            throw new common_1.NotFoundException(`Your account is not verified`);
        }
        const accounts = [adminAccount, tenantAccount, repAccount].filter(Boolean);
        let matchedAccount = null;
        for (const account of accounts) {
            if (account.password) {
                const isPasswordValid = await utility_service_1.UtilService.validatePassword(password, account.password);
                if (isPasswordValid) {
                    matchedAccount = account;
                    break;
                }
            }
        }
        if (!matchedAccount) {
            throw new common_1.UnauthorizedException('Invalid password');
        }
        const account = matchedAccount;
        let related_accounts = [];
        let sub_access_token = null;
        let parent_access_token = null;
        if (account.role === base_entity_1.RolesEnum.ADMIN) {
            let subAccount = (await this.accountRepository.findOne({
                where: {
                    id: (0, typeorm_2.Not)(account.id),
                    email: account.email,
                    role: base_entity_1.RolesEnum.TENANT,
                },
                relations: ['user', 'property_tenants'],
            }));
            if (subAccount) {
                const subTokenPayload = {
                    id: subAccount.id,
                    first_name: subAccount.user.first_name,
                    last_name: subAccount.user.last_name,
                    email: subAccount.email,
                    phone_number: subAccount.user.phone_number,
                    property_id: subAccount.property_tenants[0]?.property_id,
                    role: subAccount.role,
                };
                sub_access_token =
                    await this.authService.generateToken(subTokenPayload);
            }
        }
        if (account.role === base_entity_1.RolesEnum.TENANT) {
            let parentAccount = (await this.accountRepository.findOne({
                where: {
                    id: (0, typeorm_2.Not)(account.id),
                    email: account.email,
                    role: base_entity_1.RolesEnum.ADMIN,
                },
                relations: ['user', 'property_tenants'],
            }));
            if (parentAccount) {
                const subTokenPayload = {
                    id: parentAccount.id,
                    first_name: parentAccount.user.first_name,
                    last_name: parentAccount.user.last_name,
                    email: parentAccount.email,
                    phone_number: parentAccount.user.phone_number,
                    property_id: parentAccount.property_tenants[0]?.property_id,
                    role: parentAccount.role,
                };
                parent_access_token =
                    await this.authService.generateToken(subTokenPayload);
            }
        }
        const tokenPayload = {
            id: account.id,
            first_name: account.user.first_name,
            last_name: account.user.last_name,
            email: account.email,
            phone_number: account.user.phone_number,
            role: account.role,
        };
        const access_token = await this.authService.generateToken(tokenPayload);
        return res.status(common_1.HttpStatus.OK).json({
            user: {
                id: account.id,
                first_name: account.user.first_name,
                last_name: account.user.last_name,
                email: account.email,
                phone_number: account.user.phone_number,
                role: account.role,
                is_verified: account.is_verified,
                logo_urls: account.user.logo_urls,
                creator_id: account.creator_id,
                created_at: account.user.created_at,
                updated_at: account.user.updated_at,
            },
            access_token,
            sub_access_token,
            parent_access_token,
        });
    }
    async loginUserOld(data, res) {
        const { email, password } = data;
        const account = await this.accountRepository.findOne({
            where: { email },
            relations: ['user'],
        });
        if (!account?.id) {
            throw new common_1.NotFoundException(`User with email: ${data.email} not found`);
        }
        if (account?.password) {
            const isPasswordValid = await utility_service_1.UtilService.validatePassword(password, account?.password);
            if (!isPasswordValid) {
                throw new common_1.UnauthorizedException('Invalid password');
            }
        }
        else {
            const hashedPassword = await utility_service_1.UtilService.hashPassword(password);
            await this.accountRepository.update({ email }, { password: hashedPassword, is_verified: true });
        }
        const userObject = {};
        if (account?.role === base_entity_1.RolesEnum.TENANT) {
            const findTenantProperty = await this.propertyTenantRepository.findOne({
                where: {
                    tenant_id: account.id,
                },
            });
            userObject['property_id'] = findTenantProperty?.property_id;
        }
        const tokenData = {
            id: account?.id,
            first_name: account.user.first_name,
            last_name: account.user.last_name,
            email: account.email,
            phone_number: account.user.phone_number,
            role: account.role,
        };
        const access_token = await this.authService.generateToken(tokenData);
        res.cookie('access_token', access_token, {
            httpOnly: true,
            secure: this.configService.get('NODE_ENV') === 'production',
            expires: (0, moment_1.default)().add(8, 'hours').toDate(),
            sameSite: 'none',
        });
        return res.status(common_1.HttpStatus.OK).json({
            user: {
                ...userObject,
                id: account?.id,
                first_name: account.user?.first_name,
                last_name: account.user?.last_name,
                email: account?.email,
                phone_number: account.user?.phone_number,
                role: account?.role,
                is_verified: account?.is_verified,
                logo_urls: account.user?.logo_urls,
                creator_id: account.user?.creator_id,
                created_at: account.user?.created_at,
                updated_at: account.user?.updated_at,
            },
            access_token,
            expires_at: (0, moment_1.default)().add(8, 'hours').format(),
        });
    }
    async logoutUser(res) {
        res.clearCookie('access_token', {
            httpOnly: true,
            secure: this.configService.get('NODE_ENV') === 'production',
            sameSite: 'strict',
        });
        return res.status(common_1.HttpStatus.OK).json({
            message: 'Logout successful',
        });
    }
    async getTenantAndPropertyInfo(tenant_id) {
        const tenant = await this.accountRepository.findOne({
            where: {
                id: tenant_id,
                role: base_entity_1.RolesEnum.TENANT,
            },
            relations: [
                'user',
                'property_tenants',
                'property_tenants.property.rents',
            ],
        });
        if (!tenant?.id) {
            throw new common_1.HttpException(`Tenant with id: ${tenant_id} not found`, common_1.HttpStatus.NOT_FOUND);
        }
        return tenant;
    }
    async forgotPassword(email) {
        try {
            const user = await this.accountRepository.findOne({ where: { email } });
            if (!user) {
                throw new common_1.HttpException('User not found', common_1.HttpStatus.NOT_FOUND);
            }
            const otp = utility_service_1.UtilService.generateOTP(6);
            const token = (0, uuid_1.v4)();
            const expires_at = new Date(Date.now() + 1000 * 60 * 5);
            await this.passwordResetRepository.save({
                user_id: user.id,
                token,
                otp,
                expires_at,
            });
            const emailContent = (0, email_template_1.clientForgotPasswordTemplate)(otp);
            await utility_service_1.UtilService.sendEmail(email, email_template_1.EmailSubject.WELCOME_EMAIL, emailContent);
            return {
                message: 'OTP sent to email',
                token,
            };
        }
        catch (error) {
            console.error('[ForgotPassword Error]', error);
            throw new common_1.HttpException('Failed to process forgot password request', common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    async validateOtp(otp) {
        const entry = await this.passwordResetRepository.findOne({
            where: { otp },
        });
        if (!entry || entry.expires_at < new Date()) {
            throw new common_1.HttpException('Invalid or expired OTP', common_1.HttpStatus.BAD_REQUEST);
        }
        return {
            message: 'OTP validated successfully',
            token: entry.token,
        };
    }
    async resendOtp(oldToken) {
        const resetEntry = await this.passwordResetRepository.findOne({
            where: { token: oldToken },
        });
        if (!resetEntry) {
            throw new common_1.HttpException('Invalid token', common_1.HttpStatus.BAD_REQUEST);
        }
        const user = await this.accountRepository.findOne({
            where: { id: resetEntry.user_id },
        });
        if (!user) {
            throw new common_1.HttpException('User not found', common_1.HttpStatus.NOT_FOUND);
        }
        const now = new Date();
        const timeDiff = (resetEntry.expires_at.getTime() - now.getTime()) / 1000;
        if (timeDiff > 840) {
            throw new common_1.HttpException('OTP already sent recently. Please wait a moment before requesting again.', common_1.HttpStatus.TOO_MANY_REQUESTS);
        }
        await this.passwordResetRepository.delete({ id: resetEntry.id });
        const newOtp = utility_service_1.UtilService.generateOTP(6);
        const newToken = (0, uuid_1.v4)();
        const expires_at = new Date(Date.now() + 1000 * 60 * 5);
        await this.passwordResetRepository.save({
            user_id: user.id,
            token: newToken,
            otp: newOtp,
            expires_at,
        });
        const emailContent = (0, email_template_1.clientForgotPasswordTemplate)(newOtp);
        await utility_service_1.UtilService.sendEmail(user.email, email_template_1.EmailSubject.RESEND_OTP, emailContent);
        return {
            message: 'OTP resent successfully',
            token: newToken,
        };
    }
    async resetPassword(payload, res) {
        const { token, newPassword } = payload;
        const resetEntry = await this.passwordResetRepository.findOne({
            where: { token },
        });
        if (!resetEntry) {
            throw new common_1.HttpException('Invalid token', common_1.HttpStatus.BAD_REQUEST);
        }
        if (resetEntry.expires_at < new Date()) {
            await this.passwordResetRepository.delete({ id: resetEntry.id });
            throw new common_1.HttpException('Token has expired', common_1.HttpStatus.BAD_REQUEST);
        }
        const user = await this.accountRepository.findOne({
            where: { id: resetEntry.user_id },
            relations: ['property_tenants'],
        });
        if (!user) {
            throw new common_1.HttpException('User not found', common_1.HttpStatus.NOT_FOUND);
        }
        user.password = await utility_service_1.UtilService.hashPassword(newPassword);
        if (!user.is_verified) {
            user.is_verified = true;
            this.eventEmitter.emit('user.signup', {
                user_id: user.id,
                profile_name: user.profile_name,
                property_id: user.property_tenants[0].property_id,
                role: base_entity_1.RolesEnum.TENANT,
            });
        }
        await this.accountRepository.save(user);
        await this.passwordResetRepository.delete({ id: resetEntry.id });
        return res.status(common_1.HttpStatus.OK).json({
            message: 'Password reset successful',
            user_id: user.id,
        });
    }
    async getTenantsOfAnAdmin(creator_id, queryParams) {
        const page = queryParams?.page ?? config_2.config.DEFAULT_PAGE_NO;
        const size = queryParams?.size ?? config_2.config.DEFAULT_PER_PAGE;
        const skip = (page - 1) * size;
        const extraFilters = await (0, query_filter_1.buildUserFilter)(queryParams);
        const qb = this.accountRepository
            .createQueryBuilder('accounts')
            .leftJoinAndSelect('accounts.user', 'user')
            .leftJoinAndSelect('accounts.rents', 'rents')
            .leftJoinAndSelect('rents.property', 'property')
            .where('accounts.creator_id = :creator_id', { creator_id });
        if (queryParams.sort_by === 'rent' && queryParams?.sort_order) {
            qb.orderBy('rents.rental_price', queryParams.sort_order.toUpperCase());
        }
        else if (queryParams.sort_by === 'date' && queryParams?.sort_order) {
            qb.orderBy('tenant.created_at', queryParams.sort_order.toUpperCase());
        }
        else if (queryParams.sort_by === 'name' && queryParams?.sort_order) {
            qb.orderBy('tenant.profile_name', queryParams.sort_order.toUpperCase());
        }
        else if (queryParams.sort_by === 'property' && queryParams?.sort_order) {
            qb.orderBy('property.name', queryParams.sort_order.toUpperCase());
        }
        else if (queryParams.sort_by && queryParams?.sort_order) {
            qb.orderBy(`property.${queryParams.sort_by}`, queryParams.sort_order.toUpperCase());
        }
        const [users, count] = await qb.skip(skip).take(size).getManyAndCount();
        const totalPages = Math.ceil(count / size);
        return {
            users,
            pagination: {
                totalRows: count,
                perPage: size,
                currentPage: page,
                totalPages,
                hasNextPage: page < totalPages,
            },
        };
    }
    async getSingleTenantOfAnAdmin(tenant_id) {
        const tenant = this.accountRepository
            .createQueryBuilder('accounts')
            .leftJoinAndSelect('accounts.user', 'user')
            .leftJoinAndSelect('accounts.rents', 'rents')
            .leftJoinAndSelect('rents.property', 'property')
            .where('accounts.id = :tenant_id', { tenant_id })
            .getOne();
        if (!tenant) {
            throw new common_1.NotFoundException('Tenant not found');
        }
        return tenant;
    }
    async uploadLogos(userId, files) {
        const user = await this.usersRepository.findOne({
            where: { id: userId, role: base_entity_1.RolesEnum.ADMIN },
        });
        if (!user) {
            throw new common_1.HttpException('Admin not found', common_1.HttpStatus.NOT_FOUND);
        }
        try {
            const uploadedUrls = await Promise.all(files.map((file) => this.fileUploadService.uploadFile(file, 'admin-logos')));
            const updatedUser = await this.usersRepository.save({
                ...user,
                logo_urls: uploadedUrls.map((upload) => upload.secure_url),
            });
            return updatedUser;
        }
        catch (error) {
            throw new common_1.HttpException('Error uploading logos', common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    async createUserKyc(userId, data) {
        const queryRunner = this.accountRepository.manager.connection.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
            const user = await queryRunner.manager.findOne(account_entity_1.Account, {
                where: { id: userId },
                relations: ['kyc'],
            });
            if (!user) {
                throw new common_1.NotFoundException('User not found');
            }
            if (user.kyc) {
                throw new common_1.BadRequestException('KYC already submitted');
            }
            const newKyc = this.kycRepository.create({
                ...data,
                user,
            });
            const savedKyc = await queryRunner.manager.save(kyc_entity_1.KYC, newKyc);
            user.is_verified = true;
            await queryRunner.manager.save(account_entity_1.Account, user);
            await queryRunner.commitTransaction();
            return savedKyc;
        }
        catch (error) {
            await queryRunner.rollbackTransaction();
            throw new common_1.HttpException(error?.message || 'An error occurred while submitting KYC', common_1.HttpStatus.UNPROCESSABLE_ENTITY);
        }
        finally {
            await queryRunner.release();
        }
    }
    async update(userId, updateKycDto) {
        const user = await this.usersRepository.findOne({
            where: { id: userId },
            relations: ['kyc'],
        });
        if (!user || !user.kyc) {
            throw new common_1.NotFoundException('KYC record not found for this user');
        }
        const updatedKyc = this.kycRepository.merge(user.kyc, updateKycDto);
        return this.kycRepository.save(updatedKyc);
    }
    async createAdmin(data) {
        const existingAccount = await this.accountRepository.findOne({
            where: { email: data.email, role: base_entity_1.RolesEnum.ADMIN },
        });
        if (existingAccount) {
            throw new common_1.BadRequestException('Admin Account with this email already exists');
        }
        if (!data.password) {
            throw new common_1.BadRequestException('Password is required');
        }
        let user = await this.usersRepository.findOne({
            where: { phone_number: data.phone_number },
        });
        console.log({ user });
        if (!user) {
            user = await this.usersRepository.save({
                phone_number: data.phone_number,
                first_name: data.first_name,
                last_name: data.last_name,
                role: base_entity_1.RolesEnum.ADMIN,
                is_verified: true,
                email: data.email,
            });
            console.log('user', user);
        }
        const adminAccount = this.accountRepository.create({
            user,
            email: data.email,
            password: await utility_service_1.UtilService.hashPassword(data.password),
            role: base_entity_1.RolesEnum.ADMIN,
            profile_name: `${user.first_name}'s Admin Account`,
            is_verified: true,
        });
        await this.accountRepository.save(adminAccount);
        const { password, ...result } = user;
        return result;
    }
    async createAdminOld(data) {
        const existing = await this.usersRepository.findOne({
            where: { email: data.email },
        });
        if (existing) {
            throw new common_1.BadRequestException('User with this email already exists');
        }
        if (!data.password) {
            throw new common_1.BadRequestException('Password is required');
        }
        const hashedPassword = await utility_service_1.UtilService.hashPassword(data.password);
        const user = this.usersRepository.create({
            ...data,
            role: base_entity_1.RolesEnum.ADMIN,
            password: hashedPassword,
            is_verified: true,
        });
        const savedUser = await this.usersRepository.save(user);
        await this.accountRepository.save({
            role: base_entity_1.RolesEnum.ADMIN,
            user: savedUser,
            profile_name: `${savedUser.first_name}'s Admin Account`,
        });
        const { password, ...result } = savedUser;
        return result;
    }
    async createCustomerRep(data) {
        const queryRunner = this.dataSource.createQueryRunner();
        const existingAccount = await this.accountRepository.findOne({
            where: { email: data.email, role: base_entity_1.RolesEnum.REP },
        });
        if (existingAccount) {
            throw new common_1.BadRequestException('Rep Account with this email already exists');
        }
        let user = await this.usersRepository.findOne({
            where: { email: data.email },
        });
        if (!user) {
            user = await this.usersRepository.save({
                phone_number: data.phone_number,
                first_name: data.first_name,
                last_name: data.last_name,
                role: base_entity_1.RolesEnum.REP,
                is_verified: true,
                email: data.email,
            });
            console.log('user', user);
        }
        const repAccount = this.accountRepository.create({
            user,
            email: data.email,
            password: data.password
                ? await utility_service_1.UtilService.hashPassword(data.password)
                : '',
            role: base_entity_1.RolesEnum.REP,
            profile_name: `${data.first_name} ${data.last_name}`,
            is_verified: true,
        });
        await this.accountRepository.save(repAccount);
        const token = await this.generatePasswordResetToken(repAccount.id, queryRunner);
        const resetLink = `${this.configService.get('FRONTEND_URL')}/reset-password?token=${token}`;
        const emailContent = (0, email_template_1.clientSignUpEmailTemplate)(data.first_name, resetLink);
        await utility_service_1.UtilService.sendEmail(data.email, email_template_1.EmailSubject.WELCOME_EMAIL, emailContent);
        const { password, ...result } = user;
        return result;
    }
    async getSubAccounts(adminId) {
        const subAccounts = await this.accountRepository.find({
            where: {
                creator_id: adminId,
            },
            relations: ['user'],
        });
        return subAccounts;
    }
    async switchAccount({ targetAccountId, currentAccount, res, }) {
        const target = await this.accountRepository.findOne({
            where: { id: targetAccountId },
            relations: ['user'],
        });
        if (!target || target.creator_id !== currentAccount.id) {
            throw new common_1.ForbiddenException('You cannot switch to this account');
        }
        const tokenPayload = {
            id: target.id,
            first_name: target.user.first_name,
            last_name: target.user.last_name,
            email: target.email,
            phone_number: target.user.phone_number,
            role: target.role,
        };
        const access_token = await this.authService.generateToken(tokenPayload);
        res.cookie('access_token', access_token, {
            httpOnly: true,
            secure: this.configService.get('NODE_ENV') === 'production',
            expires: (0, moment_1.default)().add(8, 'hours').toDate(),
            sameSite: 'none',
        });
        return { success: true, message: 'Switched account successfully' };
    }
    async assignCollaboratorToTeam(user_id, team_member) {
        try {
            let team = await this.teamRepository.findOne({
                where: { creator_id: user_id }
            });
            if (!team) {
                const team_admin_account = await this.accountRepository.findOne({
                    where: { id: user_id, role: base_entity_1.RolesEnum.ADMIN }
                });
                if (!team_admin_account) {
                    throw new common_1.HttpException('Team admin account not found', common_1.HttpStatus.NOT_FOUND);
                }
                team = this.teamRepository.create({
                    name: `${team_admin_account.profile_name} Team`,
                    creator_id: team_admin_account.id,
                });
                await this.teamRepository.save(team);
            }
            if (team.creator_id !== user_id) {
                throw new common_1.HttpException('Not authorized to add members to this team', common_1.HttpStatus.FORBIDDEN);
            }
            const new_team_member = this.teamMemberRepository.create({
                email: team_member.email,
                permissions: team_member.permissions,
                team_id: team.id,
                role: team_member.role,
            });
            await this.teamMemberRepository.save(new_team_member);
            return new_team_member;
        }
        catch (error) {
            console.error('Error assigning collaborator to team:', error);
            throw new common_1.HttpException('Could not assign collaborator', common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
};
exports.UsersService = UsersService;
exports.UsersService = UsersService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(user_entity_1.Users)),
    __param(3, (0, typeorm_1.InjectRepository)(password_reset_token_entity_1.PasswordResetToken)),
    __param(4, (0, typeorm_1.InjectRepository)(property_tenants_entity_1.PropertyTenant)),
    __param(5, (0, typeorm_1.InjectRepository)(rent_entity_1.Rent)),
    __param(7, (0, typeorm_1.InjectRepository)(kyc_entity_1.KYC)),
    __param(9, (0, typeorm_1.InjectRepository)(account_entity_1.Account)),
    __param(11, (0, typeorm_1.InjectRepository)(team_entity_1.Team)),
    __param(12, (0, typeorm_1.InjectRepository)(team_member_entity_1.TeamMember)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        config_1.ConfigService,
        auth_service_1.AuthService,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        cloudinary_1.FileUploadService,
        typeorm_2.Repository,
        event_emitter_1.EventEmitter2,
        typeorm_2.Repository,
        twilio_service_1.TwilioService,
        typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.DataSource])
], UsersService);
//# sourceMappingURL=users.service.js.map