import { IsNumber, IsOptional, IsString } from 'class-validator';

export class ResolveRequestDto {
  @IsNumber()
  ticketId: string;

  @IsOptional()
  @IsString()
  resolutionNotes?: string;
}
