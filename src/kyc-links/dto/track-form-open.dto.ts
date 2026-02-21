import { IsString, IsOptional } from 'class-validator';

export class TrackFormOpenDto {
  @IsString()
  @IsOptional()
  ipAddress?: string;
}
