import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  forwardRef,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  CreateAdminDto,
  CreateCustomerRepDto,
  CreateLandlordDto,
  CreateTenantDto,
  CreateTenantKycDto,
  CreateUserDto,
  IUser,
  LoginDto,
  UserFilter,
} from './dto/create-user.dto';
import {
  AttachTenantToPropertyDto,
  RentFrequency,
} from './dto/attach-tenant-to-property.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Users } from './entities/user.entity';
import { DataSource, Not, QueryRunner, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { AuthService } from 'src/auth/auth.service';
import { RolesEnum } from 'src/base.entity';
import { UtilService } from 'src/utils/utility-service';
import {
  clientForgotPasswordTemplate,
  clientSignUpEmailTemplate,
  clientSignUpWhatsappTemplate,
  EmailSubject,
} from 'src/utils/email-template';
import { buildUserFilter, buildUserFilterQB } from 'src/filters/query-filter';
import { Response } from 'express';
import moment from 'moment';
import { config } from 'src/config';
import {
  RentPaymentStatusEnum,
  RentStatusEnum,
} from 'src/rents/dto/create-rent.dto';
import { Rent } from 'src/rents/entities/rent.entity';
import { v4 as uuidv4 } from 'uuid';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { Property } from 'src/properties/entities/property.entity';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import {
  PropertyStatusEnum,
  TenantStatusEnum,
} from 'src/properties/dto/create-property.dto';
import { PropertyHistory } from 'src/property-history/entities/property-history.entity';
import { DateService } from 'src/utils/date.helper';
import { FileUploadService } from 'src/utils/cloudinary';
import { KYC } from './entities/kyc.entity';
import { CreateKycDto } from './dto/create-kyc.dto';
import { UpdateKycDto } from './dto/update-kyc.dto';
import bcrypt from 'bcryptjs/umd/types';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Account } from './entities/account.entity';
import { AnyAaaaRecord } from 'node:dns';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { Team } from './entities/team.entity';
import { TeamMember } from './entities/team-member.entity';
import { WhatsappBotService } from 'src/whatsapp-bot/whatsapp-bot.service';
import { CacheService } from 'src/lib/cache';
import { Waitlist } from './entities/waitlist.entity';
import { TenantDetailDto } from 'src/users/dto/tenant-detail.dto';
import { time } from 'node:console';
import { TeamMemberDto } from 'src/users/dto/team-member.dto';
import { KYCApplication } from 'src/kyc-links/entities/kyc-application.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(Users)
    private readonly usersRepository: Repository<Users>,
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
    @InjectRepository(PasswordResetToken)
    private readonly passwordResetRepository: Repository<PasswordResetToken>,
    @InjectRepository(PropertyTenant)
    private readonly propertyTenantRepository: Repository<PropertyTenant>,
    @InjectRepository(Rent)
    private readonly rentRepository: Repository<Rent>,
    private readonly fileUploadService: FileUploadService,
    @InjectRepository(KYC)
    private readonly kycRepository: Repository<KYC>,
    private readonly eventEmitter: EventEmitter2,
    @InjectRepository(Account)
    private accountRepository: Repository<Account>,
    @InjectRepository(Team)
    private readonly teamRepository: Repository<Team>,
    @InjectRepository(TeamMember)
    private readonly teamMemberRepository: Repository<TeamMember>,
    private readonly whatsappBotService: WhatsappBotService,
    @InjectRepository(Waitlist)
    private readonly waitlistRepository: Repository<Waitlist>,
    @InjectRepository(KYCApplication)
    private readonly kycApplicationRepository: Repository<KYCApplication>,
    private readonly cache: CacheService,

    private readonly utilService: UtilService,
    private readonly dataSource: DataSource,
  ) {}

  async addTenant(user_id: string, dto: CreateTenantDto) {
    const {
      phone_number,
      full_name,
      rental_price,
      rent_start_date,
      lease_agreement_end_date,
      email,
      property_id,
      security_deposit,
      service_charge,
      payment_frequency,
    } = dto;

    const admin = (await this.accountRepository.findOne({
      where: {
        id: user_id,
        role: RolesEnum.LANDLORD,
      },
      relations: ['user'],
    })) as any;

    if (!admin) {
      throw new HttpException('admin account not found', HttpStatus.NOT_FOUND);
    }

    return await this.dataSource.transaction(async (manager) => {
      try {
        // 1. Check existing user
        let tenantUser = await manager.getRepository(Users).findOne({
          where: {
            phone_number: this.utilService.normalizePhoneNumber(phone_number),
          },
        });

        if (tenantUser) {
          throw new HttpException(
            `Account with phone: ${this.utilService.normalizePhoneNumber(phone_number)} already exists`,
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }

        const property = await manager.getRepository(Property).findOne({
          where: { id: property_id },
        });

        if (!property) {
          return;
        }

        const hasActiveRent = await manager.getRepository(Rent).findOne({
          where: {
            property_id: property_id,
            rent_status: RentStatusEnum.ACTIVE,
          },
        });

        if (hasActiveRent) {
          throw new HttpException(
            `Property is already rented out`,
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }

        const [first_name, last_name] = full_name.split(' ');
        // 2. Create tenant user
        tenantUser = manager.getRepository(Users).create({
          first_name: this.utilService.toSentenceCase(first_name),
          last_name: this.utilService.toSentenceCase(last_name),
          email,
          phone_number: this.utilService.normalizePhoneNumber(phone_number),
          role: RolesEnum.TENANT,
          is_verified: true,
        });

        await manager.getRepository(Users).save(tenantUser);

        // 3. Create tenant account
        const generatedPassword = await this.utilService.generatePassword();

        const userAccount = manager.getRepository(Account).create({
          user: tenantUser,
          email,
          password: generatedPassword,
          is_verified: true,
          profile_name: `${tenantUser.first_name} ${tenantUser.last_name}`,
          role: RolesEnum.TENANT,
          creator_id: user_id,
        });

        await manager.getRepository(Account).save(userAccount);

        // console.log(tenancy_start_date, tenancy_end_date);
        property.property_status = PropertyStatusEnum.OCCUPIED;

        await manager.getRepository(Property).save(property);

        // 4. create rent record
        const rent = manager.getRepository(Rent).create({
          property_id,
          tenant_id: userAccount.id,
          amount_paid: rental_price,
          rental_price: rental_price,
          rent_start_date: rent_start_date,
          lease_agreement_end_date: lease_agreement_end_date,
          security_deposit: security_deposit || 0,
          service_charge: service_charge || 0,
          payment_frequency: payment_frequency || 'Monthly',
          payment_status: RentPaymentStatusEnum.PAID,
          rent_status: RentStatusEnum.ACTIVE,
        });

        await manager.getRepository(Rent).save(rent);

        // 5. Assign tenant to property
        const propertyTenant = manager.getRepository(PropertyTenant).create({
          property_id,
          tenant_id: userAccount.id,
          status: TenantStatusEnum.ACTIVE,
        });

        await manager.getRepository(PropertyTenant).save(propertyTenant);

        // 5. Notify tenant
        // await this.whatsappBotService.sendToUserWithTemplate(
        //   this.utilService.normalizePhoneNumber(tenantUser.phone_number),
        //   `${tenantUser.first_name} ${tenantUser.last_name}`,
        // );

        this.eventEmitter.emit('user.added', {
          user_id: user_id,
          property_id: property_id,
          property_name: property?.name,
          profile_name: `${tenantUser.first_name} ${tenantUser.last_name}`,
          role: RolesEnum.TENANT,
        });

        await this.whatsappBotService.sendTenantWelcomeTemplate({
          phone_number: this.utilService.normalizePhoneNumber(phone_number),
          tenant_name: `${this.utilService.toSentenceCase(first_name)} ${this.utilService.toSentenceCase(last_name)}`,
          landlord_name: admin.profile_name,
        });

        // Only send notification to admin if phone number exists
        if (admin.user?.phone_number) {
          const admin_phone_number = this.utilService.normalizePhoneNumber(
            admin.user.phone_number,
          );

          await this.sendUserAddedTemplate({
            phone_number: admin_phone_number,
            name: 'Admin',
            user: `${tenantUser.first_name} ${tenantUser.last_name}`,
            property_name: property?.name,
          });
        }

        return tenantUser;
      } catch (error) {
        console.error('Error creating tenant:', error);
        if (error instanceof HttpException) throw error;
        throw new HttpException(
          error.message || 'Could not create tenant',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    });
  }

  /**
   * Attach an existing tenant to a property
   * This allows tenants to be attached to multiple properties
   */
  async attachTenantToProperty(
    tenantId: string,
    dto: AttachTenantToPropertyDto,
    landlordId: string,
  ): Promise<{
    success: boolean;
    message: string;
    tenantId: string;
    propertyId: string;
  }> {
    const {
      propertyId,
      tenancyStartDate,
      rentAmount,
      rentFrequency,
      serviceCharge,
    } = dto;

    return await this.dataSource.transaction(async (manager) => {
      try {
        // 1. Verify tenant exists
        const tenantAccount = await manager.getRepository(Account).findOne({
          where: { id: tenantId },
          relations: ['user'],
        });

        if (!tenantAccount) {
          throw new NotFoundException('Tenant not found');
        }

        // 2. Verify property exists and belongs to this landlord
        const property = await manager.getRepository(Property).findOne({
          where: { id: propertyId },
        });

        if (!property) {
          throw new NotFoundException('Property not found');
        }

        if (property.owner_id !== landlordId) {
          throw new ForbiddenException(
            'You are not authorized to attach tenants to this property',
          );
        }

        // 3. Check if property is vacant
        if (property.property_status === PropertyStatusEnum.OCCUPIED) {
          throw new ConflictException(
            'Property is already occupied. Cannot attach another tenant.',
          );
        }

        // 4. Check if tenant is already attached to this property
        const existingAttachment = await manager
          .getRepository(PropertyTenant)
          .findOne({
            where: {
              property_id: propertyId,
              tenant_id: tenantId,
              status: TenantStatusEnum.ACTIVE,
            },
          });

        if (existingAttachment) {
          throw new ConflictException(
            'Tenant is already attached to this property',
          );
        }

        // 5. Parse rent start date
        const rentStartDate = tenancyStartDate
          ? new Date(tenancyStartDate)
          : new Date();

        // 6. Calculate next rent due date based on frequency
        const nextRentDueDate = this.calculateNextRentDate(
          rentStartDate,
          rentFrequency,
        );

        // 7. Create rent record
        console.log(
          '💰 [AttachToProperty] Creating rent record with service_charge:',
          serviceCharge,
        );
        const rent = manager.getRepository(Rent).create({
          tenant_id: tenantId,
          property_id: propertyId,
          rent_start_date: rentStartDate,
          rental_price: rentAmount,
          security_deposit: 0,
          service_charge: serviceCharge || 0,
          payment_frequency:
            this.mapRentFrequencyToPaymentFrequency(rentFrequency),
          rent_status: RentStatusEnum.ACTIVE,
          payment_status: RentPaymentStatusEnum.PENDING,
          amount_paid: 0,
          expiry_date: nextRentDueDate,
        });

        await manager.getRepository(Rent).save(rent);

        // 8. Create property-tenant relationship
        const propertyTenant = manager.getRepository(PropertyTenant).create({
          property_id: propertyId,
          tenant_id: tenantId,
          status: TenantStatusEnum.ACTIVE,
        });

        await manager.getRepository(PropertyTenant).save(propertyTenant);

        // 9. Update property status to OCCUPIED
        await manager.getRepository(Property).update(propertyId, {
          property_status: PropertyStatusEnum.OCCUPIED,
        });

        // 10. Create property history record
        const propertyHistory = manager.getRepository(PropertyHistory).create({
          property_id: propertyId,
          tenant_id: tenantId,
          move_in_date: DateService.getStartOfTheDay(rentStartDate),
          monthly_rent: rentAmount,
          owner_comment: `Tenant attached to property. Rent: ₦${rentAmount.toLocaleString()}, Frequency: ${rentFrequency}, Next due: ${nextRentDueDate.toLocaleDateString()}`,
          tenant_comment: null,
          move_out_date: null,
          move_out_reason: null,
        });

        await manager.getRepository(PropertyHistory).save(propertyHistory);

        // 11. Send WhatsApp notification to tenant
        try {
          const landlord = await manager.getRepository(Account).findOne({
            where: { id: landlordId },
            relations: ['user'],
          });

          const agencyName = landlord?.profile_name
            ? landlord.profile_name
            : landlord?.user
              ? `${this.utilService.toSentenceCase(landlord.user.first_name)} ${this.utilService.toSentenceCase(landlord.user.last_name)}`
              : 'Your Landlord';

          const tenantName = `${this.utilService.toSentenceCase(tenantAccount.user.first_name)} ${this.utilService.toSentenceCase(tenantAccount.user.last_name)}`;

          await this.whatsappBotService.sendTenantAttachmentNotification({
            phone_number: this.utilService.normalizePhoneNumber(
              tenantAccount.user.phone_number,
            ),
            tenant_name: tenantName,
            landlord_name: agencyName,
            apartment_name: property.name,
          });

          // Emit tenant attached event for live feed
          this.eventEmitter.emit('tenant.attached', {
            property_id: propertyId,
            property_name: property.name,
            tenant_id: tenantId,
            tenant_name: tenantName,
            user_id: property.owner_id,
          });
        } catch (whatsappError) {
          console.error('Failed to send WhatsApp notification:', whatsappError);

          // Still emit the event even if WhatsApp fails
          const fallbackTenantName = `${this.utilService.toSentenceCase(tenantAccount.user.first_name)} ${this.utilService.toSentenceCase(tenantAccount.user.last_name)}`;
          this.eventEmitter.emit('tenant.attached', {
            property_id: propertyId,
            property_name: property.name,
            tenant_id: tenantId,
            tenant_name: fallbackTenantName,
            user_id: property.owner_id,
          });
        }

        return {
          success: true,
          message: 'Tenant successfully attached to property',
          tenantId: tenantId,
          propertyId: propertyId,
        };
      } catch (error) {
        console.error('Error attaching tenant to property:', error);
        if (error instanceof HttpException) throw error;
        throw new HttpException(
          error.message || 'Failed to attach tenant to property',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    });
  }

  /**
   * Calculate next rent due date based on start date and frequency
   */
  private calculateNextRentDate(
    startDate: Date,
    frequency: RentFrequency,
  ): Date {
    const nextDate = new Date(startDate);
    const dueDay = startDate.getDate();

    switch (frequency) {
      case RentFrequency.MONTHLY:
        nextDate.setMonth(nextDate.getMonth() + 1);
        break;
      case RentFrequency.QUARTERLY:
        nextDate.setMonth(nextDate.getMonth() + 3);
        break;
      case RentFrequency.BI_ANNUALLY:
        nextDate.setMonth(nextDate.getMonth() + 6);
        break;
      case RentFrequency.ANNUALLY:
        nextDate.setFullYear(nextDate.getFullYear() + 1);
        break;
      default:
        nextDate.setMonth(nextDate.getMonth() + 1);
    }

    const targetMonth = nextDate.getMonth();
    nextDate.setDate(dueDay);

    if (nextDate.getMonth() !== targetMonth) {
      nextDate.setDate(0);
    }

    nextDate.setDate(nextDate.getDate() - 1);

    return nextDate;
  }

  /**
   * Map RentFrequency enum to payment frequency string
   */
  private mapRentFrequencyToPaymentFrequency(frequency: RentFrequency): string {
    switch (frequency) {
      case RentFrequency.MONTHLY:
        return 'Monthly';
      case RentFrequency.QUARTERLY:
        return 'Quarterly';
      case RentFrequency.BI_ANNUALLY:
        return 'Bi-annually';
      case RentFrequency.ANNUALLY:
        return 'Annually';
      default:
        return 'Monthly';
    }
  }

  async addTenantKyc(user_id: string, dto: CreateTenantKycDto) {
    const {
      phone_number,
      first_name,
      last_name,
      email,
      date_of_birth,
      gender,
      state_of_origin,
      lga,
      nationality,
      employment_status,
      marital_status,
      property_id,
      rent_amount,
      tenancy_start_date,
      tenancy_end_date,
      employer_name,
      job_title,
      employer_address,
      monthly_income,
      work_email,
      business_name,
      nature_of_business,
      business_address,
      business_monthly_income,
      business_website,
      source_of_funds,
      monthly_income_estimate,
      spouse_full_name,
      spouse_phone_number,
      spouse_occupation,
      spouse_employer,
    } = dto;

    const admin = (await this.accountRepository.findOne({
      where: {
        id: user_id,
        role: RolesEnum.LANDLORD,
      },
      relations: ['user'],
    })) as any;

    if (!admin) {
      throw new HttpException('admin account not found', HttpStatus.NOT_FOUND);
    }

    console.log('=== DEBUG: Admin Data in addTenantKyc ===');
    console.log('Admin ID:', admin.id);
    console.log('Admin userId:', admin.userId);
    console.log('Admin user object:', admin.user);
    console.log('Admin user phone_number:', admin.user?.phone_number);
    console.log('=========================================');

    return await this.dataSource.transaction(async (manager) => {
      try {
        // 1. Check existing user
        let tenantUser = await manager.getRepository(Users).findOne({
          where: {
            phone_number: this.utilService.normalizePhoneNumber(phone_number),
          },
        });

        if (tenantUser) {
          throw new HttpException(
            `Account with phone: ${this.utilService.normalizePhoneNumber(phone_number)} already exists`,
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }

        const property = await manager.getRepository(Property).findOne({
          where: { id: property_id },
        });

        if (!property) {
          return;
        }

        const hasActiveRent = await manager.getRepository(Rent).findOne({
          where: {
            property_id: property_id,
            rent_status: RentStatusEnum.ACTIVE,
          },
        });

        if (hasActiveRent) {
          throw new HttpException(
            `Property is already rented out`,
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }

        // 2. Create tenant user
        tenantUser = manager.getRepository(Users).create({
          first_name: this.utilService.toSentenceCase(first_name),
          last_name: this.utilService.toSentenceCase(last_name),
          email,
          phone_number: this.utilService.normalizePhoneNumber(phone_number),
          date_of_birth,
          gender,
          state_of_origin,
          lga,
          nationality,
          employment_status,
          marital_status,
          role: RolesEnum.TENANT,
          is_verified: true,
          employer_name,
          job_title,
          employer_address,
          monthly_income,
          work_email,
          nature_of_business,
          business_name,
          business_address,
          business_monthly_income,
          business_website,
          source_of_funds,
          monthly_income_estimate,
          spouse_full_name,
          spouse_phone_number,
          spouse_occupation,
          spouse_employer,
        });

        await manager.getRepository(Users).save(tenantUser);

        // 3. Create tenant account
        const generatedPassword = await this.utilService.generatePassword();

        const userAccount = manager.getRepository(Account).create({
          user: tenantUser,
          email,
          password: generatedPassword,
          is_verified: true,
          profile_name: `${tenantUser.first_name} ${tenantUser.last_name}`,
          role: RolesEnum.TENANT,
          creator_id: user_id,
        });

        await manager.getRepository(Account).save(userAccount);

        // console.log(tenancy_start_date, tenancy_end_date);
        property.property_status = PropertyStatusEnum.OCCUPIED;

        await manager.getRepository(Property).save(property);

        // 4. create rent record
        const rent = manager.getRepository(Rent).create({
          property_id,
          tenant_id: userAccount.id,
          amount_paid: rent_amount,
          rental_price: rent_amount,
          rent_start_date: tenancy_start_date,
          lease_agreement_end_date: tenancy_end_date, // Optional reference
          rent_status: RentStatusEnum.ACTIVE,
        });

        await manager.getRepository(Rent).save(rent);

        // 5. Assign tenant to property
        const propertyTenant = manager.getRepository(PropertyTenant).create({
          property_id,
          tenant_id: userAccount.id,
          status: TenantStatusEnum.ACTIVE,
        });

        await manager.getRepository(PropertyTenant).save(propertyTenant);

        // 5. Notify tenant
        await this.whatsappBotService.sendToUserWithTemplate(
          this.utilService.normalizePhoneNumber(tenantUser.phone_number),
          `${tenantUser.first_name} ${tenantUser.last_name}`,
        );

        this.eventEmitter.emit('user.added', {
          user_id: user_id,
          property_id: property_id,
          property_name: property?.name,
          profile_name: `${tenantUser.first_name} ${tenantUser.last_name}`,
          role: RolesEnum.TENANT,
        });

        await this.whatsappBotService.sendTenantWelcomeTemplate({
          phone_number: this.utilService.normalizePhoneNumber(phone_number),
          tenant_name: `${this.utilService.toSentenceCase(first_name)} ${this.utilService.toSentenceCase(last_name)}`,
          landlord_name: admin.profile_name,
        });

        // Only send notification to admin if phone number exists
        if (admin.user?.phone_number) {
          const admin_phone_number = this.utilService.normalizePhoneNumber(
            admin.user.phone_number,
          );

          await this.sendUserAddedTemplate({
            phone_number: admin_phone_number,
            name: 'Admin',
            user: `${tenantUser.first_name} ${tenantUser.last_name}`,
            property_name: property?.name,
          });
        }

        return tenantUser;
      } catch (error) {
        console.error('Error creating tenant:', error);
        if (error instanceof HttpException) throw error;
        throw new HttpException(
          error.message || 'Could not create tenant',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    });
  }

  async attachTenantFromKyc(
    landlordId: string,
    dto: {
      kycApplicationId: string;
      propertyId: string;
      rentAmount: number;
      rentFrequency: string;
      tenancyStartDate: string;
      rentDueDate: string;
      serviceCharge?: number;
    },
  ) {
    // 1. Fetch the KYC application
    const kycApplication = await this.kycApplicationRepository.findOne({
      where: { id: dto.kycApplicationId },
      relations: ['property'],
    });

    if (!kycApplication) {
      throw new HttpException(
        'KYC Application not found',
        HttpStatus.NOT_FOUND,
      );
    }

    // Allow attaching tenant regardless of KYC status
    // Removed status check to enable attaching tenants with any KYC status
    // if (kycApplication.status !== 'pending') {
    //   throw new HttpException(
    //     'KYC Application is not pending',
    //     HttpStatus.BAD_REQUEST,
    //   );
    // }

    // 2. Map KYC application data to CreateTenantKycDto
    const tenantKycDto: any = {
      phone_number: kycApplication.phone_number,
      first_name: kycApplication.first_name,
      last_name: kycApplication.last_name,
      email:
        kycApplication.email ||
        `${kycApplication.phone_number}@placeholder.com`,
      date_of_birth: kycApplication.date_of_birth || new Date('1990-01-01'),
      gender: kycApplication.gender || 'male',
      state_of_origin: kycApplication.state_of_origin || 'N/A',
      lga: 'N/A', // Not in KYC application
      nationality: kycApplication.nationality || 'Nigerian',
      employment_status: kycApplication.employment_status || 'employed',
      marital_status: kycApplication.marital_status || 'single',
      property_id: dto.propertyId,
      rent_amount: dto.rentAmount,
      rent_frequency: dto.rentFrequency,
      tenancy_start_date: new Date(dto.tenancyStartDate),
      rent_due_date: new Date(dto.rentDueDate),
      employer_name: kycApplication.employer_name,
      job_title: kycApplication.job_title,
      employer_address: kycApplication.employer_address,
      monthly_income: kycApplication.monthly_net_income
        ? parseFloat(kycApplication.monthly_net_income)
        : undefined,
      work_email: kycApplication.email,
      business_name: kycApplication.business_name,
      nature_of_business: kycApplication.nature_of_business,
      business_address: kycApplication.business_address,
      business_monthly_income: undefined,
      business_website: undefined,
      source_of_funds: undefined,
      monthly_income_estimate: undefined,
      spouse_full_name: undefined,
      spouse_phone_number: undefined,
      spouse_occupation: undefined,
      spouse_employer: undefined,
      service_charge: dto.serviceCharge,
    };

    // 3. Handle existing user or create new tenant
    const result = await this.handleTenantFromKyc(landlordId, tenantKycDto);

    // 4. Update KYC application status to approved
    await this.kycApplicationRepository.update(
      { id: dto.kycApplicationId },
      { status: 'approved' as any },
    );

    return result;
  }

  /**
   * Handle tenant creation from KYC - supports existing users
   */
  private async handleTenantFromKyc(landlordId: string, dto: any) {
    return await this.dataSource.transaction(async (manager) => {
      const {
        phone_number,
        first_name,
        last_name,
        email,
        date_of_birth,
        gender,
        state_of_origin,
        lga,
        nationality,
        employment_status,
        marital_status,
        property_id,
        rent_amount,
        rent_frequency,
        tenancy_start_date,
        rent_due_date,
        employer_name,
        job_title,
        employer_address,
        monthly_income,
        work_email,
        business_name,
        nature_of_business,
        business_address,
        service_charge,
      } = dto;

      // 1. Check if user already exists
      const normalizedPhone =
        this.utilService.normalizePhoneNumber(phone_number);
      console.log('🔍 Looking for existing user with phone:', normalizedPhone);
      console.log('📞 Original phone number:', phone_number);

      // Try multiple search strategies to find existing user
      let tenantUser = await manager.getRepository(Users).findOne({
        where: {
          phone_number: normalizedPhone,
        },
      });

      // If not found with normalized phone, try with original phone
      if (!tenantUser) {
        tenantUser = await manager.getRepository(Users).findOne({
          where: {
            phone_number: phone_number,
          },
        });
        console.log(
          '🔍 Tried original phone, found:',
          tenantUser ? `Yes (ID: ${tenantUser.id})` : 'No',
        );
      }

      // If still not found, try without + prefix
      if (!tenantUser && phone_number.startsWith('+')) {
        const phoneWithoutPlus = phone_number.substring(1);
        tenantUser = await manager.getRepository(Users).findOne({
          where: {
            phone_number: phoneWithoutPlus,
          },
        });
        console.log(
          '🔍 Tried without +, found:',
          tenantUser ? `Yes (ID: ${tenantUser.id})` : 'No',
        );
      }

      console.log(
        '👤 Final result - Found existing user:',
        tenantUser ? `Yes (ID: ${tenantUser.id})` : 'No',
      );

      // 2. If user doesn't exist, create new user
      if (!tenantUser) {
        console.log('➕ Creating new user with phone:', normalizedPhone);

        try {
          tenantUser = manager.getRepository(Users).create({
            first_name: this.utilService.toSentenceCase(first_name),
            last_name: this.utilService.toSentenceCase(last_name),
            email,
            phone_number: this.utilService.normalizePhoneNumber(phone_number),
            date_of_birth,
            gender,
            state_of_origin,
            lga,
            nationality,
            employment_status,
            marital_status,
            role: RolesEnum.TENANT,
            is_verified: true,
            employer_name,
            job_title,
            employer_address,
            monthly_income,
            work_email,
            nature_of_business,
            business_name,
            business_address,
            source_of_funds: undefined,
            monthly_income_estimate: undefined,
            spouse_full_name: undefined,
            spouse_phone_number: undefined,
            spouse_occupation: undefined,
            spouse_employer: undefined,
          });

          tenantUser = await manager.getRepository(Users).save(tenantUser);
          console.log(
            '✅ Successfully created new user with ID:',
            tenantUser.id,
          );
        } catch (error: any) {
          // If duplicate key error, try to find the existing user again
          if (
            error.code === '23505' &&
            error.constraint === 'UQ_17d1817f241f10a3dbafb169fd2'
          ) {
            console.log(
              '⚠️ Duplicate key error caught, searching for existing user again...',
            );

            // Try all possible phone number formats
            const phoneVariants = [
              normalizedPhone,
              phone_number,
              phone_number.startsWith('+')
                ? phone_number.substring(1)
                : `+${phone_number}`,
            ];

            for (const phoneVariant of phoneVariants) {
              tenantUser = await manager.getRepository(Users).findOne({
                where: { phone_number: phoneVariant },
              });
              if (tenantUser) {
                console.log(
                  '🔄 Found existing user with phone variant:',
                  phoneVariant,
                  'User ID:',
                  tenantUser.id,
                );
                break;
              }
            }

            if (!tenantUser) {
              console.error(
                '❌ Could not find existing user even after duplicate key error',
              );
              throw error;
            }
          } else {
            throw error;
          }
        }
      } else {
        console.log('♻️ Using existing user with ID:', tenantUser.id);
      }

      // 3. Check if property exists and is available
      const property = await manager.getRepository(Property).findOne({
        where: { id: property_id },
      });

      if (!property) {
        throw new HttpException('Property not found', HttpStatus.NOT_FOUND);
      }

      // 4. Check if property already has active rent
      const hasActiveRent = await manager.getRepository(Rent).findOne({
        where: {
          property_id: property_id,
          rent_status: RentStatusEnum.ACTIVE,
        },
      });

      if (hasActiveRent) {
        throw new HttpException(
          'Property is already rented out',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      // 5. Create account for tenant if it doesn't exist
      let tenantAccount = await manager.getRepository(Account).findOne({
        where: { userId: tenantUser.id },
      });

      if (!tenantAccount) {
        tenantAccount = manager.getRepository(Account).create({
          userId: tenantUser.id,
          role: RolesEnum.TENANT,
        });
        tenantAccount = await manager
          .getRepository(Account)
          .save(tenantAccount);
      }

      // 6. Create rent record
      console.log(
        '💰 Creating rent record with service_charge:',
        service_charge,
      );
      const rent = manager.getRepository(Rent).create({
        tenant_id: tenantAccount.id,
        property_id: property_id,
        rent_start_date: tenancy_start_date,
        rental_price: rent_amount,
        security_deposit: 0,
        service_charge: service_charge || 0,
        payment_frequency: this.mapRentFrequencyToPaymentFrequency(
          rent_frequency as RentFrequency,
        ),
        rent_status: RentStatusEnum.ACTIVE,
        payment_status: RentPaymentStatusEnum.PENDING,
        amount_paid: 0,
        expiry_date: rent_due_date,
      });

      await manager.getRepository(Rent).save(rent);

      // 7. Create property-tenant relationship
      const propertyTenant = manager.getRepository(PropertyTenant).create({
        property_id: property_id,
        tenant_id: tenantAccount.id,
        status: TenantStatusEnum.ACTIVE,
      });

      await manager.getRepository(PropertyTenant).save(propertyTenant);

      // 8. Update property status to occupied
      await manager.getRepository(Property).update(property_id, {
        property_status: PropertyStatusEnum.OCCUPIED,
      });

      // 9. Create property history record
      const propertyHistory = manager.getRepository(PropertyHistory).create({
        property_id: property_id,
        tenant_id: tenantAccount.id,
        move_in_date: tenancy_start_date,
        monthly_rent: rent_amount,
        owner_comment: 'Tenant attached from KYC application',
        tenant_comment: null,
        move_out_date: null,
        move_out_reason: null,
      });

      await manager.getRepository(PropertyHistory).save(propertyHistory);

      return tenantUser;
    });
  }

  async createUser(data: CreateUserDto, creatorId: string): Promise<Account> {
    const { email, phone_number } = data;
    const queryRunner = this.dataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const userRole = data?.role
        ? RolesEnum[data.role.toUpperCase()]
        : RolesEnum.TENANT;

      // Check if user already exists
      let user = await queryRunner.manager.findOne(Users, { where: { email } });

      if (!user) {
        user = await queryRunner.manager.save(Users, {
          email,
          phone_number,
          first_name: data.first_name,
          last_name: data.last_name,
          creator_id: userRole === RolesEnum.TENANT ? creatorId : null,
          gender: data.gender,
          marital_status: data.marital_status,
          employment_status: data.employment_status,
          date_of_birth: data.date_of_birth,
          state_of_origin: data.state_of_origin,
          lga: data.lga,
          nationality: data.nationality,
          rent_start_date: data.rent_start_date,
          lease_agreement_end_date: data.lease_agreement_end_date,
          property_id: data.property_id,
          rental_price: data.rental_price,
          security_deposit: data.security_deposit,
          service_charge: data.service_charge,
          // password: data.password,

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

          // Unemployed fields
          source_of_funds: data.source_of_funds,
          monthly_income_estimate: data.monthly_income_estimate,
        });
      }

      // Check for existing account
      const existingAccount = await queryRunner.manager.findOne(Account, {
        where: { email, role: userRole },
      });

      if (existingAccount) {
        throw new HttpException(
          `Account with email: ${email} already exists`,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      const property = await queryRunner.manager.findOne(Property, {
        where: { id: data.property_id },
      });

      if (!property?.id) {
        throw new HttpException(
          `Property with id: ${data.property_id} not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      const hasActiveRent = await queryRunner.manager.exists(Rent, {
        where: {
          property_id: data.property_id,
          rent_status: RentStatusEnum.ACTIVE,
        },
      });

      if (hasActiveRent) {
        throw new HttpException(
          `Property is already rented out`,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      const tenantAccount = queryRunner.manager.create(Account, {
        user,
        creator_id: creatorId,
        email,
        role: userRole,
        profile_name: `${this.utilService.toSentenceCase(user.first_name)} ${this.utilService.toSentenceCase(user.last_name)}`,
        is_verified: false,
      });

      await queryRunner.manager.save(Account, tenantAccount);

      await queryRunner.manager.save(Rent, {
        tenant_id: tenantAccount.id,
        rent_start_date: data.rent_start_date,
        lease_agreement_end_date: data.lease_agreement_end_date,
        property_id: property.id,
        amount_paid: data.rental_price,
        rental_price: data.rental_price,
        security_deposit: data.security_deposit,
        service_charge: data.service_charge,
        payment_status: RentPaymentStatusEnum.PAID,
        rent_status: RentStatusEnum.ACTIVE,
      });

      await Promise.all([
        queryRunner.manager.save(PropertyTenant, {
          property_id: property.id,
          tenant_id: tenantAccount.id,
          status: TenantStatusEnum.ACTIVE,
        }),
        queryRunner.manager.update(Property, property.id, {
          property_status: PropertyStatusEnum.OCCUPIED,
        }),
        queryRunner.manager.save(PropertyHistory, {
          property_id: property.id,
          tenant_id: tenantAccount.id,
          move_in_date: DateService.getStartOfTheDay(new Date()),
          monthly_rent: data.rental_price,
          owner_comment: null,
          tenant_comment: null,
          move_out_date: null,
          move_out_reason: null,
        }),
      ]);

      const token = await this.generatePasswordResetToken(
        tenantAccount.id,
        queryRunner,
      );

      const resetLink = `${this.configService.get<string>('FRONTEND_URL')}/reset-password?token=${token}`;
      const emailContent = clientSignUpEmailTemplate(
        user.first_name,
        resetLink,
      );
      const whatsappContent = clientSignUpWhatsappTemplate(
        user.first_name,
        resetLink,
      );

      const pandaEmail = this.configService.get<string>('GMAIL_USER')!;

      // Critical: this can throw — must stay *inside* transaction
      await Promise.all([
        this.utilService.sendEmail(
          email,
          EmailSubject.WELCOME_EMAIL,
          emailContent,
        ),
        this.utilService.sendEmail(
          pandaEmail,
          EmailSubject.WELCOME_EMAIL,
          emailContent,
        ),
        // this.twilioService.sendWhatsAppMessage(phone_number, whatsappContent),
      ]);

      await queryRunner.commitTransaction();

      this.eventEmitter.emit('user.added', {
        user_id: property.owner_id,
        property_id: data.property_id,
        property_name: property.name,
        profile_name: tenantAccount.profile_name,
        role: userRole,
      });

      const result = {
        ...tenantAccount,
        password_link: resetLink,
      };

      return result;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      console.error('Transaction rolled back due to:', error);
      throw new HttpException(
        error?.message || 'An error occurred while creating user',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    } finally {
      await queryRunner.release();
    }
  }

  async createUserOld(data: CreateUserDto, user_id: string): Promise<IUser> {
    const { email, phone_number } = data;

    const emailExist = await this.usersRepository.exists({ where: { email } });
    if (emailExist) {
      throw new HttpException(
        `User with email: ${email} already exist`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const queryRunner =
      this.usersRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const userRole = data?.role
        ? RolesEnum[data?.role.toUpperCase()]
        : RolesEnum.TENANT;

      const newUser: IUser = {
        ...data,
        role: userRole,
        creator_id: userRole === RolesEnum.TENANT ? user_id : null,
      };

      const createdUser = await queryRunner.manager.save(Users, newUser);

      if (!createdUser?.id) {
        throw new Error('User ID is missing after creation');
      }

      await queryRunner.manager.save(Account, {
        role: userRole,
        user: createdUser,
        profile_name: `${createdUser.first_name || 'User'}'s ${userRole} Account`,
      });

      const property = await queryRunner.manager.findOne(Property, {
        where: {
          id: data.property_id,
        },
      });

      if (!property?.id) {
        throw new HttpException(
          `Property with id: ${data?.property_id} not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      const hasActiveRent = await queryRunner.manager.exists(Rent, {
        where: {
          property_id: data?.property_id,
          rent_status: Not(RentStatusEnum.ACTIVE),
        },
      });

      if (hasActiveRent) {
        throw new HttpException(
          `Property with id: ${data?.property_id} is already rented`,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      const rent = {
        tenant_id: createdUser.id,
        rent_start_date: data?.rent_start_date,
        lease_agreement_end_date: data?.lease_agreement_end_date,
        property_id: property?.id,
        amount_paid: data?.rental_price,
        rental_price: data?.rental_price,
        security_deposit: data?.security_deposit,
        service_charge: data?.service_charge,
        payment_status: RentPaymentStatusEnum.PAID,
        rent_status: RentStatusEnum.ACTIVE,
      };
      await queryRunner.manager.save(Rent, rent);

      await queryRunner.manager.save(PropertyTenant, {
        property_id: property.id,
        tenant_id: createdUser.id,
        status: TenantStatusEnum.ACTIVE,
      });

      await queryRunner.manager.update(Property, property.id, {
        property_status: PropertyStatusEnum.OCCUPIED,
      });

      await queryRunner.manager.save(PropertyHistory, {
        property_id: property?.id,
        tenant_id: createdUser?.id,
        move_in_date: DateService.getStartOfTheDay(new Date()),
        monthly_rent: data?.rental_price,
        owner_comment: null,
        tenant_comment: null,
        move_out_date: null,
        move_out_reason: null,
      });

      // const token = await this.generatePasswordResetToken(
      //   createdUser?.id,
      //   queryRunner,
      // );

      // const emailContent = clientSignUpEmailTemplate(
      //   `${this.configService.get<string>('FRONTEND_URL')}/reset-password?token=${token}`,
      // );

      // await this.utilService.sendEmail(
      //   email,
      //   EmailSubject.WELCOME_EMAIL,
      //   emailContent,
      // );

      await queryRunner.commitTransaction();

      this.eventEmitter.emit('user.added', {
        user_id: property.owner_id,
        property_id: data.property_id,
        property_name: property.name,
        role: createdUser.role,
      });
      return createdUser;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw new HttpException(
        error?.message || 'An error occurred while creating user',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    } finally {
      await queryRunner.release();
    }
  }

  async generatePasswordResetToken(
    userId: string,
    queryRunner: QueryRunner,
  ): Promise<string> {
    const token = uuidv4(); // Generate secure UUID
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // Token valid for 24 hour

    const passwordReset = queryRunner.manager.create(PasswordResetToken, {
      id: uuidv4(),
      user_id: userId,
      token,
      expires_at: expiresAt,
    });

    await queryRunner.manager.save(PasswordResetToken, passwordReset);

    return token;
  }

  async getAllUsers(queryParams: UserFilter) {
    const page = queryParams?.page
      ? Number(queryParams?.page)
      : config.DEFAULT_PAGE_NO;
    const size = queryParams?.size
      ? Number(queryParams.size)
      : config.DEFAULT_PER_PAGE;
    const skip = (page - 1) * size;

    const query = await buildUserFilter(queryParams);
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

  async getAllTenants(queryParams: UserFilter) {
    const page = queryParams?.page
      ? Number(queryParams?.page)
      : config.DEFAULT_PAGE_NO;

    const size = queryParams?.size
      ? Number(queryParams.size)
      : config.DEFAULT_PER_PAGE;

    const skip = (page - 1) * size;

    queryParams.role = RolesEnum.TENANT;

    const qb = this.usersRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.property_tenants', 'property_tenants')
      .leftJoinAndSelect('property_tenants.property', 'property')
      .leftJoinAndSelect('user.rents', 'rents')
      .where('user.role = :role', { role: RolesEnum.TENANT.toLowerCase() });

    buildUserFilterQB(qb, queryParams); // apply search & filters

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

  async getUserById(id: string): Promise<IUser> {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user?.id) {
      throw new HttpException(
        `User with id: ${id} not found`,
        HttpStatus.NOT_FOUND,
      );
    }
    return user;
  }

  async getAccountById(id: string): Promise<any> {
    const user = await this.accountRepository.findOne({ where: { id } });
    if (!user?.id) {
      throw new HttpException(
        `User with id: ${id} not found`,
        HttpStatus.NOT_FOUND,
      );
    }
    return user;
  }

  async getUserFields(
    user_id: string,
    fields: string[],
  ): Promise<Partial<IUser>> {
    const selectFields = fields.reduce(
      (acc, field) => {
        acc[field] = true;
        return acc;
      },
      {} as Record<string, boolean>,
    );

    const user = await this.usersRepository.findOne({
      where: { id: user_id },
      select: selectFields,
    });

    if (!user) {
      throw new HttpException(
        `User with id: ${user_id} not found`,
        HttpStatus.NOT_FOUND,
      );
    }
    return user;
  }

  async updateUserById(id: string, data: UpdateUserDto) {
    const account = await this.accountRepository.findOne({
      where: { id },
    });

    if (!account?.id) {
      throw new NotFoundException(`Account with userId: ${id} not found`);
    }

    await this.accountRepository.update(account.id, {
      profile_name: `${data.first_name} ${data.last_name}`,
    });
    return this.usersRepository.update(account.userId, data);
  }

  async deleteUserById(id: string) {
    return this.usersRepository.delete(id);
  }

  async loginUser(data: LoginDto, res: Response, req?: any) {
    const { identifier, password } = data; // Changed from 'email' to 'identifier'

    // Simple rate limiting check
    const rateLimitKey = `login_attempts:${identifier}`;
    const attempts = await this.cache.get(rateLimitKey);

    if (attempts && parseInt(attempts) >= 5) {
      throw new HttpException(
        'Too many login attempts. Please try again in 15 minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Determine if identifier is email or phone
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);
    const isPhone = /^[+]?[\d\s\-()]{10,}$/.test(identifier.replace(/\s/g, ''));

    if (!isEmail && !isPhone) {
      throw new BadRequestException('Invalid email or phone number format');
    }

    // Build query conditions based on identifier type
    const whereCondition = isEmail
      ? { email: identifier.toLowerCase().trim() }
      : { user: { phone_number: identifier.replace(/[\s\-()+]/g, '') } };

    // Fetch accounts with the identifier but different roles
    const [adminAccount, landlordAccount, tenantAccount, repAccount] =
      await Promise.all([
        this.accountRepository.findOne({
          where: { ...whereCondition, role: RolesEnum.ADMIN },
          relations: ['user'],
        }),
        this.accountRepository.findOne({
          where: { ...whereCondition, role: RolesEnum.LANDLORD },
          relations: ['user'],
        }),
        this.accountRepository.findOne({
          where: { ...whereCondition, role: RolesEnum.TENANT },
          relations: ['user'],
        }),
        this.accountRepository.findOne({
          where: { ...whereCondition, role: RolesEnum.REP },
          relations: ['user'],
        }),
      ]);

    // Check if any account exists
    if (!adminAccount && !tenantAccount && !landlordAccount && !repAccount) {
      throw new NotFoundException(
        `User with ${isEmail ? 'email' : 'phone number'}: ${identifier} not found`,
      );
    }

    // Check verification status
    if (
      !adminAccount?.is_verified &&
      !tenantAccount?.is_verified &&
      !landlordAccount?.is_verified &&
      !repAccount?.is_verified
    ) {
      throw new NotFoundException(`Your account is not verified`);
    }

    // Validate password for each account
    const accounts = [
      adminAccount,
      landlordAccount,
      tenantAccount,
      repAccount,
    ].filter(Boolean) as any;

    let matchedAccount = null;

    for (const account of accounts) {
      if (account.password) {
        const isPasswordValid = await this.utilService.validatePassword(
          password,
          account.password,
        );

        if (isPasswordValid) {
          matchedAccount = account;
          console.log(
            `SUCCESS: Matched account with role: ${account.role}. Breaking loop.`,
          );
          break;
        }
      }
    }

    // Handle no password match
    if (!matchedAccount) {
      // Increment failed login attempts
      const currentAttempts = await this.cache.get(rateLimitKey);
      const newAttempts = currentAttempts ? parseInt(currentAttempts) + 1 : 1;
      await this.cache.set(rateLimitKey, newAttempts.toString(), 15 * 60); // 15 minutes TTL

      throw new UnauthorizedException('Incorrect password');
    }

    // Clear rate limit on successful login
    await this.cache.delete(rateLimitKey);

    const account = matchedAccount as any;

    let sub_access_token: string | null = null;
    let parent_access_token: string | null = null;

    // Handle LANDLORD with TENANT sub-account
    if (account.role === RolesEnum.LANDLORD) {
      const subAccountWhere = isEmail
        ? { id: Not(account.id), email: account.email, role: RolesEnum.TENANT }
        : {
            id: Not(account.id),
            user: { phone_number: account.user.phone_number },
            role: RolesEnum.TENANT,
          };

      const subAccount = (await this.accountRepository.findOne({
        where: subAccountWhere,
        relations: ['user', 'property_tenants'],
      })) as any;

      if (subAccount) {
        const subTokenPayload = {
          id: subAccount.id,
          first_name: subAccount.user.first_name,
          last_name: subAccount.user.last_name,
          email: subAccount.email,
          phone_number: subAccount.user.phone_number,
          property_id: subAccount.property_tenants[0]?.property_id,
          role: subAccount.role,
        } as any;

        sub_access_token =
          await this.authService.generateAccessToken(subTokenPayload);
      }
    }

    // Handle TENANT with LANDLORD parent account
    if (account.role === RolesEnum.TENANT) {
      const parentAccountWhere = isEmail
        ? {
            id: Not(account.id),
            email: account.email,
            role: RolesEnum.LANDLORD,
          }
        : {
            id: Not(account.id),
            user: { phone_number: account.user.phone_number },
            role: RolesEnum.LANDLORD,
          };

      const parentAccount = (await this.accountRepository.findOne({
        where: parentAccountWhere,
        relations: ['user', 'property_tenants'],
      })) as any;

      if (parentAccount) {
        const subTokenPayload = {
          id: parentAccount.id,
          first_name: parentAccount.user.first_name,
          last_name: parentAccount.user.last_name,
          email: parentAccount.email,
          phone_number: parentAccount.user.phone_number,
          property_id: parentAccount.property_tenants[0]?.property_id,
          role: parentAccount.role,
        } as any;

        parent_access_token =
          await this.authService.generateAccessToken(subTokenPayload);
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

    // Generate access token (15 minutes) and refresh token (7 days)
    const access_token =
      await this.authService.generateAccessToken(tokenPayload);
    const refresh_token = await this.authService.generateRefreshToken(
      account.id,
      data.identifier, // user agent placeholder
      'unknown', // IP address placeholder
    );

    const isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';

    // Set access token cookie (15 minutes)
    res.cookie('access_token', access_token, {
      httpOnly: true,
      secure: isProduction,
      maxAge: 15 * 60 * 1000, // 15 minutes in milliseconds
      sameSite: isProduction ? 'none' : 'lax',
      path: '/', // Available to all paths
    });

    // Set refresh token cookie (7 days)
    res.cookie('refresh_token', refresh_token, {
      httpOnly: true,
      secure: isProduction,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
      sameSite: isProduction ? 'none' : 'lax',
      path: '/', // Available to all paths
    });

    if (sub_access_token) {
      res.cookie('sub_access_token', sub_access_token, {
        httpOnly: true,
        secure: isProduction,
        maxAge: 15 * 60 * 1000, // 15 minutes
        sameSite: isProduction ? 'none' : 'lax',
        path: '/', // Available to all paths
      });
    }

    if (parent_access_token) {
      res.cookie('parent_access_token', parent_access_token, {
        httpOnly: true,
        secure: isProduction,
        maxAge: 15 * 60 * 1000, // 15 minutes
        sameSite: isProduction ? 'none' : 'lax',
        path: '/', // Available to all paths
      });
    }

    return res.status(HttpStatus.OK).json({
      user: {
        id: account.id,
        first_name: account.user.first_name,
        last_name: account.user.last_name,
        email: account.email,
        phone_number: account.user.phone_number,
        profile_name: account.profile_name,
        role: account.role,
        is_verified: account.is_verified,
        logo_urls: account.user.logo_urls,
        creator_id: account.creator_id,
        created_at: account.user.created_at,
        updated_at: account.user.updated_at,
      },
    });
  }

  // async loginUserOld(data: LoginDto, res: Response) {
  //   const { email, password } = data;

  //   const account = await this.accountRepository.findOne({
  //     where: { email },
  //     relations: ['user'],
  //   });
  //   if (!account?.id) {
  //     throw new NotFoundException(`User with email: ${data.email} not found`);
  //   }

  //   if (account?.password) {
  //     const isPasswordValid = await UtilService.validatePassword(
  //       password,
  //       account?.password,
  //     );
  //     if (!isPasswordValid) {
  //       throw new UnauthorizedException('Invalid password');
  //     }
  //   } else {
  //     const hashedPassword = await UtilService.hashPassword(password);
  //     await this.accountRepository.update(
  //       { email },
  //       { password: hashedPassword, is_verified: true },
  //     );
  //   }

  //   const userObject = {};
  //   if (account?.role === RolesEnum.TENANT) {
  //     const findTenantProperty = await this.propertyTenantRepository.findOne({
  //       where: {
  //         tenant_id: account.id,
  //       },
  //     });
  //     userObject['property_id'] = findTenantProperty?.property_id;
  //   }
  //   const tokenData = {
  //     id: account?.id,
  //     first_name: account.user.first_name,
  //     last_name: account.user.last_name,
  //     email: account.email,
  //     phone_number: account.user.phone_number,
  //     role: account.role,
  //   } as any;

  //   const access_token = await this.authService.generateToken(tokenData);

  //   res.cookie('access_token', access_token, {
  //     httpOnly: true,
  //     secure: this.configService.get<string>('NODE_ENV') === 'production', // Set to true in production for HTTPS
  //     expires: moment().add(8, 'hours').toDate(),
  //     sameSite: 'none',
  //   });

  //   return res.status(HttpStatus.OK).json({
  //     user: {
  //       ...userObject,
  //       id: account?.id,
  //       first_name: account.user?.first_name,
  //       last_name: account.user?.last_name,
  //       email: account?.email,
  //       phone_number: account.user?.phone_number,
  //       role: account?.role,
  //       is_verified: account?.is_verified,
  //       logo_urls: account.user?.logo_urls,
  //       creator_id: account.user?.creator_id,
  //       created_at: account.user?.created_at,
  //       updated_at: account.user?.updated_at,
  //     },
  //     access_token,
  //     expires_at: moment().add(8, 'hours').format(),
  //   });
  // }

  async logoutUser(res: Response) {
    const refreshToken = res.req.cookies['refresh_token'];

    // Revoke refresh token if it exists
    if (refreshToken) {
      await this.authService.revokeRefreshToken(refreshToken);
    }

    const isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';

    res.clearCookie('access_token', {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: '/',
    });

    res.clearCookie('refresh_token', {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: '/',
    });

    res.clearCookie('sub_access_token', {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: '/',
    });

    res.clearCookie('parent_access_token', {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: '/',
    });

    return res.status(HttpStatus.OK).json({
      message: 'Logout successful',
    });
  }

  async getTenantAndPropertyInfo(tenant_id: string) {
    const tenant = await this.accountRepository.findOne({
      where: {
        id: tenant_id,
        role: RolesEnum.TENANT,
      },
      relations: [
        'user',
        'property_tenants',
        'property_tenants.property.rents',
      ],
    });

    if (!tenant?.id) {
      throw new HttpException(
        `Tenant with id: ${tenant_id} not found`,
        HttpStatus.NOT_FOUND,
      );
    }

    return tenant;
  }

  async forgotPassword(email: string) {
    try {
      const user = await this.accountRepository.findOne({ where: { email } });

      if (!user) {
        throw new HttpException('User not found', HttpStatus.NOT_FOUND);
      }

      const otp = this.utilService.generateOTP(6);
      const token = uuidv4();
      const expires_at = new Date(Date.now() + 1000 * 60 * 5); // 15 min

      await this.passwordResetRepository.save({
        user_id: user.id,
        token,
        otp,
        expires_at,
      });

      const emailContent = clientForgotPasswordTemplate(otp);

      await this.utilService.sendEmail(
        email,
        EmailSubject.WELCOME_EMAIL,
        emailContent,
      );

      return {
        message: 'OTP sent to email',
        token,
      };
    } catch (error) {
      console.error('[ForgotPassword Error]', error);
      // Ensure the request is not hanging and sends a response
      throw new HttpException(
        'Failed to process forgot password request',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async validateOtp(otp: string) {
    const entry = await this.passwordResetRepository.findOne({
      where: { otp },
    });

    if (!entry || entry.expires_at < new Date()) {
      throw new HttpException('Invalid or expired OTP', HttpStatus.BAD_REQUEST);
    }

    return {
      message: 'OTP validated successfully',
      token: entry.token,
    };
  }

  async resendOtp(oldToken: string) {
    const resetEntry = await this.passwordResetRepository.findOne({
      where: { token: oldToken },
    });

    if (!resetEntry) {
      throw new HttpException('Invalid token', HttpStatus.BAD_REQUEST);
    }

    const user = await this.accountRepository.findOne({
      where: { id: resetEntry.user_id },
    });

    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    // Optional: Prevent resending if recently sent
    const now = new Date();
    const timeDiff = (resetEntry.expires_at.getTime() - now.getTime()) / 1000;
    if (timeDiff > 840) {
      throw new HttpException(
        'OTP already sent recently. Please wait a moment before requesting again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Invalidate old token
    await this.passwordResetRepository.delete({ id: resetEntry.id });

    // Generate new OTP and token
    const newOtp = this.utilService.generateOTP(6);
    const newToken = uuidv4();
    const expires_at = new Date(Date.now() + 1000 * 60 * 5); // 15 minutes

    await this.passwordResetRepository.save({
      user_id: user.id,
      token: newToken,
      otp: newOtp,
      expires_at,
    });

    const emailContent = clientForgotPasswordTemplate(newOtp);
    await this.utilService.sendEmail(
      user.email,
      EmailSubject.RESEND_OTP,
      emailContent,
    );

    return {
      message: 'OTP resent successfully',
      token: newToken,
    };
  }

  async resetPassword(payload: ResetPasswordDto, res: Response) {
    const { token, newPassword } = payload;

    const resetEntry = await this.passwordResetRepository.findOne({
      where: { token },
    });

    if (!resetEntry) {
      throw new HttpException('Invalid token', HttpStatus.BAD_REQUEST);
    }

    if (resetEntry.expires_at < new Date()) {
      await this.passwordResetRepository.delete({ id: resetEntry.id }); // Clean up expired token
      throw new HttpException('Token has expired', HttpStatus.BAD_REQUEST);
    }

    const user = await this.accountRepository.findOne({
      where: { id: resetEntry.user_id },
      relations: ['property_tenants'],
    });

    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    // Hash and update the password
    user.password = await this.utilService.hashPassword(newPassword);
    if (!user.is_verified) {
      user.is_verified = true;
      this.eventEmitter.emit('user.signup', {
        user_id: user.id,
        profile_name: user.profile_name,
        property_id: user.property_tenants[0].property_id,
        role: RolesEnum.TENANT,
      });
    }

    await this.accountRepository.save(user);

    // Delete token after successful password reset
    await this.passwordResetRepository.delete({ id: resetEntry.id });

    return res.status(HttpStatus.OK).json({
      message: 'Password reset successful',
      user_id: user.id,
    });
  }

  async getTenantsOfAnAdmin(creator_id: string, queryParams: UserFilter) {
    const page = queryParams?.page ?? config.DEFAULT_PAGE_NO;
    const size = queryParams?.size ?? config.DEFAULT_PER_PAGE;
    const skip = (page - 1) * size;

    const extraFilters = await buildUserFilter(queryParams);

    // Only return tenants who have active rents (currently assigned to properties)
    const qb = this.accountRepository
      .createQueryBuilder('accounts')
      .leftJoinAndSelect('accounts.user', 'user')
      .innerJoinAndSelect(
        'accounts.rents',
        'rents',
        'rents.rent_status = :activeStatus',
        { activeStatus: 'active' },
      )
      .leftJoinAndSelect('rents.property', 'property')
      .where('accounts.creator_id = :creator_id', { creator_id });
    //   .leftJoinAndSelect('tenant.user', 'user')
    // .leftJoinAndSelect('rents.property', 'property')

    // Apply extra filters only on the `account` table
    if (queryParams.sort_by === 'rent' && queryParams?.sort_order) {
      qb.orderBy(
        'rents.rental_price',
        queryParams.sort_order.toUpperCase() as 'ASC' | 'DESC',
      );
    } else if (queryParams.sort_by === 'date' && queryParams?.sort_order) {
      qb.orderBy(
        'tenant.created_at',
        queryParams.sort_order.toUpperCase() as 'ASC' | 'DESC',
      );
    } else if (queryParams.sort_by === 'name' && queryParams?.sort_order) {
      qb.orderBy(
        'tenant.profile_name',
        queryParams.sort_order.toUpperCase() as 'ASC' | 'DESC',
      );
    } else if (queryParams.sort_by === 'property' && queryParams?.sort_order) {
      qb.orderBy(
        'property.name',
        queryParams.sort_order.toUpperCase() as 'ASC' | 'DESC',
      );
    } else if (queryParams.sort_by && queryParams?.sort_order) {
      qb.orderBy(
        `property.${queryParams.sort_by}`,
        queryParams.sort_order.toUpperCase() as 'ASC' | 'DESC',
      );
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

  async getSingleTenantOfAnAdmin(
    tenantId: string,
    adminId: string,
  ): Promise<TenantDetailDto> {
    const tenantAccount = await this.accountRepository
      .createQueryBuilder('account')
      .innerJoinAndSelect('account.user', 'user')
      .leftJoinAndSelect('user.kyc', 'kyc')
      .leftJoinAndSelect(
        'user.tenant_kycs',
        'tenant_kyc',
        'tenant_kyc.admin_id = :adminId',
      ) // Filter TenantKyc by landlord
      .leftJoinAndSelect('account.rents', 'rents')
      .leftJoinAndSelect('rents.property', 'property')
      .leftJoinAndSelect('account.service_requests', 'service_requests')
      .leftJoinAndSelect('service_requests.property', 'sr_property')
      .leftJoinAndSelect('account.property_histories', 'property_histories') // join past tenancies
      .leftJoinAndSelect('property_histories.property', 'past_property') // Property for past tenancies
      .leftJoinAndSelect('account.notice_agreements', 'notice_agreements')
      .leftJoinAndSelect('notice_agreements.property', 'notice_property')
      .where('account.id = :tenantId', { tenantId })
      .andWhere((qb) => {
        // Check for current tenancy OR past tenancy (property history)
        const currentTenancySubQuery = qb
          .subQuery()
          .select('1')
          .from(PropertyTenant, 'pt')
          .innerJoin('pt.property', 'p')
          .where('pt.tenant_id = account.id')
          .andWhere('p.owner_id = :adminId')
          .getQuery();

        const pastTenancySubQuery = qb
          .subQuery()
          .select('1')
          .from(PropertyHistory, 'ph')
          .innerJoin('ph.property', 'p')
          .where('ph.tenant_id = account.id')
          .andWhere('p.owner_id = :adminId')
          .getQuery();

        return `(EXISTS ${currentTenancySubQuery} OR EXISTS ${pastTenancySubQuery})`;
      })
      .setParameters({ tenantId, adminId })
      .getOne();

    if (!tenantAccount?.id) {
      throw new HttpException(
        `Tenant with id: ${tenantId} not found`,
        HttpStatus.NOT_FOUND,
      );
    }

    // Query KYC application separately to get all data and document URLs
    const kycApplication = await this.kycApplicationRepository.findOne({
      where: { tenant_id: tenantId },
      order: { created_at: 'DESC' }, // Get the most recent application
    });

    return this.formatTenantData(tenantAccount, kycApplication, adminId);
  }

  private formatTenantData(
    account: Account,
    kycApplication?: KYCApplication | null,
    adminId?: string,
  ): TenantDetailDto {
    const user = account.user;
    const kyc = user.kyc ?? {}; // Get the joined old KYC data
    const tenantKyc = user.tenant_kycs?.[0]; // Get the joined TenantKyc data (preferred, filtered by admin_id)

    // Filter data by adminId if provided
    const rents = adminId
      ? account.rents?.filter((r) => r.property?.owner_id === adminId) || []
      : account.rents || [];

    const serviceRequests = adminId
      ? account.service_requests?.filter(
          (sr) => sr.property?.owner_id === adminId,
        ) || []
      : account.service_requests || [];

    const propertyHistories = adminId
      ? account.property_histories?.filter(
          (ph) => ph.property?.owner_id === adminId,
        ) || []
      : account.property_histories || [];

    const noticeAgreements = adminId
      ? account.notice_agreements?.filter(
          (na) => na.property?.owner_id === adminId,
        ) || []
      : account.notice_agreements || [];

    // Debug logging
    console.log('Total rents loaded:', rents.length);
    if (rents.length > 0) {
      console.log(
        'Rent records:',
        rents.map((r) => ({
          id: r.id,
          rent_status: r.rent_status,
          property_id: r.property_id,
          has_property: !!r.property,
        })),
      );
    }

    // Find the most recent ACTIVE rent record for current details
    const activeRent = rents
      ?.filter((rent) => rent.rent_status === RentStatusEnum.ACTIVE)
      .sort(
        (a, b) =>
          new Date(b.expiry_date).getTime() - new Date(a.expiry_date).getTime(),
      )[0];
    const property = activeRent?.property;

    console.log('Active rent found:', !!activeRent);
    console.log('Property found:', !!property);
    if (activeRent) {
      console.log('Active rent details:', {
        id: activeRent.id,
        rent_status: activeRent.rent_status,
        property_id: activeRent.property_id,
        property_name: property?.name,
      });
    }

    // Aggregate documents from different sources if necessary
    const documents = noticeAgreements
      .flatMap((na) => na.notice_documents)
      .map((doc, index) => ({
        id: `${account.id}-doc-${index}`, // Generate a stable ID
        name: doc.name ?? 'Untitled Document',
        url: doc.url,
        type: doc.type ?? 'General',
        uploadDate: new Date().toISOString(),
      }));

    // Build the combined history timeline
    const paymentEvents = rents.map((rent) => ({
      id: rent.id,
      type: 'payment' as const,
      title: 'Rent Payment Received',
      description: `Rent payment of ${rent.amount_paid} for the period ${new Date(rent.rent_start_date).toLocaleDateString()}`,
      date: new Date(rent.created_at!).toISOString(),
      time: new Date(rent.created_at!).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
      amount: rent.amount_paid,
      status: rent.payment_status,
    }));

    const maintenanceEvents = serviceRequests.map((sr) => ({
      id: sr.id,
      type: 'maintenance' as const,
      title: `Maintenance Request Submitted`,
      description: sr.issue_category,
      date: new Date(sr.date_reported).toISOString(),
      time: new Date(sr.date_reported).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
    }));

    const history = [...paymentEvents, ...maintenanceEvents].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );

    return {
      id: account.id,

      // Personal info - prioritize KYC Application, then TenantKyc, then User
      firstName:
        kycApplication?.first_name ?? tenantKyc?.first_name ?? user.first_name,
      lastName:
        kycApplication?.last_name ?? tenantKyc?.last_name ?? user.last_name,
      phone:
        kycApplication?.phone_number ??
        tenantKyc?.phone_number ??
        user.phone_number,
      email: kycApplication?.email ?? tenantKyc?.email ?? account.email,
      dateOfBirth:
        (tenantKyc?.date_of_birth
          ? typeof tenantKyc.date_of_birth === 'string'
            ? tenantKyc.date_of_birth
            : tenantKyc.date_of_birth instanceof Date
              ? tenantKyc.date_of_birth.toISOString()
              : null
          : null) ??
        (user.date_of_birth
          ? typeof user.date_of_birth === 'string'
            ? user.date_of_birth
            : user.date_of_birth instanceof Date
              ? user.date_of_birth.toISOString()
              : null
          : null) ??
        null,
      gender:
        kycApplication?.gender ?? tenantKyc?.gender ?? user.gender ?? null,
      stateOfOrigin:
        kycApplication?.state_of_origin ??
        tenantKyc?.state_of_origin ??
        user.state_of_origin ??
        kyc.state_of_origin ??
        '',
      lga: user.lga ?? kyc.lga_of_origin ?? null,
      nationality:
        kycApplication?.nationality ??
        tenantKyc?.nationality ??
        user.nationality ??
        kyc.nationality ??
        null,
      maritalStatus:
        kycApplication?.marital_status ??
        tenantKyc?.marital_status ??
        user.marital_status ??
        kyc.marital_status ??
        null,
      religion: kycApplication?.religion ?? tenantKyc?.religion ?? null,

      // Employment Info - prioritize KYC Application
      employmentStatus:
        kycApplication?.employment_status ??
        tenantKyc?.employment_status ??
        user.employment_status ??
        null,
      employerName:
        kycApplication?.employer_name ??
        tenantKyc?.employer_name ??
        user.employer_name ??
        kyc.employers_name ??
        null,
      employerAddress:
        kycApplication?.employer_address ??
        tenantKyc?.employer_address ??
        user.employer_address ??
        kyc.employers_address ??
        null,
      jobTitle:
        kycApplication?.job_title ??
        tenantKyc?.job_title ??
        user.job_title ??
        null,
      workEmail: user.work_email ?? null,
      monthlyIncome: kycApplication?.monthly_net_income
        ? parseFloat(kycApplication.monthly_net_income)
        : tenantKyc?.monthly_net_income
          ? parseFloat(tenantKyc.monthly_net_income)
          : (user.monthly_income ??
            (kyc ? parseFloat(kyc.monthly_income) : null)),
      employerPhoneNumber:
        kycApplication?.employer_phone_number ??
        tenantKyc?.employer_phone_number ??
        null,
      lengthOfEmployment: kycApplication?.length_of_employment ?? null,

      // Residence info - prioritize KYC Application
      currentAddress:
        kycApplication?.contact_address ??
        tenantKyc?.current_residence ??
        kyc.former_house_address ??
        null,

      // Next of Kin Info - prioritize KYC Application reference1 fields
      nokName:
        kycApplication?.reference1_name ?? tenantKyc?.reference1_name ?? null,
      nokRelationship:
        kycApplication?.reference1_relationship ??
        tenantKyc?.reference1_relationship ??
        null,
      nokPhone:
        kycApplication?.reference1_phone_number ??
        tenantKyc?.reference1_phone_number ??
        null,
      nokEmail: kycApplication?.reference1_email ?? null,
      nokAddress:
        kycApplication?.reference1_address ??
        tenantKyc?.reference1_address ??
        null,

      // Guarantor Info - prioritize KYC Application reference2 fields
      guarantorName:
        kycApplication?.reference2_name ??
        tenantKyc?.reference2_name ??
        kyc?.guarantor ??
        null,
      guarantorPhone:
        kycApplication?.reference2_phone_number ??
        tenantKyc?.reference2_phone_number ??
        kyc.guarantor_phone_number ??
        null,
      guarantorEmail: null, // Not in KYC application
      guarantorAddress:
        kycApplication?.reference2_address ??
        tenantKyc?.reference2_address ??
        kyc.guarantor_address ??
        null,
      guarantorRelationship:
        kycApplication?.reference2_relationship ??
        tenantKyc?.reference2_relationship ??
        null,
      guarantorOccupation:
        kycApplication?.occupation ?? tenantKyc?.occupation ?? null,

      // Tenancy Proposal Information (from KYC Application)
      intendedUseOfProperty: kycApplication?.intended_use_of_property ?? null,
      numberOfOccupants: kycApplication?.number_of_occupants ?? null,
      numberOfCarsOwned: kycApplication?.number_of_cars_owned ?? null,
      proposedRentAmount: kycApplication?.proposed_rent_amount ?? null,
      rentPaymentFrequency: kycApplication?.rent_payment_frequency ?? null,
      additionalNotes: kycApplication?.additional_notes ?? null,

      // Include TenantKyc ID for frontend updates
      tenantKycId: tenantKyc?.id ?? null,

      // Passport Photo URL from KYC Application
      passportPhotoUrl: kycApplication?.passport_photo_url ?? null,

      // current tenancy info
      property: property?.name || '——',
      propertyId: property?.id || '——',
      propertyAddress: property?.location || '——',
      propertyStatus: property?.property_status || 'Vacant',
      leaseStartDate: activeRent?.rent_start_date
        ? typeof activeRent.rent_start_date === 'string'
          ? activeRent.rent_start_date
          : activeRent.rent_start_date instanceof Date
            ? activeRent.rent_start_date.toISOString()
            : null
        : null,
      leaseEndDate: activeRent?.lease_agreement_end_date
        ? typeof activeRent.lease_agreement_end_date === 'string'
          ? activeRent.lease_agreement_end_date
          : activeRent.lease_agreement_end_date instanceof Date
            ? activeRent.lease_agreement_end_date.toISOString()
            : null
        : null,
      tenancyStatus: activeRent?.rent_status ?? 'Inactive',
      rentAmount: activeRent?.rental_price || 0,
      serviceCharge: activeRent?.service_charge || 0,
      rentFrequency: activeRent?.payment_frequency || 'Annually',
      rentStatus: activeRent?.payment_status || '——',
      nextRentDue: activeRent?.expiry_date
        ? typeof activeRent.expiry_date === 'string'
          ? activeRent.expiry_date
          : activeRent.expiry_date instanceof Date
            ? activeRent.expiry_date.toISOString()
            : null
        : null,
      outstandingBalance: 0, // Placeholder, calculate if needed
      paymentFrequency: activeRent?.payment_frequency || null,
      paymentHistory: (account.rents || [])
        .map((rent) => ({
          id: rent.id,
          date: new Date(rent.created_at!).toISOString(),
          amount: rent.amount_paid,
          status: rent.payment_status,
          reference: rent.rent_receipts?.[0] || null, // Assuming first receipt is a reference
        }))
        .sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
        ),

      // Aggregated Lists
      documents: documents,
      maintenanceIssues: (account.service_requests || []).map((sr) => ({
        id: sr.id,
        title: sr.issue_category,
        description: sr.description,
        status: sr.status || '——',
        reportedDate: new Date(sr.date_reported).toISOString(),
        resolvedDate: sr.resolution_date
          ? new Date(sr.resolution_date).toISOString()
          : null,
        priority: sr.status === 'URGENT' ? 'High' : 'Medium',
      })),
      activeTenancies: [
        // Active tenancies (current properties with rent details)
        ...rents
          .filter((rent) => rent.rent_status === RentStatusEnum.ACTIVE)
          .map((rent) => ({
            id: rent.id,
            property: rent.property?.name ?? 'Unknown Property',
            propertyId: rent.property_id,
            rentAmount: rent.rental_price || 0,
            serviceCharge: rent.service_charge || 0,
            rentFrequency: rent.payment_frequency || 'Annually',
            rentDueDate:
              typeof rent.expiry_date === 'string'
                ? rent.expiry_date
                : rent.expiry_date instanceof Date
                  ? rent.expiry_date.toISOString()
                  : null,
            tenancyStartDate:
              typeof rent.rent_start_date === 'string'
                ? rent.rent_start_date
                : rent.rent_start_date instanceof Date
                  ? rent.rent_start_date.toISOString()
                  : null,
            status: 'Active' as const,
          })),
      ],
      tenancyHistory: [
        // Historical tenancy records (past properties from property_histories)
        ...(propertyHistories || [])
          .filter((ph) => ph.move_out_date) // Only include completed tenancies
          .map((ph) => ({
            id: ph.id,
            property: ph.property?.name ?? 'Unknown Property',
            startDate:
              typeof ph.move_in_date === 'string'
                ? ph.move_in_date
                : ph.move_in_date instanceof Date
                  ? ph.move_in_date.toISOString()
                  : '——',
            endDate: ph.move_out_date
              ? typeof ph.move_out_date === 'string'
                ? ph.move_out_date
                : ph.move_out_date instanceof Date
                  ? ph.move_out_date.toISOString()
                  : null
              : null,
            status: 'Completed' as const,
          })),
      ],

      // System Info
      whatsAppConnected: false, // Add real logic

      history: history,
      kycInfo: {
        kycStatus: kycApplication
          ? 'Verified'
          : account.kyc
            ? 'Verified'
            : 'Not Submitted',
        kycSubmittedDate: kycApplication?.created_at
          ? new Date(kycApplication.created_at).toISOString()
          : account.kyc?.created_at
            ? new Date(account.kyc.created_at).toISOString()
            : null,
        kycDocuments: kycApplication
          ? [
              ...(kycApplication.passport_photo_url
                ? [
                    {
                      id: `kyc-passport-${kycApplication.id}`,
                      name: 'Passport Photo',
                      type: 'Passport',
                      url: kycApplication.passport_photo_url,
                      uploadDate: kycApplication.created_at
                        ? new Date(kycApplication.created_at).toISOString()
                        : new Date().toISOString(),
                    },
                  ]
                : []),
              ...(kycApplication.id_document_url
                ? [
                    {
                      id: `kyc-id-${kycApplication.id}`,
                      name: 'ID Document',
                      type: 'ID',
                      url: kycApplication.id_document_url,
                      uploadDate: kycApplication.created_at
                        ? new Date(kycApplication.created_at).toISOString()
                        : new Date().toISOString(),
                    },
                  ]
                : []),
              ...(kycApplication.employment_proof_url
                ? [
                    {
                      id: `kyc-employment-${kycApplication.id}`,
                      name: 'Employment Proof',
                      type: 'Employment',
                      url: kycApplication.employment_proof_url,
                      uploadDate: kycApplication.created_at
                        ? new Date(kycApplication.created_at).toISOString()
                        : new Date().toISOString(),
                    },
                  ]
                : []),
              ...(kycApplication.business_proof_url
                ? [
                    {
                      id: `kyc-business-${kycApplication.id}`,
                      name: 'Business Proof',
                      type: 'Business',
                      url: kycApplication.business_proof_url,
                      uploadDate: kycApplication.created_at
                        ? new Date(kycApplication.created_at).toISOString()
                        : new Date().toISOString(),
                    },
                  ]
                : []),
            ]
          : [],
      },
    };
  }

  async uploadLogos(
    userId: string,
    files: Express.Multer.File[],
  ): Promise<Users> {
    const user = await this.usersRepository.findOne({
      where: { id: userId, role: RolesEnum.LANDLORD },
    });

    if (!user) {
      throw new HttpException('Admin not found', HttpStatus.NOT_FOUND);
    }

    try {
      const uploadedUrls = await Promise.all(
        files.map((file) =>
          this.fileUploadService.uploadFile(file, 'admin-logos'),
        ),
      );

      const updatedUser = await this.usersRepository.save({
        ...user,
        logo_urls: uploadedUrls.map((upload) => upload.secure_url),
      });

      return updatedUser;
    } catch (error) {
      throw new HttpException(
        'Error uploading logos',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async createUserKyc(userId: string, data: CreateKycDto): Promise<KYC> {
    const queryRunner =
      this.accountRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const user = await queryRunner.manager.findOne(Account, {
        where: { id: userId },
        relations: ['kyc'],
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      if (user.kyc) {
        throw new BadRequestException('KYC already submitted');
      }

      const newKyc = this.kycRepository.create({
        ...data,
        user,
      });

      const savedKyc = await queryRunner.manager.save(KYC, newKyc);

      user.is_verified = true;
      await queryRunner.manager.save(Account, user);

      await queryRunner.commitTransaction();
      return savedKyc;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw new HttpException(
        error?.message || 'An error occurred while submitting KYC',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    } finally {
      await queryRunner.release();
    }
  }

  async update(userId: string, updateKycDto: UpdateKycDto): Promise<KYC> {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
      relations: ['kyc'],
    });

    if (!user || !user.kyc) {
      throw new NotFoundException('KYC record not found for this user');
    }

    const updatedKyc = this.kycRepository.merge(user.kyc, updateKycDto);
    return this.kycRepository.save(updatedKyc);
  }

  async createLandlord(
    data: CreateLandlordDto,
  ): Promise<Omit<Users, 'password'>> {
    const existingAccount = await this.accountRepository.findOne({
      where: { email: data.email, role: RolesEnum.LANDLORD },
    });

    if (existingAccount) {
      throw new BadRequestException(
        'Landlord Account with this email already exists',
      );
    }

    if (!data.password) {
      throw new BadRequestException('Password is required');
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
        role: RolesEnum.LANDLORD,
        is_verified: true,
        email: data.email,
      });
    }

    const landlordAccount = this.accountRepository.create({
      user,
      email: data.email,
      password: await this.utilService.hashPassword(data.password),
      role: RolesEnum.LANDLORD,
      profile_name: data.agency_name,
      is_verified: true,
    });

    await this.accountRepository.save(landlordAccount);

    const { password, ...result } = user;
    return result as Omit<Users, 'password'>;
  }

  async createAdmin(data: CreateAdminDto): Promise<Omit<Users, 'password'>> {
    const existingAccount = await this.accountRepository.findOne({
      where: { email: data.email, role: RolesEnum.ADMIN },
    });

    if (existingAccount) {
      throw new BadRequestException(
        'Admin Account with this email already exists',
      );
    }

    if (!data.password) {
      throw new BadRequestException('Password is required');
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
        role: RolesEnum.ADMIN,
        is_verified: true,
        email: data.email,
      });

      console.log('user', user);
    }

    const adminAccount = this.accountRepository.create({
      user,
      email: data.email,
      password: await this.utilService.hashPassword(data.password),
      role: RolesEnum.ADMIN,
      profile_name: `${user.first_name}'s Admin Account`,
      is_verified: true,
    });

    await this.accountRepository.save(adminAccount);

    const { password, ...result } = user;
    return result as Omit<Users, 'password'>;
  }
  //create user that are admin
  async createAdminOld(data: CreateAdminDto): Promise<Omit<Users, 'password'>> {
    const existing = await this.usersRepository.findOne({
      where: { email: data.email },
    });

    if (existing) {
      throw new BadRequestException('User with this email already exists');
    }

    if (!data.password) {
      throw new BadRequestException('Password is required');
    }

    const hashedPassword = await this.utilService.hashPassword(data.password);

    const user = this.usersRepository.create({
      ...data,
      role: RolesEnum.LANDLORD,
      password: hashedPassword,
      is_verified: true,
    });

    const savedUser = await this.usersRepository.save(user);

    await this.accountRepository.save({
      role: RolesEnum.LANDLORD,
      user: savedUser,
      profile_name: `${savedUser.first_name}'s Admin Account`,
    });

    const { password, ...result } = savedUser;
    return result as Omit<Users, 'password'>;
  }

  async createCustomerRep(
    data: CreateCustomerRepDto,
  ): Promise<Omit<Users, 'password'>> {
    const queryRunner = this.dataSource.createQueryRunner();
    const existingAccount = await this.accountRepository.findOne({
      where: { email: data.email, role: RolesEnum.REP },
    });

    if (existingAccount) {
      throw new BadRequestException(
        'Rep Account with this email already exists',
      );
    }

    // if (!data.password) {
    //   throw new BadRequestException('Password is required');
    // }

    let user = await this.usersRepository.findOne({
      where: { email: data.email },
    });

    if (!user) {
      user = await this.usersRepository.save({
        phone_number: data.phone_number,
        first_name: data.first_name,
        last_name: data.last_name,
        role: RolesEnum.REP,
        is_verified: true,
        email: data.email,
      });

      console.log('user', user);
    }

    const repAccount = this.accountRepository.create({
      user,
      email: data.email,
      password: data.password
        ? await this.utilService.hashPassword(data.password)
        : '',
      role: RolesEnum.REP,
      profile_name: `${data.first_name} ${data.last_name}`,
      is_verified: true,
    });

    await this.accountRepository.save(repAccount);

    const token = await this.generatePasswordResetToken(
      repAccount.id,
      queryRunner,
    );

    const resetLink = `${this.configService.get<string>('FRONTEND_URL')}/reset-password?token=${token}`;
    const emailContent = clientSignUpEmailTemplate(data.first_name, resetLink);

    await this.utilService.sendEmail(
      data.email,
      EmailSubject.WELCOME_EMAIL,
      emailContent,
    );
    const { password, ...result } = user;
    return result as Omit<Users, 'password'>;
  }

  async getSubAccounts(adminId: string): Promise<Account[]> {
    // from JWT
    const subAccounts = await this.accountRepository.find({
      where: {
        creator_id: adminId,
        // is_sub_account: true,
      },
      relations: ['user'],
    });

    return subAccounts;
  }

  async switchAccount({
    targetAccountId,
    currentAccount,
    res,
  }: {
    targetAccountId: string;
    currentAccount: any;
    res: Response;
  }) {
    const target = await this.accountRepository.findOne({
      where: { id: targetAccountId },
      relations: ['user'], // you need this to access target.user.*
    });

    if (!target || target.creator_id !== currentAccount.id) {
      throw new ForbiddenException('You cannot switch to this account');
    }

    const tokenPayload = {
      id: target.id,
      first_name: target.user.first_name,
      last_name: target.user.last_name,
      email: target.email,
      phone_number: target.user.phone_number,
      role: target.role,
    } as any;

    const access_token = await this.authService.generateToken(tokenPayload);

    res.cookie('access_token', access_token, {
      httpOnly: true,
      secure: this.configService.get<string>('NODE_ENV') === 'production',
      expires: moment().add(8, 'hours').toDate(),
      sameSite: 'none',
    });

    return { success: true, message: 'Switched account successfully' };
  }

  async assignCollaboratorToTeam(
    user_id: string,
    team_member: {
      email: string;
      permissions: string[];
      role: RolesEnum;
      first_name: string;
      last_name: string;
      phone_number: string;
    },
  ) {
    return await this.dataSource.transaction(async (manager) => {
      try {
        // Ensure only LANDLORD can add to team
        const account = await manager
          .getRepository(Account)
          .findOne({ where: { id: user_id } });
        if (!account || account.role !== RolesEnum.LANDLORD) {
          throw new HttpException(
            `${account ? account.role : 'Unknown role'} cannot add to team`,
            HttpStatus.FORBIDDEN,
          );
        }
        // 1. Get or create team
        let team = await manager.getRepository(Team).findOne({
          where: { creatorId: user_id },
        });

        if (!team) {
          const teamAdminAccount = await manager
            .getRepository(Account)
            .findOne({
              where: { id: user_id, role: RolesEnum.LANDLORD },
            });

          if (!teamAdminAccount) {
            throw new HttpException(
              'Team admin account not found',
              HttpStatus.NOT_FOUND,
            );
          }

          team = manager.getRepository(Team).create({
            name: `${teamAdminAccount.profile_name} Team`,
            creatorId: teamAdminAccount.id,
          });

          await manager.getRepository(Team).save(team);
        }

        // 2. Ensure user really owns this team
        if (team.creatorId !== user_id) {
          throw new HttpException(
            'Not authorized to add members to this team',
            HttpStatus.FORBIDDEN,
          );
        }

        // 3. Ensure collaborator is not already a member
        const existingMember = await manager.getRepository(TeamMember).findOne({
          where: { email: team_member.email, teamId: team.id },
        });

        if (existingMember) {
          throw new HttpException(
            'Collaborator already in team',
            HttpStatus.CONFLICT,
          );
        }

        // 4. Normalize phone number
        let normalized_phone_number = team_member.phone_number.replace(
          /\D/g,
          '',
        ); // Remove non-digits
        if (!normalized_phone_number.startsWith('234')) {
          normalized_phone_number =
            '234' + normalized_phone_number.replace(/^0+/, ''); // Remove leading 0s
        }

        // 5. Get or create user - check by phone number first to avoid duplicates
        let user = await manager.getRepository(Users).findOne({
          where: { phone_number: normalized_phone_number },
        });

        if (!user) {
          // Create new user if doesn't exist
          user = await manager.getRepository(Users).save({
            phone_number: normalized_phone_number,
            first_name: team_member.first_name,
            last_name: team_member.last_name,
            role: team_member.role,
            is_verified: true,
            email: team_member.email,
          });
        }

        // 6. Check if user already has a facility_manager account
        let userAccount = await manager.getRepository(Account).findOne({
          where: {
            user: { id: user.id },
            role: team_member.role,
          },
        });

        if (!userAccount) {
          // Create facility_manager account for this user
          const generatedPassword = await this.utilService.generatePassword();
          userAccount = manager.getRepository(Account).create({
            user,
            email: team_member.email,
            password: generatedPassword,
            role: team_member.role,
            profile_name: `${team_member.first_name} ${team_member.last_name}`,
            is_verified: true,
          });

          await manager.getRepository(Account).save(userAccount);
        }

        // 7. Add collaborator to team
        const newTeamMember = manager.getRepository(TeamMember).create({
          email: team_member.email,
          permissions: team_member.permissions,
          teamId: team.id,
          accountId: userAccount.id,
          role: team_member.role,
        });

        await manager.getRepository(TeamMember).save(newTeamMember);

        await this.whatsappBotService.sendToFacilityManagerWithTemplate({
          phone_number: normalized_phone_number,
          name: this.utilService.toSentenceCase(team_member.first_name),
          team: team.name,
          role: 'Facility Manager',
        });

        return newTeamMember;
      } catch (error) {
        console.error('Error assigning collaborator to team:', error);
        if (error instanceof HttpException) throw error;
        throw new HttpException(
          error.message || 'Could not assign collaborator',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    });
  }

  /**
   * Gets team members for the team owned by a landlord.
   * If the landlord does not have a team, it creates one automatically.
   * @param requester the authenticated account making the request
   */
  async getTeamMembers(requester: Account): Promise<TeamMemberDto[]> {
    // 1. Ensure requester is a LANDLORD
    if (requester.role !== RolesEnum.LANDLORD) {
      throw new ForbiddenException('Only landlords can manage teams');
    }

    // 2. Get or create team with requester as creator
    let team = await this.teamRepository.findOne({
      where: { creatorId: requester.id },
    });

    // If no team exists, create one
    if (!team) {
      const teamName = requester.profile_name
        ? `${requester.profile_name} Team`
        : 'My Team';

      const newTeam = this.teamRepository.create({
        name: teamName,
        creatorId: requester.id,
      });
      team = await this.teamRepository.save(newTeam);

      // If a new team was created, return empty array as there are no members yet
      return [];
    }

    // 3. Fetch team members for existing team
    const members = await this.teamMemberRepository.find({
      where: { teamId: team.id },
      relations: ['account', 'account.user'],
    });

    // 4. Map the database entities to DTOs for response
    return members.map((member) => ({
      id: member.id,
      name:
        member.account?.profile_name ??
        `${member.account?.user.first_name} ${member.account?.user.last_name}`,
      email: member.email,
      phone_number: member.account?.user.phone_number ?? '——',
      role: member.role,
      date: member.created_at?.toString() || '',
    }));
  }

  /**
   * Updates a team member's details (name and phone).
   * @param id team member ID
   * @param data updated name and phone
   * @param requester the authenticated account making the request
   */
  async updateTeamMember(
    id: string,
    data: { name: string; phone: string },
    requester: Account,
  ) {
    // 1. Ensure requester is a LANDLORD
    if (requester.role !== RolesEnum.LANDLORD) {
      throw new ForbiddenException('Only landlords can manage teams');
    }

    // 2. Find the team member
    const teamMember = await this.teamMemberRepository.findOne({
      where: { id },
      relations: ['team', 'account', 'account.user'],
    });

    if (!teamMember) {
      throw new NotFoundException('Team member not found');
    }

    // 3. Ensure requester owns the team
    if (teamMember.team.creatorId !== requester.id) {
      throw new ForbiddenException('You cannot update this team member');
    }

    // 4. Update user details
    const [first_name, last_name] = data.name.split(' ');
    if (teamMember.account?.user) {
      teamMember.account.user.first_name = this.utilService.toSentenceCase(
        first_name || data.name,
      );
      teamMember.account.user.last_name = last_name
        ? this.utilService.toSentenceCase(last_name)
        : '';
      teamMember.account.user.phone_number =
        this.utilService.normalizePhoneNumber(data.phone);

      await this.usersRepository.save(teamMember.account.user);

      // Update account profile name
      teamMember.account.profile_name = data.name;
      await this.accountRepository.save(teamMember.account);
    }

    return { success: true, message: 'Team member updated successfully' };
  }

  /**
   * Deletes a team member.
   * @param id team member ID
   * @param requester the authenticated account making the request
   */
  async deleteTeamMember(id: string, requester: Account) {
    // 1. Ensure requester is a LANDLORD
    if (requester.role !== RolesEnum.LANDLORD) {
      throw new ForbiddenException('Only landlords can manage teams');
    }

    // 2. Find the team member
    const teamMember = await this.teamMemberRepository.findOne({
      where: { id },
      relations: ['team'],
    });

    if (!teamMember) {
      throw new NotFoundException('Team member not found');
    }

    // 3. Ensure requester owns the team
    if (teamMember.team.creatorId !== requester.id) {
      throw new ForbiddenException('You cannot delete this team member');
    }

    // 4. Delete the team member
    await this.teamMemberRepository.remove(teamMember);

    return { success: true, message: 'Team member deleted successfully' };
  }

  async getWhatsappText(from, message) {
    return await this.whatsappBotService.sendText(from, message);
  }

  async sendPropertiesNotification({ phone_number, name, property_name }) {
    return await this.whatsappBotService.sendToPropertiesCreatedTemplate({
      phone_number,
      name,
      property_name,
    });
  }

  async sendUserAddedTemplate({ phone_number, name, user, property_name }) {
    return await this.whatsappBotService.sendUserAddedTemplate({
      phone_number,
      name,
      user,
      property_name,
    });
  }
  async getWaitlist() {
    return await this.waitlistRepository.find();
  }

  async getLandlords() {
    return await this.usersRepository.find({
      where: {
        role: RolesEnum.LANDLORD,
      },
    });
  }
}
