import { IsOptional, IsString, MaxLength } from 'class-validator';

export class DeclinePaymentPlanRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
