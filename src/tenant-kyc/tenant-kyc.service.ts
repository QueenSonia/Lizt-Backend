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
import { RolesEnum } from 'src/base.entity';

@Injectable()
export class TenantKycService {
  constructor(
    @InjectRepository(TenantKyc)
    private tenantKycRepo: Repository<TenantKyc>,

    @InjectRepository(Account)
    private accountRepo: Repository<Account>,
  ) {}

  async create(dto: CreateTenantKycDto) {
    const admin = await this.accountRepo.findOneBy({
      id: dto.admin_id,
      role: RolesEnum.ADMIN,
    });

    if (!admin)
      throw new BadRequestException(
        `Invalid or non-existent ref with id: ${dto.admin_id}`,
      );

    const identity_hash = this.generateIdentityHash(dto);
    const existingKyc = await this.tenantKycRepo.findOneBy({ identity_hash });

    if (existingKyc)
      throw new ConflictException('Duplicate request; awaiting review.');

    await this.tenantKycRepo.save({ ...dto, identity_hash });
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

  async update(admin_id: string, id: string, dto: UpdateTenantKycDto) {
    const kyc_data = await this.tenantKycRepo.findOneBy({
      id,
      admin_id,
    });

    if (!kyc_data) throw new NotFoundException();

    Object.assign(kyc_data, dto);

    return await this.tenantKycRepo.save(kyc_data);
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
      dto.date_of_birth,
      dto.email?.toLowerCase() || '',
      dto.phone_number || '',
    ];
    return crypto.createHash('sha256').update(fields.join('|')).digest('hex');
  }
}
