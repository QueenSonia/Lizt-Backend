import { RentsService } from './rents.service';
import { CreateRentDto, RentFilter } from './dto/create-rent.dto';
import { UpdateRentDto } from './dto/update-rent.dto';
import { FileUploadService } from 'src/utils/cloudinary';
import { CreateRentIncreaseDto } from './dto/create-rent-increase.dto';
export declare class RentsController {
    private readonly rentsService;
    private readonly fileUploadService;
    constructor(rentsService: RentsService, fileUploadService: FileUploadService);
    payRent(body: CreateRentDto): Promise<import("./entities/rent.entity").Rent>;
    getAllRents(query: RentFilter): Promise<{
        rents: import("./entities/rent.entity").Rent[];
        pagination: {
            totalRows: number;
            perPage: number;
            currentPage: number;
            totalPages: number;
            hasNextPage: boolean;
        };
    }>;
    getRentByTenantId(tenant_id: string): Promise<import("./entities/rent.entity").Rent>;
    getDueRentsWithinSevenDays(query: RentFilter, req: any): Promise<{
        rents: import("./entities/rent.entity").Rent[];
        pagination: {
            totalRows: number;
            perPage: number;
            currentPage: number;
            totalPages: number;
            hasNextPage: boolean;
        };
    }>;
    getOverdueRents(query: RentFilter, req: any): Promise<{
        rents: import("./entities/rent.entity").Rent[];
        pagination: {
            totalRows: number;
            perPage: number;
            currentPage: number;
            totalPages: number;
            hasNextPage: boolean;
        };
    }>;
    sendReminder(id: string): Promise<{
        message: string;
    }>;
    getRentById(id: string): Promise<import("./entities/rent.entity").Rent>;
    updatePropertyById(id: string, body: UpdateRentDto): Promise<import("typeorm").UpdateResult>;
    deletePropertyById(id: string): Promise<import("typeorm").DeleteResult>;
    saveOrUpdateRentIncrease(body: CreateRentIncreaseDto, req: any): Promise<import("typeorm").UpdateResult | ({
        rent_increase_date: Date;
        property_id: string;
        initial_rent: number;
        current_rent: number;
        reason?: string | null;
    } & import("./entities/rent-increase.entity").RentIncrease)>;
    removeTenant(tenant_id: string, body: {
        property_id: string;
    }): Promise<void>;
}
