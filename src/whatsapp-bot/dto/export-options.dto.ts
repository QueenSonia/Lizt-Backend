import { Type } from 'class-transformer';
import {
  IsOptional,
  IsEnum,
  IsString,
  IsDateString,
  IsBoolean,
} from 'class-validator';
import { MessageStatus } from '../entities/message-status.enum';
import { MessageDirection } from '../entities/message-direction.enum';

export class ExportOptionsDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsEnum(MessageStatus)
  status?: MessageStatus;

  @IsOptional()
  @IsEnum(MessageDirection)
  direction?: MessageDirection;

  @IsOptional()
  @IsString()
  messageType?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeErrorDetails?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeMetadata?: boolean;
}
