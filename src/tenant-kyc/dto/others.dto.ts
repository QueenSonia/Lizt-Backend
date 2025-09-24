import {
  IsOptional,
  IsString,
  IsArray,
  ArrayNotEmpty,
  IsUUID,
} from 'class-validator';
import { Transform } from 'class-transformer';

import { PaginationQueryDto } from 'src/lib/utils/re-usables/utils.dto';

export class ParseTenantKycQueryDto extends PaginationQueryDto {
  /** Comma seperated string of table column names (or model property names)
   * @example id,first_name,email
   */
  @IsOptional()
  @IsString()
  @Transform(({ value }) => typeof value === 'string' && value?.trim())
  fields?: string;
}

export class BulkDeleteTenantKycDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('all', { each: true })
  ids: string[];
}
