import {
  IsNumber,
  IsEmail,
  IsUrl,
  Min,
  IsNotEmpty,
  IsString,
} from 'class-validator';

export class InitiatePaymentDto {
  @IsNumber()
  @Min(1)
  amount: number;

  @IsEmail()
  email: string;

  @IsNotEmpty()
  @IsString()
  @IsUrl({ require_tld: false })
  callbackUrl: string;
}
