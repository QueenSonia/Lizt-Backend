import { Gender, MaritalStatus, EmploymentStatus } from '../../tenant-kyc/entities/tenant-kyc.entity';
export declare class CreateUserDto {
    first_name: string;
    last_name: string;
    email: string;
    phone_number: string;
    role?: string;
    lease_start_date: Date;
    lease_end_date: Date;
    property_id: string;
    rental_price: number;
    security_deposit: number;
    service_charge: number;
    date_of_birth: string;
    gender: `${Gender}`;
    state_of_origin: string;
    lga: string;
    nationality: string;
    employment_status: `${EmploymentStatus}`;
    employer_name?: string;
    job_title?: string;
    employer_address?: string;
    monthly_income?: number;
    work_email?: string;
    business_name?: string;
    nature_of_business?: string;
    business_address?: string;
    business_monthly_income?: number;
    business_website?: string;
    marital_status: `${MaritalStatus}`;
    spouse_full_name?: string;
    spouse_phone_number?: string;
    spouse_occupation?: string;
    spouse_employer?: string;
    source_of_funds?: string;
    monthly_income_estimate?: number;
}
export declare class LoginDto {
    email: string;
    password: string;
}
export declare class ResetDto {
    token: string;
    newPassword: string;
}
export declare class UploadLogoDto {
    logos: Express.Multer.File[];
}
export declare class CreateAdminDto {
    first_name: string;
    last_name: string;
    email: string;
    phone_number: string;
    role?: string;
    property_id: string;
    password: string;
}
export declare class CreateCustomerRepDto {
    first_name: string;
    last_name: string;
    email: string;
    phone_number: string;
    password: string;
    role?: string;
    property_id: string;
}
export interface IUser {
    id?: string;
    first_name: string;
    last_name: string;
    email: string;
    phone_number: string;
    role: string;
    password?: string;
    creator_id?: string | null;
}
export interface UserFilter {
    search?: string;
    first_name?: string;
    last_name?: string;
    email?: string;
    creator_id?: string;
    userId?: string;
    phone_number?: string;
    role?: string;
    sort_by?: string;
    sort_order?: string;
    start_date?: string;
    end_date?: string;
    size?: number;
    page?: number;
}
