import { Repository } from 'typeorm';
import { CreateTenantKycDto, UpdateTenantKycDto } from './dto';
import { TenantKyc } from './entities/tenant-kyc.entity';
import { BulkDeleteTenantKycDto, ParseTenantKycQueryDto } from './dto/others.dto';
import { Account } from 'src/users/entities/account.entity';
export declare class TenantKycService {
    private tenantKycRepo;
    private accountRepo;
    constructor(tenantKycRepo: Repository<TenantKyc>, accountRepo: Repository<Account>);
    create(dto: CreateTenantKycDto): Promise<void>;
    findAll(admin_id: string, query: ParseTenantKycQueryDto): Promise<{
        data: TenantKyc[];
        pagination: {
            total: number;
            page: number;
            limit: number;
            totalPages: number;
        };
    }>;
    findOne(admin_id: string, id: string): Promise<TenantKyc>;
    update(admin_id: string, id: string, dto: UpdateTenantKycDto): Promise<TenantKyc>;
    deleteOne(admin_id: string, id: string): Promise<void>;
    deleteMany(admin_id: string, { ids }: BulkDeleteTenantKycDto): Promise<void>;
    deleteAll(admin_id: string): Promise<void>;
    private generateIdentityHash;
}
