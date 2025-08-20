import { BaseEntity } from 'src/base.entity';
import { Account } from './account.entity';
export declare class KYC extends BaseEntity {
    former_house_address: string;
    reason_for_leaving: string;
    former_accomodation_type: string;
    occupation: string;
    employers_name: string;
    employers_address: string;
    state_of_origin: string;
    lga_of_origin: string;
    home_town: string;
    nationality: string;
    religion: string;
    marital_status: string;
    name_of_spouse: string;
    next_of_kin: string;
    next_of_kin_address: string;
    guarantor: string;
    guarantor_address: string;
    guarantor_occupation: string;
    guarantor_phone_number: string;
    monthly_income: string;
    accept_terms_and_condition: boolean;
    user: Account;
}
