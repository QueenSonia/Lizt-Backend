import { Users } from 'src/users/entities/user.entity';
import { BaseEntity } from 'src/base.entity';
export declare enum Gender {
    MALE = "male",
    FEMALE = "female",
    OTHER = "other"
}
export declare enum MaritalStatus {
    SINGLE = "single",
    MARRIED = "married",
    DIVORCED = "divorced",
    WIDOWED = "widowed"
}
export declare enum EmploymentStatus {
    EMPLOYED = "employed",
    SELF_EMPLOYED = "self-employed",
    UNEMPLOYED = "unemployed",
    STUDENT = "student"
}
export declare class TenantKyc extends BaseEntity {
    first_name: string;
    last_name: string;
    email: string;
    phone_number: string;
    date_of_birth: Date;
    gender: `${Gender}`;
    nationality: string;
    current_residence: string;
    state_of_origin: string;
    local_government_area: string;
    marital_status: `${MaritalStatus}`;
    religion: string;
    spouse_name_and_contact: string;
    employment_status: `${EmploymentStatus}`;
    occupation: string;
    job_title: string;
    employer_name: string;
    employer_address: string;
    employer_phone_number: string;
    monthly_net_income: string;
    reference1_name: string;
    reference1_address: string;
    reference1_relationship: string;
    reference1_phone_number: string;
    reference2_name: string;
    reference2_address: string;
    reference2_relationship: string;
    reference2_phone_number: string;
    user_id?: string;
    user?: Users;
    admin_id: string;
    admin?: Users;
    identity_hash: string;
    toJSON(): any;
}
