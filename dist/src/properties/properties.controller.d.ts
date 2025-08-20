import { PropertiesService } from './properties.service';
import { CreatePropertyDto, PropertyFilter } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { FileUploadService } from 'src/utils/cloudinary';
import { MoveTenantInDto, MoveTenantOutDto } from './dto/move-tenant.dto';
import { CreatePropertyGroupDto } from './dto/create-property-group.dto';
import { AssignTenantDto } from './dto/assign-tenant.dto';
export declare class PropertiesController {
    private readonly propertiesService;
    private readonly fileUploadService;
    constructor(propertiesService: PropertiesService, fileUploadService: FileUploadService);
    createProperty(body: CreatePropertyDto, req: any): Promise<CreatePropertyDto>;
    getAllProperties(query: PropertyFilter, req: any): Promise<{
        properties: import("./entities/property.entity").Property[];
        pagination: {
            totalRows: number;
            perPage: number;
            currentPage: number;
            totalPages: number;
            hasNextPage: boolean;
        };
    }>;
    getVacantProperty(query: {
        owner_id: string;
    }, req: any): Promise<import("./entities/property.entity").Property[]>;
    getAllPropertyGroups(req: any): Promise<{
        property_groups: {
            properties: (import("./entities/property.entity").Property | undefined)[];
            name: string;
            owner_id: string;
            property_ids: string[];
            owner: import("../users/entities/user.entity").Users;
            id: string;
            created_at?: Date | string;
            updated_at?: Date | string;
            deleted_at?: Date;
        }[];
        total: number;
    }>;
    getPropertyById(id: string): Promise<CreatePropertyDto>;
    getRentsOfAProperty(id: string): Promise<CreatePropertyDto>;
    getServiceRequestOfAProperty(id: string): Promise<CreatePropertyDto>;
    updatePropertyById(id: string, body: UpdatePropertyDto): Promise<import("typeorm").UpdateResult>;
    deletePropertyById(id: string): Promise<import("typeorm").DeleteResult>;
    getAdminDashboardStats(req: any): Promise<{
        total_properties: number;
        total_tenants: number;
        due_tenants: number;
        unresolved_requests: number;
    }>;
    moveTenantIn(moveInData: MoveTenantInDto): Promise<{
        property_id: string;
        tenant_id: string;
        status: import("./dto/create-property.dto").TenantStatusEnum;
    } & import("./entities/property-tenants.entity").PropertyTenant>;
    moveTenantOut(moveOutData: MoveTenantOutDto): Promise<{
        move_out_date: Date;
        move_out_reason: string | null;
        owner_comment: string | null;
        tenant_comment: string | null;
        property_id: string;
        tenant_id: string;
        move_in_date: Date;
        monthly_rent: number;
        property: import("./entities/property.entity").Property;
        tenant: import("../users/entities/account.entity").Account;
        id: string;
        created_at?: Date | string;
        updated_at?: Date | string;
        deleted_at?: Date;
    } & import("../property-history/entities/property-history.entity").PropertyHistory>;
    createPropertyGroup(body: CreatePropertyGroupDto, req: any): Promise<{
        name: string;
        property_ids: string[];
        owner_id: string;
    } & import("./entities/property-group.entity").PropertyGroup>;
    getPropertyGroupById(id: string, req: any): Promise<{
        properties: import("./entities/property.entity").Property[];
        name: string;
        owner_id: string;
        property_ids: string[];
        owner: import("../users/entities/user.entity").Users;
        id: string;
        created_at?: Date | string;
        updated_at?: Date | string;
        deleted_at?: Date;
    }>;
    assignTenantToProperty(id: string, data: AssignTenantDto): Promise<{
        message: string;
    }>;
}
