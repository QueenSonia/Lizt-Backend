import {
  PaymentStatus,
  PaymentType,
  PaymentMethod,
} from '../entities/payment.entity';
import { BankTransferDetails } from '../gateway/payment-gateway.interface';

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
  /** Hosted-checkout URL — kept as the fallback when `transfer` is null. */
  checkoutUrl: string;
  expiresAt: string;
  /**
   * One-time virtual account for the in-app transfer checkout. Null when the
   * gateway can't mint one (Paystack, or a Monnify transfer-init failure) —
   * the frontend then falls back to redirecting to checkoutUrl.
   */
  transfer?: BankTransferDetails | null;
  /**
   * @deprecated Legacy popup fields, populated only while the active gateway
   * is Paystack. Dropped in the legacy-retire pass.
   */
  paystackReference?: string;
  accessCode?: string;
  /** @deprecated Alias of checkoutUrl. */
  authorizationUrl?: string;
}
