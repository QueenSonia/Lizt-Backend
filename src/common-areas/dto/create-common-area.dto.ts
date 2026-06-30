import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateCommonAreaDto {
  @ApiProperty({
    example: 'a1b2c3d4-0000-0000-0000-000000000000',
    description:
      'Account.id of the landlord that owns this common area. The requester (admin/FM) must manage this landlord.',
  })
  @IsString()
  @IsNotEmpty()
  landlord_id: string;

  @ApiProperty({ example: 'Main Lobby', maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @ApiProperty({
    example: 'Ground Floor, Block A, 14 Admiralty Way, Lekki Phase 1',
    maxLength: 500,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  address: string;
}
