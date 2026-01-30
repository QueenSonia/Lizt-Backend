import { PaymentStatus } from '../entities/payment.entity';

export class PaymentHistoryItemDto {
  id: string;
  amount: number;
  status: PaymentStatus;
  paymentMethod: string | null;
  paidAt: Date | null;
  reference: string;
  date: string;
}

export class PaymentStatusDto {
  totalAmount: number;
  amountPaid: number;
  outstandingBalance: number;
  paymentStatus: 'unpaid' | 'partial' | 'fully_paid';
  paymentHistory: PaymentHistoryItemDto[];
  propertyStatus: string;
  isPropertyAvailable: boolean;
}
