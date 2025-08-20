import { ValidatorConstraintInterface } from 'class-validator';
export declare class PaginationQueryDto {
    page?: number;
    limit?: number;
}
export declare class IsTrueConstraint implements ValidatorConstraintInterface {
    validate(value: boolean): boolean;
}
export declare class UploadFileDto {
    file: any;
}
