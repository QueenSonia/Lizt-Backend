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

@Injectable()
export class TenantKycService {
  constructor(
    @InjectRepository(TenantKyc)
    private tenantKycRepo: Repository<TenantKyc>,

    @InjectRepository(Account)
    private accountRepo: Repository<Account>,

    @InjectRepository(Users)
    private usersRepo: Repository<Users>,
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

    const identity_hash = this.generateIdentityHash(dto);
    const existingKyc = await this.tenantKycRepo.findOneBy({ identity_hash });

    if (existingKyc)
      throw new ConflictException('Duplicate request; awaiting review.');

    // Map landlord_id to admin_id for the entity
    const { landlord_id, ...kycData } = dto;
    await this.tenantKycRepo.save({
      ...kycData,
      admin_id: landlord_id,
      identity_hash,
    });
  }

  async createForExistingTenant(
    dto: CreateTenantKycDto & { tenant_id?: string },
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
    let tenantAccount: Account | null = null;
    if (dto.tenant_id) {
      // First, try to find the tenant account by ID
      tenantAccount = await this.accountRepo.findOne({
        where: { id: dto.tenant_id, role: RolesEnum.TENANT },
        relations: ['user', 'user.tenant_kyc'],
      });

      if (!tenantAccount) {
        throw new BadRequestException(
          `Invalid or non-existent tenant with id: ${dto.tenant_id}`,
        );
      }

      tenant = tenantAccount.user;

      // Check if tenant already has KYC
      if (tenant.tenant_kyc) {
        throw new ConflictException('Tenant already has KYC information');
      }
    }

    const identity_hash = this.generateIdentityHash(dto);
    const existingKyc = await this.tenantKycRepo.findOneBy({ identity_hash });

    if (existingKyc)
      throw new ConflictException('Duplicate KYC request; awaiting review.');

    // Map landlord_id to admin_id for the entity
    const { landlord_id, tenant_id, ...kycData } = dto;

    // Create the KYC record
    const kycEntity = this.tenantKycRepo.create({
      ...kycData,
      admin_id: landlord_id,
      user_id: tenant?.id || undefined, // Use the actual User ID, not Account ID
      identity_hash,
    });

    const createdKyc = await this.tenantKycRepo.save(kycEntity);

    // If we have an existing tenant, update their basic info from KYC
    if (tenant) {
      await this.usersRepo.update(tenant.id, {
        first_name: dto.first_name,
        last_name: dto.last_name,
        email: dto.email || tenant.email,
        phone_number: dto.phone_number || tenant.phone_number,
        date_of_birth: dto.date_of_birth
          ? new Date(dto.date_of_birth)
          : tenant.date_of_birth,
        gender: dto.gender,
        nationality: dto.nationality,
        state_of_origin: dto.state_of_origin,
        lga: dto.local_government_area,
        marital_status: dto.marital_status,
        employment_status: dto.employment_status,
        employer_name: dto.employer_name,
        job_title: dto.job_title,
        employer_address: dto.employer_address,
        monthly_income: dto.monthly_net_income
          ? parseFloat(dto.monthly_net_income)
          : tenant.monthly_income,
      });
    }

    return {
      success: true,
      message: 'KYC information saved successfully',
      data: {
        kycId: createdKyc.id,
        tenantId: tenantAccount?.id || tenant_id, // Return the Account ID that the frontend expects
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
      if (dto.local_government_area) updateData.lga = dto.local_government_area;
      if (dto.marital_status) updateData.marital_status = dto.marital_status;
      if (dto.employment_status)
        updateData.employment_status = dto.employment_status;
      if (dto.employer_name) updateData.employer_name = dto.employer_name;
      if (dto.job_title) updateData.job_title = dto.job_title;
      if (dto.employer_address)
        updateData.employer_address = dto.employer_address;
      if (dto.monthly_net_income)
        updateData.monthly_income = parseFloat(dto.monthly_net_income);

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
