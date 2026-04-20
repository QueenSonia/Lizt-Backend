import { IsEmail } from 'class-validator';

export class InitializeAdHocInvoicePaymentDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string;
}
