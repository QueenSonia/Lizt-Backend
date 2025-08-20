import { PropertyHistoryService } from './property-history.service';
import { CreatePropertyHistoryDto, PropertyHistoryFilter } from './dto/create-property-history.dto';
import { UpdatePropertyHistoryDto } from './dto/update-property-history.dto';
export declare class PropertyHistoryController {
    private readonly propertyHistoryService;
    constructor(propertyHistoryService: PropertyHistoryService);
    createPropertyHistory(body: CreatePropertyHistoryDto): Promise<CreatePropertyHistoryDto>;
    getAllPropertyHistories(query: PropertyHistoryFilter): Promise<{
        property_histories: import("./entities/property-history.entity").PropertyHistory[];
        pagination: {
            totalRows: number;
            perPage: number;
            currentPage: number;
            totalPages: number;
            hasNextPage: boolean;
        };
    }>;
    getPropertyHistoryById(id: string): Promise<CreatePropertyHistoryDto>;
    updatePropertyHistoryById(id: string, body: UpdatePropertyHistoryDto): Promise<import("typeorm").UpdateResult>;
    deletePropertyHistoryById(id: string): Promise<import("typeorm").DeleteResult>;
    getServiceRequestsByTenantAndProperty(property_id: string, query: PropertyHistoryFilter, req: any): Promise<{
        property_histories: import("./entities/property-history.entity").PropertyHistory[];
        pagination: {
            totalRows: number;
            perPage: number;
            currentPage: number;
            totalPages: number;
            hasNextPage: boolean;
        };
    }>;
}
