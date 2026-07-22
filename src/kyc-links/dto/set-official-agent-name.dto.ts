import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SetOfficialAgentNameDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  official_name: string;
}
