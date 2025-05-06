// src/users/dto/update-kyc.dto.ts
import { PartialType } from '@nestjs/mapped-types';
import { CreateKycDto } from './create-kyc.dto';

export class UpdateKycDto extends PartialType(CreateKycDto) {}
