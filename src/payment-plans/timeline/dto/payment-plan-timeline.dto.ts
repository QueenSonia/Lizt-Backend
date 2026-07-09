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
  installment?: InstallmentRefDto | null; // installment_paid / installment_overdue
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
    dueDate: string;
    status: string;
  }[];
}

export interface CategoryRowDto {
  key: string;
  category: PlanCategory;
  scope: string | null;
  title: string;
  subtitle?: string | null;
  amount: number;
  status: CategoryRowStatus;
  /** Latest ACTIVE plan for this category, if any (null once completed/cancelled). */
  activePlan?: ActivePlanDto | null;
  events: TimelineEventDto[]; // newest-first
}

export interface PaymentPlanTimelineResponseDto {
  rows: CategoryRowDto[];
}
