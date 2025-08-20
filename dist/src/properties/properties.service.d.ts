import { CreatePropertyDto, PropertyFilter, TenantStatusEnum } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { Property } from './entities/property.entity';
import { DataSource, Repository } from 'typeorm';
import { PropertyTenant } from './entities/property-tenants.entity';
import { PropertyHistory } from 'src/property-history/entities/property-history.entity';
import { MoveTenantInDto, MoveTenantOutDto } from './dto/move-tenant.dto';
import { PropertyGroup } from './entities/property-group.entity';
import { CreatePropertyGroupDto } from './dto/create-property-group.dto';
import { RentsService } from 'src/rents/rents.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Users } from 'src/users/entities/user.entity';
import { UsersService } from 'src/users/users.service';
import { AssignTenantDto } from './dto/assign-tenant.dto';
export declare class PropertiesService {
    private readonly propertyRepository;
    private readonly propertyGroupRepository;
    private readonly userService;
    private readonly rentService;
    private readonly eventEmitter;
    private readonly dataSource;
    constructor(propertyRepository: Repository<Property>, propertyGroupRepository: Repository<PropertyGroup>, userService: UsersService, rentService: RentsService, eventEmitter: EventEmitter2, dataSource: DataSource);
    createProperty(data: CreatePropertyDto): Promise<CreatePropertyDto>;
    getAllProperties(queryParams: PropertyFilter): Promise<{
        properties: Property[];
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
    }): Promise<Property[]>;
    getPropertyById(id: string): Promise<CreatePropertyDto>;
    getRentsOfAProperty(id: string): Promise<CreatePropertyDto>;
    getServiceRequestOfAProperty(id: string): Promise<CreatePropertyDto>;
    updatePropertyById(id: string, data: UpdatePropertyDto): Promise<import("typeorm").UpdateResult>;
    deletePropertyById(id: string): Promise<import("typeorm").DeleteResult>;
    getAdminDashboardStats(user_id: string): Promise<{
        total_properties: number;
        total_tenants: number;
        due_tenants: number;
        unresolved_requests: number;
    }>;
    moveTenantIn(moveInData: MoveTenantInDto): Promise<{
        property_id: string;
        tenant_id: string;
        status: TenantStatusEnum;
    } & PropertyTenant>;
    moveTenantOut(moveOutData: MoveTenantOutDto): Promise<{
        move_out_date: Date;
        move_out_reason: string | null;
        owner_comment: string | null;
        tenant_comment: string | null;
        property_id: string;
        tenant_id: string;
        move_in_date: Date;
        monthly_rent: number;
        property: Property;
        tenant: import("../users/entities/account.entity").Account;
        id: string;
        created_at?: Date | string;
        updated_at?: Date | string;
        deleted_at?: Date;
    } & PropertyHistory>;
    createPropertyGroup(data: CreatePropertyGroupDto, owner_id: string): Promise<{
        name: string;
        property_ids: string[];
        owner_id: string;
    } & PropertyGroup>;
    getPropertyGroupById(id: string, owner_id: string): Promise<{
        properties: Property[];
        name: string;
        owner_id: string;
        property_ids: string[];
        owner: Users;
        id: string;
        created_at?: Date | string;
        updated_at?: Date | string;
        deleted_at?: Date;
    }>;
    getAllPropertyGroups(owner_id: string): Promise<{
        property_groups: {
            properties: (Property | undefined)[];
            name: string;
            owner_id: string;
            property_ids: string[];
            owner: Users;
            id: string;
            created_at?: Date | string;
            updated_at?: Date | string;
            deleted_at?: Date;
        }[];
        total: number;
    }>;
    assignTenant(id: string, data: AssignTenantDto): Promise<{
        message: string;
    }>;
}
