// src/users/dto/update-kyc.dto.ts
import { PartialType } from '@nestjs/mapped-types';
import { CreateKycDto } from './create-kyc.dto';
import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateKycDto extends PartialType(CreateKycDto) {
  @IsString()
  @IsNotEmpty()
  status: string;
}
