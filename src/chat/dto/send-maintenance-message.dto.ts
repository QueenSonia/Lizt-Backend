import {
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MediaItemInput } from 'src/maintenance-requests/dto/create-maintenance-request.dto';

export class SendMaintenanceMessageDto {
  // Optional now that media-only messages are allowed. The "content OR media
  // required" rule is enforced in ChatService (it depends on the other field).
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  content?: string;

  // Attachments uploaded direct to Cloudinary by the browser; we only get the
  // resulting {type,url}. Validated for ownership in the service.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MediaItemInput)
  media?: MediaItemInput[];
}
