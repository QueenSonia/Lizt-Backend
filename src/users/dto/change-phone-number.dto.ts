import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { NormalizePhoneNumber } from '../../utils/phone-number.transformer';
import { IsValidPhoneNumber } from '../../common/validation/is-valid-phone.decorator';

/**
 * Body for changing a user's identity phone number.
 *
 * The value is normalized to canonical digits-only E.164 (NG default) by
 * @NormalizePhoneNumber BEFORE validation, so @IsValidPhoneNumber sees the
 * stored shape. Only the person's OWN identity number is carried here — spouse /
 * next-of-kin / work / referral / guarantor numbers are out of scope.
 */
export class ChangePhoneNumberDto {
  @ApiProperty({
    example: '+2348104467932',
    description: "The user's new phone number (any accepted format).",
  })
  @IsNotEmpty()
  @IsString()
  @IsValidPhoneNumber()
  @NormalizePhoneNumber()
  phone_number: string;
}
