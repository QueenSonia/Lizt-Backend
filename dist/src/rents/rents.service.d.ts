import { Repository } from 'typeorm';
import { RentFilter } from './dto/create-rent.dto';
import { Rent } from './entities/rent.entity';
import { RentIncrease } from './entities/rent-increase.entity';
import { CreateRentIncreaseDto } from './dto/create-rent-increase.dto';
import { Property } from 'src/properties/entities/property.entity';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
export declare class RentsService {
    private readonly rentRepository;
    private readonly propertyRepository;
    private readonly propertyTenantRepository;
    private readonly rentIncreaseRepository;
    constructor(rentRepository: Repository<Rent>, propertyRepository: Repository<Property>, propertyTenantRepository: Repository<PropertyTenant>, rentIncreaseRepository: Repository<RentIncrease>);
    payRent(data: any): Promise<Rent>;
    getAllRents(queryParams: RentFilter): Promise<{
        rents: Rent[];
        pagination: {
            totalRows: number;
            perPage: number;
            currentPage: number;
            totalPages: number;
            hasNextPage: boolean;
        };
    }>;
    getRentByTenantId(tenant_id: string): Promise<Rent>;
    getDueRentsWithinSevenDays(queryParams: RentFilter): Promise<{
        rents: Rent[];
        pagination: {
            totalRows: number;
            perPage: number;
            currentPage: number;
            totalPages: number;
            hasNextPage: boolean;
        };
    }>;
    getOverdueRents(queryParams: RentFilter): Promise<{
        rents: Rent[];
        pagination: {
            totalRows: number;
            perPage: number;
            currentPage: number;
            totalPages: number;
            hasNextPage: boolean;
        };
    }>;
    sendRentReminder(id: string): Promise<{
        message: string;
    }>;
    getRentById(id: string): Promise<Rent>;
    updateRentById(id: string, data: any): Promise<import("typeorm").UpdateResult>;
    deleteRentById(id: string): Promise<import("typeorm").DeleteResult>;
    saveOrUpdateRentIncrease(data: CreateRentIncreaseDto, userId: string): Promise<import("typeorm").UpdateResult | ({
        rent_increase_date: Date;
        property_id: string;
        initial_rent: number;
        current_rent: number;
        reason?: string | null;
    } & RentIncrease)>;
    findActiveRent(query: any): Promise<Rent | null>;
    deactivateTenant(data: {
        tenant_id: string;
        property_id: string;
    }): Promise<void>;
}
