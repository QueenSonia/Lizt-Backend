import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNotEmpty, ValidateNested } from 'class-validator';
import { CreatePropertyDto } from './create-property.dto';
import { ExistingTenantDto } from './existing-tenant.dto';

export class CreatePropertyWithTenantDto extends CreatePropertyDto {
  @ApiProperty({
    description: 'Existing tenant information',
    type: ExistingTenantDto,
  })
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => ExistingTenantDto)
  existingTenant: ExistingTenantDto;
}
