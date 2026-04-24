import { IsString, IsOptional, MaxLength } from 'class-validator';

export class RejectRenewalLetterDto {
  @IsString()
  @IsOptional()
  @MaxLength(500)
  reason?: string;

  @IsString()
  @IsOptional()
  ipAddress?: string;
}
