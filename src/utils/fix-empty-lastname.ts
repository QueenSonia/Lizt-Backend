import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Users } from '../users/entities/user.entity';
import { TenantKyc } from '../tenant-kyc/entities/tenant-kyc.entity';

@Injectable()
export class FixEmptyLastnameService {
  private readonly logger = new Logger(FixEmptyLastnameService.name);

  constructor(
    @InjectRepository(Users)
    private usersRepository: Repository<Users>,
    @InjectRepository(TenantKyc)
    private tenantKycRepository: Repository<TenantKyc>,
  ) {}

  /**
   * Fix empty lastName fields by setting them to a default value or extracting from first_name
   */
  async fixEmptyLastNames(landlordId: string) {
    this.logger.log(`Starting empty lastName fix for landlord: ${landlordId}`);

    try {
      // Find users with empty or null last names who are tenants of this landlord's properties
      const usersWithEmptyLastName = await this.usersRepository
        .createQueryBuilder('user')
        .leftJoinAndSelect('user.tenant', 'tenant')
        .leftJoinAndSelect('tenant.rents', 'rents')
        .leftJoinAndSelect('rents.property', 'property')
        .where('(user.last_name IS NULL OR user.last_name = :emptyString)', {
          emptyString: '',
        })
        .andWhere('property.owner_id = :landlordId', { landlordId })
        .getMany();

      this.logger.log(
        `Found ${usersWithEmptyLastName.length} users with empty lastName`,
      );

      const fixedUsers: any[] = [];

      for (const user of usersWithEmptyLastName) {
        let newLastName = 'Unknown';

        // Try to extract last name from first_name if it contains multiple words
        if (user.first_name && user.first_name.includes(' ')) {
          const nameParts = user.first_name.trim().split(' ');
          if (nameParts.length > 1) {
            // Use the last part as lastName and keep the rest as firstName
            newLastName = nameParts.pop() || 'Unknown';
            const newFirstName = nameParts.join(' ');

            await this.usersRepository.update(user.id, {
              first_name: newFirstName,
              last_name: newLastName,
            });

            fixedUsers.push({
              userId: user.id,
              oldFirstName: user.first_name,
              newFirstName,
              newLastName,
              method: 'split_name',
            });
          } else {
            // Single word first name, just add default lastName
            await this.usersRepository.update(user.id, {
              last_name: newLastName,
            });

            fixedUsers.push({
              userId: user.id,
              firstName: user.first_name,
              newLastName,
              method: 'default_lastname',
            });
          }
        } else {
          // No first name or single word, just add default lastName
          await this.usersRepository.update(user.id, {
            last_name: newLastName,
          });

          fixedUsers.push({
            userId: user.id,
            firstName: user.first_name || 'Unknown',
            newLastName,
            method: 'default_lastname',
          });
        }
      }

      this.logger.log(`Fixed ${fixedUsers.length} users with empty lastName`);

      return {
        success: true,
        message: `Fixed ${fixedUsers.length} users with empty lastName`,
        fixedUsers,
      };
    } catch (error) {
      this.logger.error('Error fixing empty lastName fields:', error);
      return {
        success: false,
        message: 'Failed to fix empty lastName fields',
        error: error.message,
      };
    }
  }

  /**
   * Fix empty lastName fields in tenant_kyc table
   */
  async fixEmptyLastNamesInKyc(landlordId: string) {
    this.logger.log(
      `Starting empty lastName fix in KYC for landlord: ${landlordId}`,
    );

    try {
      // Find tenant_kyc records with empty or null last names for this landlord's tenants
      const kycWithEmptyLastName = await this.tenantKycRepository
        .createQueryBuilder('kyc')
        .leftJoinAndSelect('kyc.user', 'user')
        .where('(kyc.last_name IS NULL OR kyc.last_name = :emptyString)', {
          emptyString: '',
        })
        .andWhere('kyc.admin_id = :landlordId', { landlordId })
        .getMany();

      this.logger.log(
        `Found ${kycWithEmptyLastName.length} KYC records with empty lastName`,
      );

      const fixedKyc: any[] = [];

      for (const kyc of kycWithEmptyLastName) {
        let newLastName = 'Unknown';

        // Try to get lastName from the associated user first
        if (kyc.user?.last_name && kyc.user.last_name.trim() !== '') {
          newLastName = kyc.user.last_name;
        } else if (kyc.first_name && kyc.first_name.includes(' ')) {
          // Try to extract last name from first_name if it contains multiple words
          const nameParts = kyc.first_name.trim().split(' ');
          if (nameParts.length > 1) {
            newLastName = nameParts.pop() || 'Unknown';
            const newFirstName = nameParts.join(' ');

            await this.tenantKycRepository.update(kyc.id, {
              first_name: newFirstName,
              last_name: newLastName,
            });

            fixedKyc.push({
              kycId: kyc.id,
              userId: kyc.user_id,
              oldFirstName: kyc.first_name,
              newFirstName,
              newLastName,
              method: 'split_name',
            });
            continue;
          }
        }

        // Just update lastName
        await this.tenantKycRepository.update(kyc.id, {
          last_name: newLastName,
        });

        fixedKyc.push({
          kycId: kyc.id,
          userId: kyc.user_id,
          firstName: kyc.first_name || 'Unknown',
          newLastName,
          method: 'default_lastname',
        });
      }

      this.logger.log(
        `Fixed ${fixedKyc.length} KYC records with empty lastName`,
      );

      return {
        success: true,
        message: `Fixed ${fixedKyc.length} KYC records with empty lastName`,
        fixedKyc,
      };
    } catch (error) {
      this.logger.error('Error fixing empty lastName fields in KYC:', error);
      return {
        success: false,
        message: 'Failed to fix empty lastName fields in KYC',
        error: error.message,
      };
    }
  }
}
