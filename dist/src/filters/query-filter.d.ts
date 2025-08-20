import { PropertyFilter } from 'src/properties/dto/create-property.dto';
import { RentFilter } from 'src/rents/dto/create-rent.dto';
import { UserFilter } from 'src/users/dto/create-user.dto';
import { FindOptionsWhere, SelectQueryBuilder } from 'typeorm';
import { ServiceRequestFilter } from 'src/service-requests/dto/create-service-request.dto';
import { PropertyHistoryFilter } from 'src/property-history/dto/create-property-history.dto';
import { Property } from 'src/properties/entities/property.entity';
export declare const buildUserFilter: (queryParams: UserFilter) => Promise<{}>;
export declare const buildUserFilterQB: (qb: SelectQueryBuilder<any>, queryParams: UserFilter) => SelectQueryBuilder<any>;
export declare const buildPropertyFilter: (queryParams: PropertyFilter) => Promise<{
    query: FindOptionsWhere<Property>;
    order: Record<string, "ASC" | "DESC">;
}>;
export declare const buildRentFilter: (queryParams: RentFilter) => Promise<{}>;
export declare const buildServiceRequestFilter: (queryParams: ServiceRequestFilter) => Promise<{}>;
export declare const buildPropertyHistoryFilter: (queryParams: PropertyHistoryFilter) => Promise<{}>;
