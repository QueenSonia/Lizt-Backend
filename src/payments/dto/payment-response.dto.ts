import {
  PaymentStatus,
  PaymentType,
  PaymentMethod,
} from '../entities/payment.entity';

export class PaymentResponseDto {
  id: string;
  offerLetterId: string;
  amount: number;
  paymentType: PaymentType;
  status: PaymentStatus;
  paymentMethod: PaymentMethod | null;
  paystackReference: string;
  accessCode: string | null;
  authorizationUrl: string | null;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class InitiatePaymentResponseDto {
  paymentId: string;
  paystackReference: string;
  accessCode: string;
  authorizationUrl: string;
  expiresAt: string;
}
