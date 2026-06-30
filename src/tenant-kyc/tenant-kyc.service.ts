import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';
import { ArrayContains, In, Repository } from 'typeorm';
import { assertLandlordInScope } from 'src/common/scope/scope.util';

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
      roles: ArrayContains([RolesEnum.LANDLORD]),
    });

    if (!landlord)
      throw new BadRequestException(
        `Invalid or non-existent ref with id: ${dto.landlord_id}`,
      );

    // Check for duplicate phone number with this landlord
    const existingKyc = await this.tenantKycRepo.findOneBy({
      phone_number: dto.phone_number,
      admin_id: dto.landlord_id,
    });

    if (existingKyc)
      throw new ConflictException(
        'You have already submitted KYC information to this landlord.',
      );

    // Map landlord_id to admin_id for the entity
    const { landlord_id, ...kycData } = dto;
    await this.tenantKycRepo.save({
      ...kycData,
      admin_id: landlord_id,
    });
  }

  async createForExistingTenant(
    dto: CreateTenantKycDto & { tenant_id?: string; property_id?: string },
    managedLandlordIds: string[],
  ) {
    // Act-on-behalf: the KYC is filed for the landlord named in the payload.
    assertLandlordInScope(managedLandlordIds, dto.landlord_id);
    const landlord = await this.accountRepo.findOneBy({
      id: dto.landlord_id,
      roles: ArrayContains([RolesEnum.LANDLORD]),
    });

    if (!landlord)
      throw new BadRequestException(
        `Invalid or non-existent landlord with id: ${dto.landlord_id}`,
      );

    // If tenant_id is provided, find the existing tenant
    let tenant: Users | null = null;
    if (dto.tenant_id) {
      const tenantAccount = await this.accountRepo.findOne({
        where: {
          id: dto.tenant_id,
          roles: ArrayContains([RolesEnum.TENANT]),
        },
        relations: ['user'],
      });

      if (!tenantAccount || !tenantAccount.user) {
        throw new BadRequestException(
          `Invalid or non-existent tenant with id: ${dto.tenant_id}`,
        );
      }
      tenant = tenantAccount.user;
    }

    // Check for duplicate phone number with this landlord
    const existingKyc = await this.tenantKycRepo.findOneBy({
      phone_number: dto.phone_number,
      admin_id: dto.landlord_id,
    });

    if (existingKyc)
      throw new ConflictException(
        'KYC information already exists for this tenant with this landlord.',
      );

    // Map landlord_id to admin_id for the entity
    const { landlord_id, tenant_id, property_id, ...kycData } = dto;

    // Create the KYC record
    const kycEntity = this.tenantKycRepo.create({
      ...kycData,
      admin_id: landlord_id,
      user_id: tenant?.id,
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

  async findAll(
    landlordIds: string | string[],
    query: ParseTenantKycQueryDto,
  ) {
    const ids = Array.isArray(landlordIds)
      ? landlordIds
      : landlordIds
        ? [landlordIds]
        : [];
    const { limit, page, fields } = query;

    const selectFields = fields ? fields.split(',').filter(Boolean) : undefined;

    if (ids.length === 0) {
      return {
        data: [],
        pagination: {
          total: 0,
          page: Number(page) || 1,
          limit: Math.min(Number(limit) || 10, 50),
          totalPages: 0,
        },
      };
    }

    const { data, pagination } = await paginate(this.tenantKycRepo, {
      page,
      limit,
      options: {
        // admin_id is a misnomer — it holds the landlord's Account.id (see
        // create(), which maps landlord_id → admin_id). Scope to the managed set.
        where: { admin_id: In(ids) },
        select: selectFields as any,
        order: { created_at: 'DESC' },
      },
    });

    return { data, pagination };
  }

  async findOne(managedLandlordIds: string[], id: string) {
    const kyc_data = await this.tenantKycRepo.findOneBy({ id });

    if (!kyc_data) throw new NotFoundException();

    // admin_id holds the owning landlord's Account.id (see create()).
    assertLandlordInScope(managedLandlordIds, kyc_data.admin_id);

    return kyc_data;
  }

  async findByUserId(user_id: string) {
    const kyc_data = await this.tenantKycRepo.findOneBy({
      user_id,
    });

    return kyc_data;
  }

  async update(
    managedLandlordIds: string[],
    id: string,
    dto: UpdateTenantKycDto,
  ) {
    const kyc_data = await this.tenantKycRepo.findOne({
      where: { id },
      relations: ['user'],
    });

    if (!kyc_data) throw new NotFoundException();

    assertLandlordInScope(managedLandlordIds, kyc_data.admin_id);

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
      if (dto.work_address) updateData.employer_address = dto.work_address; // User entity might NOT be updated yet! Check User entity.
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

  async deleteOne(managedLandlordIds: string[], id: string) {
    const kyc_data = await this.tenantKycRepo.findOneBy({ id });
    if (!kyc_data) throw new NotFoundException('KYC record not found');

    assertLandlordInScope(managedLandlordIds, kyc_data.admin_id);

    await this.tenantKycRepo.delete({ id });
  }

  async deleteMany(
    managedLandlordIds: string[],
    { ids }: BulkDeleteTenantKycDto,
  ) {
    const scope = Array.isArray(managedLandlordIds) ? managedLandlordIds : [];
    if (scope.length === 0 || !ids?.length) return;
    // Only delete rows belonging to a landlord the requester manages.
    await this.tenantKycRepo.delete({ id: In(ids), admin_id: In(scope) });
  }

  async deleteAll(managedLandlordIds: string[]) {
    const scope = Array.isArray(managedLandlordIds) ? managedLandlordIds : [];
    if (scope.length === 0) return;
    await this.tenantKycRepo.delete({ admin_id: In(scope) });
  }

}
