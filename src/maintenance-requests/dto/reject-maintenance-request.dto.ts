import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectMaintenanceRequestDto {
  @ApiProperty({
    description:
      'Optional free-text reason the landlord is rejecting the maintenance request. Trimmed; empty → null.',
    required: false,
    nullable: true,
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() || null : null,
  )
  reason?: string | null;
}
