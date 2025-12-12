import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CreateTenantKycDto, UpdateTenantKycDto } from './dto';
import { TenantKyc } from './entities/tenant-kyc.entity';
import { paginate } from 'src/lib/utils';
import {
  BulkDeleteTenantKycDto,
  ParseTenantKycQueryDto,
} from './dto/others.dto';
import { Account } from 'src/users/entities/account.entity';
import { Users } from 'src/users/entities/user.entity';
import { RolesEnum } from 'src/base.entity';
import { TenanciesService } from 'src/tenancies/tenancies.service';
import { KYCApplication } from 'src/kyc-links/entities/kyc-application.entity';

@Injectable()
export class TenantKycService {
  constructor(
    @InjectRepository(TenantKyc)
    private tenantKycRepo: Repository<TenantKyc>,

    @InjectRepository(Account)
    private accountRepo: Repository<Account>,

    @InjectRepository(Users)
    private usersRepo: Repository<Users>,

    @InjectRepository(KYCApplication)
    private kycApplicationRepo: Repository<KYCApplication>,

    private readonly tenanciesService: TenanciesService,
  ) {}

  async create(dto: CreateTenantKycDto) {
    const landlord = await this.accountRepo.findOneBy({
      id: dto.landlord_id,
      role: RolesEnum.LANDLORD,
    });

    if (!landlord)
      throw new BadRequestException(
        `Invalid or non-existent ref with id: ${dto.landlord_id}`,
      );

    // Check for duplicate identity hash
    const identity_hash = this.generateIdentityHash(dto);
    const existingKyc = await this.tenantKycRepo.findOneBy({
      identity_hash,
      admin_id: dto.landlord_id,
    });

    if (existingKyc)
      throw new ConflictException(
        'You have already submitted KYC information to this landlord.',
      );

    // Check for duplicate phone number or email with this landlord
    if (dto.phone_number || dto.email) {
      const duplicateCheck = await this.tenantKycRepo
        .createQueryBuilder('kyc')
        .where('kyc.admin_id = :admin_id', { admin_id: dto.landlord_id })
        .andWhere('(kyc.phone_number = :phone_number OR kyc.email = :email)', {
          phone_number: dto.phone_number || null,
          email: dto.email || null,
        })
        .getOne();

      if (duplicateCheck) {
        const duplicateField =
          duplicateCheck.phone_number === dto.phone_number
            ? 'phone number'
            : 'email';
        throw new ConflictException(
          `A KYC record with this ${duplicateField} already exists for this landlord.`,
        );
      }
    }

    // Map landlord_id to admin_id for the entity
    const { landlord_id, ...kycData } = dto;
    await this.tenantKycRepo.save({
      ...kycData,
      admin_id: landlord_id,
      identity_hash,
    });
  }

  async createForExistingTenant(
    dto: CreateTenantKycDto & { tenant_id?: string; property_id?: string },
  ) {
    const landlord = await this.accountRepo.findOneBy({
      id: dto.landlord_id,
      role: RolesEnum.LANDLORD,
    });

    if (!landlord)
      throw new BadRequestException(
        `Invalid or non-existent landlord with id: ${dto.landlord_id}`,
      );

    // If tenant_id is provided, find the existing tenant
    let tenant: Users | null = null;
    if (dto.tenant_id) {
      const tenantAccount = await this.accountRepo.findOne({
        where: { id: dto.tenant_id, role: RolesEnum.TENANT },
        relations: ['user'],
      });

      if (!tenantAccount || !tenantAccount.user) {
        throw new BadRequestException(
          `Invalid or non-existent tenant with id: ${dto.tenant_id}`,
        );
      }
      tenant = tenantAccount.user;
    }

    // Check for duplicate identity hash
    const identity_hash = this.generateIdentityHash(dto);
    const existingKyc = await this.tenantKycRepo.findOneBy({
      identity_hash,
      admin_id: dto.landlord_id,
    });

    if (existingKyc)
      throw new ConflictException(
        'KYC information already exists for this tenant with this landlord.',
      );

    // Check for duplicate phone number or email with this landlord
    if (dto.phone_number || dto.email) {
      const duplicateCheck = await this.tenantKycRepo
        .createQueryBuilder('kyc')
        .where('kyc.admin_id = :admin_id', { admin_id: dto.landlord_id })
        .andWhere('(kyc.phone_number = :phone_number OR kyc.email = :email)', {
          phone_number: dto.phone_number || null,
          email: dto.email || null,
        })
        .getOne();

      if (duplicateCheck) {
        const duplicateField =
          duplicateCheck.phone_number === dto.phone_number
            ? 'phone number'
            : 'email';
        throw new ConflictException(
          `A KYC record with this ${duplicateField} already exists for this landlord.`,
        );
      }
    }

    // Map landlord_id to admin_id for the entity
    const { landlord_id, tenant_id, property_id, ...kycData } = dto;

    // Create the KYC record
    const kycEntity = this.tenantKycRepo.create({
      ...kycData,
      admin_id: landlord_id,
      user_id: tenant?.id,
      identity_hash,
    });

    const createdKyc = await this.tenantKycRepo.save(kycEntity);

    if (tenant && property_id) {
      const kycApplication = await this.kycApplicationRepo.findOne({
        where: { property_id, email: tenant.email },
      });

      if (kycApplication) {
        await this.tenanciesService.createTenancyFromKYC(
          kycApplication,
          tenant.id,
        );
      }
    }

    return {
      success: true,
      message: 'KYC information saved successfully',
      data: {
        kycId: createdKyc.id,
        tenantId: tenant_id,
      },
    };
  }

  async findAll(admin_id: string, query: ParseTenantKycQueryDto) {
    const { limit, page, fields } = query;

    const selectFields = fields ? fields.split(',').filter(Boolean) : undefined;

    const { data, pagination } = await paginate(this.tenantKycRepo, {
      page,
      limit,
      options: {
        where: { admin_id },
        select: selectFields as any,
        order: { created_at: 'DESC' },
      },
    });

    return { data, pagination };
  }

  async findOne(admin_id: string, id: string) {
    const kyc_data = await this.tenantKycRepo.findOneBy({
      id,
      admin_id,
    });

    if (!kyc_data) throw new NotFoundException();

    return kyc_data;
  }

  async findByUserId(user_id: string) {
    const kyc_data = await this.tenantKycRepo.findOneBy({
      user_id,
    });

    return kyc_data;
  }

  async update(admin_id: string, id: string, dto: UpdateTenantKycDto) {
    const kyc_data = await this.tenantKycRepo.findOne({
      where: { id, admin_id },
      relations: ['user'],
    });

    if (!kyc_data) throw new NotFoundException();

    Object.assign(kyc_data, dto);
    const updatedKyc = await this.tenantKycRepo.save(kyc_data);

    // If there's a linked tenant, update their basic info as well
    if (kyc_data.user_id) {
      const updateData: Partial<Users> = {};

      if (dto.first_name) updateData.first_name = dto.first_name;
      if (dto.last_name) updateData.last_name = dto.last_name;
      if (dto.email) updateData.email = dto.email;
      if (dto.phone_number) updateData.phone_number = dto.phone_number;
      if (dto.date_of_birth)
        updateData.date_of_birth = new Date(dto.date_of_birth);
      if (dto.gender) updateData.gender = dto.gender;
      if (dto.nationality) updateData.nationality = dto.nationality;
      if (dto.state_of_origin) updateData.state_of_origin = dto.state_of_origin;
      if (dto.marital_status) updateData.marital_status = dto.marital_status;
      if (dto.employment_status)
        updateData.employment_status = dto.employment_status;
      if (dto.employer_name) updateData.employer_name = dto.employer_name;
      if (dto.job_title) updateData.job_title = dto.job_title;
      if (dto.employer_address)
        updateData.employer_address = dto.employer_address;
      if (dto.monthly_net_income)
        updateData.monthly_income = parseFloat(dto.monthly_net_income);

      // Self-employed fields
      if (dto.nature_of_business)
        updateData.nature_of_business = dto.nature_of_business;
      if (dto.business_name) updateData.business_name = dto.business_name;
      if (dto.business_address)
        updateData.business_address = dto.business_address;
      if (dto.business_duration)
        updateData.business_duration = dto.business_duration;

      if (Object.keys(updateData).length > 0) {
        await this.usersRepo.update(kyc_data.user_id, updateData);
      }
    }

    return updatedKyc;
  }

  async deleteOne(admin_id: string, id: string) {
    const result = await this.tenantKycRepo.delete({ id, admin_id });

    if (result.affected === 0)
      throw new NotFoundException('KYC record not found');
  }

  async deleteMany(admin_id: string, { ids }: BulkDeleteTenantKycDto) {
    await this.tenantKycRepo.delete(ids.map((id) => ({ id, admin_id })));
  }

  async deleteAll(admin_id: string) {
    await this.tenantKycRepo.delete({ admin_id });
  }

  private generateIdentityHash(dto: CreateTenantKycDto) {
    const fields = [
      dto.first_name.trim().toLowerCase(),
      dto.last_name.trim().toLowerCase(),
      dto.date_of_birth || '',
      dto.email?.toLowerCase() || '',
      dto.phone_number || '',
    ];
    return crypto.createHash('sha256').update(fields.join('|')).digest('hex');
  }
}
