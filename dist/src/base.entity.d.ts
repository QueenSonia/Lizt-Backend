export declare class BaseEntity {
    id: string;
    created_at?: Date | string;
    updated_at?: Date | string;
    deleted_at?: Date;
}
export interface IPagination {
    totalRows: number;
    perPage: number;
    currentPage: number;
    totalPages: number;
    hasNextPage: boolean;
}
export interface IReqUser {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    phone_number: string;
    role: string;
}
export declare enum ADMIN_ROLES {
    ADMIN = "admin"
}
export declare enum RolesEnum {
    ADMIN = "admin",
    TENANT = "tenant",
    REP = "rep",
    FACILITY_MANAGER = "facility_manager"
}
