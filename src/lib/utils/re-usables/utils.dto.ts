import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  Min,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

export class PaginationQueryDto {
  @IsNumber({ allowInfinity: false })
  @Min(1, { message: 'Page must be at least 1' })
  @IsOptional()
  @Transform(({ value }) => (value ? parseInt(value, 10) : 1))
  page?: number = 1;

  @IsNumber({ allowInfinity: false })
  @Min(1, { message: 'Limit must be at least 1' })
  @IsOptional()
  @Transform(({ value }) => (value ? parseInt(value, 10) : 10))
  limit?: number = 10;
}

@ValidatorConstraint({ name: 'IsTrue', async: false })
export class IsTrueConstraint implements ValidatorConstraintInterface {
  validate(value: boolean) {
    return value === true;
  }
}

export class UploadFileDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: 'File to upload',
  })
  file: any;
}
