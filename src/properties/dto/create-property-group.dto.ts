import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsString } from 'class-validator';

export class CreatePropertyGroupDto {
  @ApiProperty({
    example: 'Luxury Properties',
    description: 'Name of the property group',
  })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({
    type: [String],
    example: ['uuid1', 'uuid2'],
    description: 'Array of property IDs to be grouped',
  })
  @IsNotEmpty()
  @IsArray()
  property_ids: string[];
}

export class PropertyGroupFilter {
  owner_id?: string;
  name?: string;
}
