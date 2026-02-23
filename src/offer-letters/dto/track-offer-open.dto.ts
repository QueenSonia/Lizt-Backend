import { IsString, IsOptional } from 'class-validator';

export class TrackOfferOpenDto {
  @IsString()
  @IsOptional()
  ipAddress?: string;
}
