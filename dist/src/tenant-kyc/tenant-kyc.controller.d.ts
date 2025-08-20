import { TenantKycService } from './tenant-kyc.service';
import { CreateTenantKycDto, UpdateTenantKycDto } from './dto';
import { BulkDeleteTenantKycDto, ParseTenantKycQueryDto } from './dto/others.dto';
export declare class TenantKycController {
    private readonly tenantKycService;
    constructor(tenantKycService: TenantKycService);
    create(createTenantKycDto: CreateTenantKycDto): Promise<void>;
    findAll(query: ParseTenantKycQueryDto, admin_id: string): Promise<{
        data: import("./entities/tenant-kyc.entity").TenantKyc[];
        pagination: {
            total: number;
            page: number;
            limit: number;
            totalPages: number;
        };
    }>;
    findOne(id: string, admin_id: string): Promise<import("./entities/tenant-kyc.entity").TenantKyc>;
    update(id: string, updateTenantKycDto: UpdateTenantKycDto, admin_id: string): Promise<import("./entities/tenant-kyc.entity").TenantKyc>;
    deleteOne(id: string, admin_id: string): Promise<void>;
    deleteMany(bulkDeleteTenantKycDto: BulkDeleteTenantKycDto, admin_id: string): Promise<void>;
    deleteAll(admin_id: string): Promise<void>;
}
