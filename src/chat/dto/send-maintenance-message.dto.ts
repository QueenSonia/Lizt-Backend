import { IsString, MaxLength, MinLength } from 'class-validator';

export class SendMaintenanceMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content: string;
}
