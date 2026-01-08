export class ErrorSummaryDto {
  errorCode: string;
  errorReason: string;
  count: number;
  percentage: number;
}

export class DeliveryStatsDto {
  totalMessages: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  failedCount: number;
  deliveryRate: number;
  readRate: number;
  commonErrors: ErrorSummaryDto[];
}
