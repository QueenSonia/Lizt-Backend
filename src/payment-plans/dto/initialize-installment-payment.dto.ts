import { IsEmail } from 'class-validator';

export class InitializeInstallmentPaymentDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string;
}
