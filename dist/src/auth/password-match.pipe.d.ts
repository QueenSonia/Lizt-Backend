import { PipeTransform, ArgumentMetadata } from '@nestjs/common';
export declare class PasswordMatch implements PipeTransform {
    transform(value: any, metadata: ArgumentMetadata): any;
}
