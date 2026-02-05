import { IsNumber, IsEmail, IsUrl, Min } from 'class-validator';

export class InitiatePaymentDto {
  @IsNumber()
  @Min(1)
  amount: number;

  @IsEmail()
  email: string;

  @IsUrl()
  callbackUrl: string;
}
