import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class SetPriorityDto {
  @ApiProperty({ description: 'Whether to mark the request as a priority.' })
  @IsBoolean()
  is_priority!: boolean;
}
