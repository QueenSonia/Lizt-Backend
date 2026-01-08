import { Type } from 'class-transformer';
import {
  IsOptional,
  IsInt,
  Min,
  IsEnum,
  IsString,
  IsDateString,
} from 'class-validator';
import { MessageStatus } from '../entities/message-status.enum';
import { MessageDirection } from '../entities/message-direction.enum';

export class MessageSearchDto {
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  content?: string;

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
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
