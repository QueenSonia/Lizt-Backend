import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class AssignMaintenanceRequestDto {
  @ApiProperty({
    description:
      'TeamMember.id of the facility manager to assign. Pass null to unassign.',
    required: false,
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsUUID()
  assigned_to?: string | null;
}
