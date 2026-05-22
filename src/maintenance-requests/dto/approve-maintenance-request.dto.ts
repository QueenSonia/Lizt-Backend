import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class ApproveMaintenanceRequestDto {
  @ApiProperty({
    description:
      'TeamMember.id of the facility manager to assign as part of approval. Required — approval must always pair with an assignee.',
    type: String,
  })
  @IsUUID()
  assigned_to!: string;
}
