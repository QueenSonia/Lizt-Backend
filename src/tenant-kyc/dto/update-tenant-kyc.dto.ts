import { PartialType } from '@nestjs/swagger';

import { CreateTenantKycDto } from './create-tenant-kyc.dto';

export class UpdateTenantKycDto extends PartialType(CreateTenantKycDto) {}
