import { Repository } from 'typeorm';
import { CreatePropertyHistoryDto, PropertyHistoryFilter } from './dto/create-property-history.dto';
import { UpdatePropertyHistoryDto } from './dto/update-property-history.dto';
import { PropertyHistory } from './entities/property-history.entity';
export declare class PropertyHistoryService {
    private readonly propertyHistoryRepository;
    constructor(propertyHistoryRepository: Repository<PropertyHistory>);
    createPropertyHistory(data: CreatePropertyHistoryDto): Promise<CreatePropertyHistoryDto>;
    getAllPropertyHistories(queryParams: PropertyHistoryFilter): Promise<{
        property_histories: PropertyHistory[];
        pagination: {
            totalRows: number;
            perPage: number;
            currentPage: number;
            totalPages: number;
            hasNextPage: boolean;
        };
    }>;
    getPropertyHistoryById(id: string): Promise<CreatePropertyHistoryDto>;
    updatePropertyHistoryById(id: string, data: UpdatePropertyHistoryDto): Promise<import("typeorm").UpdateResult>;
    deletePropertyHistoryById(id: string): Promise<import("typeorm").DeleteResult>;
    getPropertyHistoryByTenantId(tenant_id: string, property_id: string, queryParams: PropertyHistoryFilter): Promise<{
        property_histories: PropertyHistory[];
        pagination: {
            totalRows: number;
            perPage: number;
            currentPage: number;
            totalPages: number;
            hasNextPage: boolean;
        };
    }>;
}
