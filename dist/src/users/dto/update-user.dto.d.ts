import { CreateUserDto } from './create-user.dto';
declare const UpdateUserDto_base: import("@nestjs/common").Type<Partial<CreateUserDto>>;
export declare class UpdateUserDto extends UpdateUserDto_base {
}
export declare class UpdateUserResponseDto {
    first_name: string;
    last_name: string;
    email: string;
    phone_number: string;
    role: string;
    lease_start_date: Date;
    lease_end_date: Date;
    property_id: string;
}
export {};
