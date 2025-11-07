import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Users } from './entities/user.entity';
import { TenantKyc } from '../tenant-kyc/entities/tenant-kyc.entity';
import { Account } from './entities/account.entity';
import { RolesEnum } from '../base.entity';

@Injectable()
export class SyncTenantDataService {
  constructor(
    @InjectRepository(Users)
    private readonly usersRepository: Repository<Users>,
    @InjectRepository(TenantKyc)
    private readonly tenantKycRepository: Repository<TenantKyc>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Sync tenant names between User and TenantKyc entities
   * This method ensures data consistency by prioritizing TenantKyc data
   */
  async syncTenantNames(): Promise<{
    success: boolean;
    synced: number;
    created: number;
    errors: string[];
  }> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let synced = 0;
    let created = 0;
    const errors: string[] = [];

    try {
      // Get all tenant accounts with their users
      const tenantAccounts = await queryRunner.manager.find(Account, {
        where: { role: RolesEnum.TENANT },
        relations: ['user'],
      });

      for (const account of tenantAccounts) {
        try {
          if (!account.user) continue;

          // Check if TenantKyc record exists
          let tenantKyc = await queryRunner.manager.findOne(TenantKyc, {
            where: { user_id: account.user.id },
          });

          if (!tenantKyc) {
            // Create TenantKyc record from User data
            tenantKyc = queryRunner.manager.create(TenantKyc, {
              first_name: account.user.first_name,
              last_name: account.user.last_name,
              email: account.user.email || account.email,
              phone_number: account.user.phone_number,
              date_of_birth:
                account.user.date_of_birth || new Date('1990-01-01'),
              gender: account.user.gender || 'male',
              nationality: account.user.nationality || 'Nigerian',
              current_residence: '',
              state_of_origin: account.user.state_of_origin || '',
              local_government_area: account.user.lga || '',
              marital_status: account.user.marital_status || 'single',
              employment_status: account.user.employment_status || 'employed',
              occupation: account.user.job_title || '——',
              job_title: account.user.job_title || '——',
              employer_name: account.user.employer_name || '',
              employer_address: account.user.employer_address || '',
              monthly_net_income:
                account.user.monthly_income?.toString() || '0',
              reference1_name: '',
              reference1_address: '',
              reference1_relationship: '',
              reference1_phone_number: '',
              user_id: account.user.id,
              admin_id:
                account.creator_id ||
                account.user.creator_id ||
                account.user.id,
              identity_hash:
                `${account.user.first_name}_${account.user.last_name}_${account.user.date_of_birth}_${account.email}_${account.user.phone_number}`
                  .toLowerCase()
                  .replace(/\s+/g, '_'),
            });

            await queryRunner.manager.save(tenantKyc);
            created++;
          } else {
            // Update User entity with TenantKyc data (TenantKyc is the source of truth)
            await queryRunner.manager.update(Users, account.user.id, {
              first_name: tenantKyc.first_name,
              last_name: tenantKyc.last_name,
              email: tenantKyc.email || account.user.email,
              phone_number: tenantKyc.phone_number || account.user.phone_number,
              date_of_birth:
                tenantKyc.date_of_birth || account.user.date_of_birth,
              gender: tenantKyc.gender || account.user.gender,
              nationality: tenantKyc.nationality || account.user.nationality,
              state_of_origin:
                tenantKyc.state_of_origin || account.user.state_of_origin,
              lga: tenantKyc.local_government_area || account.user.lga,
              marital_status:
                tenantKyc.marital_status || account.user.marital_status,
              employment_status:
                tenantKyc.employment_status || account.user.employment_status,
              job_title: tenantKyc.job_title || account.user.job_title,
              employer_name:
                tenantKyc.employer_name || account.user.employer_name,
              employer_address:
                tenantKyc.employer_address || account.user.employer_address,
              monthly_income: tenantKyc.monthly_net_income
                ? parseFloat(tenantKyc.monthly_net_income)
                : account.user.monthly_income,
            });
            synced++;
          }
        } catch (error) {
          errors.push(`Error syncing tenant ${account.id}: ${error.message}`);
        }
      }

      await queryRunner.commitTransaction();

      return {
        success: true,
        synced,
        created,
        errors,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
