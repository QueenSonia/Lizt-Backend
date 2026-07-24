/**
 * Filter category for a property_histories row, derived from its event_type.
 * Shared by the property-detail timeline (properties.service) and the
 * person/tenant timeline (property-history-timeline.builder) so both screens
 * filter and badge events identically.
 *
 * Prefix rules (not an exact-match map) on purpose: the property timeline
 * derives synthetic event types like `maintenance_request_resolved` from
 * `maintenance_request_updated` rows, and future event types should land in a
 * sensible bucket without touching this file.
 */
export type HistoryCategory =
  | 'property'
  | 'tenancy'
  | 'payments'
  | 'maintenance'
  | 'kyc'
  | 'system';

export function categoryForEventType(eventType: string): HistoryCategory {
  // Auto-generated nudges — checked before the payment_plan prefix so the
  // installment reminder/overdue notices land under System, not Payments.
  if (
    eventType === 'rent_reminder_sent' ||
    eventType === 'payment_plan_installment_reminder_sent' ||
    eventType === 'payment_plan_installment_overdue_sent'
  ) {
    return 'system';
  }
  // Payment-plan lifecycle (requests, installments paid) folds into Payments.
  if (eventType.startsWith('payment_plan')) return 'payments';
  if (eventType.startsWith('maintenance_request')) return 'maintenance';
  if (eventType.startsWith('kyc_')) return 'kyc';
  if (
    eventType.startsWith('property_') ||
    eventType.startsWith('facility_manager')
  ) {
    return 'property';
  }
  // Before the broad renewal_ prefix: renewal *payments* are money, the rest
  // of the renewal flow (letters, links, periods) is tenancy lifecycle.
  if (eventType.startsWith('renewal_payment')) return 'payments';
  if (
    eventType.startsWith('payment_') ||
    eventType.startsWith('invoice') ||
    eventType.startsWith('ad_hoc_invoice') ||
    eventType.startsWith('receipt') ||
    eventType.startsWith('outstanding_balance') ||
    eventType === 'user_added_payment' ||
    eventType === 'user_added_fee'
  ) {
    return 'payments';
  }
  if (
    eventType.startsWith('tenancy') ||
    eventType.startsWith('tenant_') ||
    eventType.startsWith('renewal') ||
    eventType.startsWith('offer_letter') ||
    eventType === 'rent_period_amended' ||
    eventType === 'removal_scheduled' ||
    eventType === 'scheduled_end_cancelled' ||
    eventType === 'user_added_tenancy' ||
    eventType === 'user_added_history'
  ) {
    return 'tenancy';
  }
  // Unknown/internal artifacts (reconciliation rows etc.) — these don't
  // render today; if one ever does, System is the least-wrong bucket.
  return 'system';
}
