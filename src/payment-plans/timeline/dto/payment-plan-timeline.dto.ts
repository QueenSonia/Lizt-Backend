/**
 * Response contract for `GET /payment-plans/timeline`. The endpoint returns
 * one row per payment-plan *category* for a tenancy, each with a fully
 * assembled, newest-first activity timeline. See the timeline assembler for
 * how these are derived from plans, requests and property_histories.
 */

export type PlanCategory =
  | 'ob'
  | 'entire_tenancy'
  | 'ad_hoc'
  | 'specific_charge';

export type TimelineEventType =
  | 'request_submitted'
  | 'request_approved'
  | 'request_declined'
  | 'plan_created'
  | 'plan_edited'
  | 'plan_cancelled'
  | 'installment_paid'
  | 'installment_payment_recorded'
  | 'plan_completed'
  | 'installment_overdue'
  | 'reminders';

export type CategoryRowStatus =
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'awaiting_approval'
  | 'declined';

export type ReminderKind = 'upcoming' | 'overdue';

export interface InstallmentSnapshotDto {
  sequence: number;
  amount: number;
  dueDate: string; // ISO date (YYYY-MM-DD)
  status: string;
  /** ISO timestamp the installment was paid; null/absent while pending. */
  paidAt?: string | null;
}

export interface ScheduleSnapshotDto {
  totalAmount: number;
  installments: InstallmentSnapshotDto[];
}

export interface TenancyPeriodDto {
  startDate: string; // ISO date
  endDate: string; // ISO date
}

export interface ReminderSendDto {
  sentAt: string; // ISO timestamp
  kind: ReminderKind;
  /** D-label relative to the due date: 'D-7' | 'D-1' | 'D-0' | 'overdue'. */
  label: string;
}

export interface CollapsedRemindersDto {
  installmentId: string;
  installmentSequence: number | null;
  count: number;
  lastSentAt: string;
  lastKind: ReminderKind;
  sends: ReminderSendDto[];
}

export interface InstallmentRefDto {
  id: string | null;
  sequence: number | null;
  amount: number | null;
  dueDate: string | null;
}

/**
 * One payment applied to an installment — a landlord-recorded partial, or the
 * payment that settled the row. Sourced from the structured metadata on
 * `payment_plan_installment_payment_recorded` / `payment_plan_installment_paid`
 * history events (with a legacy fallback built from the installment columns).
 */
export interface InstallmentPaymentDto {
  /** The delta this payment applied — never the cumulative total. */
  amount: number;
  /** Cumulative amount_paid after this payment (absent on legacy rows). */
  totalPaid?: number | null;
  /** Remaining balance after this payment (0 for the settling payment). */
  remainingAfter?: number | null;
  /** True when this settled earlier partials rather than a whole installment. */
  settledPartial?: boolean;
  method: string | null;
  /** The date the money changed hands (YYYY-MM-DD), as entered/observed. */
  paymentDate: string | null;
  /** Display name of who recorded a manual entry; null for online payments. */
  recordedBy: string | null;
}

export interface ChargeLineDto {
  label: string;
  amount: number;
}

/** The tenant's original request, as submitted — powers the rich request card. */
export interface RequestDetailsDto {
  totalAmount: number;
  installmentAmount: number | null;
  preferredSchedule: string | null;
  tenantNote: string | null;
  charges: ChargeLineDto[];
}

export interface TimelineEventDto {
  id: string;
  type: TimelineEventType;
  /** The sort timestamp (ISO). Overdue uses the installment's true due date. */
  occurredAt: string;
  description: string;
  tenancyPeriod?: TenancyPeriodDto | null;
  /**
   * plan_created carries `after`; plan_edited carries `before` + `after`;
   * plan_cancelled / plan_completed carry the plan's final `after` snapshot.
   */
  snapshot?: { before?: ScheduleSnapshotDto; after?: ScheduleSnapshotDto };
  request?: RequestDetailsDto | null; // request_submitted
  receiptToken?: string | null; // installment_paid
  installment?: InstallmentRefDto | null; // installment_paid / installment_overdue / installment_payment_recorded
  /** Payment context — installment_paid / installment_payment_recorded. */
  payment?: InstallmentPaymentDto | null;
  reminders?: CollapsedRemindersDto; // reminders
  reason?: string | null; // request_declined / plan_cancelled context
}

/** The live active plan for a row — powers the edit / cancel / mark-paid actions. */
export interface ActivePlanDto {
  id: string;
  scope: string;
  chargeName: string;
  sourceType: string | null;
  adHocInvoiceId: string | null;
  planType: string;
  totalAmount: number;
  installments: {
    id: string;
    sequence: number;
    amount: number;
    /** Cumulative recorded payments — drives the Paid / Balance columns. */
    amountPaid: number | null;
    dueDate: string;
    status: string;
    paidAt: string | null;
    /** Chronological payments against this row — the Paid-badge detail view. */
    payments: InstallmentPaymentDto[];
  }[];
}

export interface CategoryRowDto {
  key: string;
  category: PlanCategory;
  scope: string | null;
  title: string;
  subtitle?: string | null;
  /** The tenancy period this row refers to (tenancy / OB aggregates). */
  period?: TenancyPeriodDto | null;
  amount: number;
  status: CategoryRowStatus;
  /** Latest ACTIVE plan for this category, if any (null once completed/cancelled). */
  activePlan?: ActivePlanDto | null;
  events: TimelineEventDto[]; // newest-first
}

export interface PaymentPlanTimelineResponseDto {
  rows: CategoryRowDto[];
}
