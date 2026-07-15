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
  /** Our merchant reference (LIZT_...). */
  reference: string;
  /** Hosted-checkout URL — the canonical field the frontend redirects to. */
  checkoutUrl: string;
  expiresAt: string;
  /**
   * @deprecated Legacy popup fields, populated only while the active gateway
   * is Paystack. Dropped in the legacy-retire pass.
   */
  paystackReference?: string;
  accessCode?: string;
  /** @deprecated Alias of checkoutUrl. */
  authorizationUrl?: string;
}
