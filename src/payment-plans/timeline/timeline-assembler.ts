import { PropertyHistory } from '../../property-history/entities/property-history.entity';
import { RenewalInvoice } from '../../tenancies/entities/renewal-invoice.entity';
import { Rent } from '../../rents/entities/rent.entity';
import { AdHocInvoice } from '../../ad-hoc-invoices/entities/ad-hoc-invoice.entity';
import {
  PaymentPlan,
  PaymentPlanStatus,
} from '../entities/payment-plan.entity';
import { PaymentPlanInstallment } from '../entities/payment-plan-installment.entity';
import {
  PaymentPlanRequest,
  PaymentPlanRequestStatus,
} from '../entities/payment-plan-request.entity';
import {
  categoryOfKey,
  planCategoryKey,
  requestCategoryKey,
} from './category-key';
import { collapseReminders, REMINDER_OVERDUE_EVENT, REMINDER_UPCOMING_EVENT } from './reminder-collapse';
import { synthesizeOverdue } from './overdue-synthesis';
import { dbDateKey, toIso, toMillis } from './date-util';
import {
  ActivePlanDto,
  CategoryRowDto,
  CategoryRowStatus,
  ScheduleSnapshotDto,
  TenancyPeriodDto,
  TimelineEventDto,
  TimelineEventType,
} from './dto/payment-plan-timeline.dto';

export interface AssembleInput {
  plans: PaymentPlan[]; // with installments loaded; ALL statuses
  requests: PaymentPlanRequest[];
  histories: PropertyHistory[]; // plan lifecycle + reminder rows, ASC by created_at
  adHocInvoicesById: Map<string, AdHocInvoice>;
  renewalInvoicesById: Map<string, RenewalInvoice>;
  rents: Rent[];
  todayKey: string; // business-today YYYY-MM-DD
}

export interface AssembleResult {
  rows: CategoryRowDto[];
  unresolvedCount: number;
}

const REMINDER_EVENTS = new Set([REMINDER_UPCOMING_EVENT, REMINDER_OVERDUE_EVENT]);

// Secondary sort key so events sharing a timestamp order deterministically.
const TYPE_PRIORITY: Record<TimelineEventType, number> = {
  request_submitted: 0,
  request_approved: 1,
  request_declined: 1,
  plan_created: 2,
  plan_edited: 3,
  installment_overdue: 4,
  reminders: 5,
  installment_paid: 6,
  plan_completed: 7,
  plan_cancelled: 8,
};

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

export function assembleTimeline(input: AssembleInput): AssembleResult {
  const {
    plans,
    requests,
    histories,
    adHocInvoicesById,
    renewalInvoicesById,
    rents,
    todayKey,
  } = input;

  // ── Lookup maps ────────────────────────────────────────────────────────
  const planById = new Map<string, PaymentPlan>();
  const installmentToPlan = new Map<string, PaymentPlan>();
  const installmentById = new Map<string, PaymentPlanInstallment>();
  for (const plan of plans) {
    planById.set(plan.id, plan);
    for (const inst of plan.installments ?? []) {
      installmentToPlan.set(inst.id, plan);
      installmentById.set(inst.id, inst);
    }
  }

  // ── Period resolution ──────────────────────────────────────────────────
  const periodFromInvoice = (
    invoiceId: string | null | undefined,
  ): TenancyPeriodDto | null => {
    if (!invoiceId) return null;
    const inv = renewalInvoicesById.get(invoiceId);
    const start = dbDateKey(inv?.start_date);
    const end = dbDateKey(inv?.end_date);
    return start && end ? { startDate: start, endDate: end } : null;
  };

  const rentPeriodForInstant = (
    propertyId: string,
    tenantId: string,
    instant: Date | string | null | undefined,
  ): TenancyPeriodDto | null => {
    const at = toMillis(instant);
    const candidates = rents
      .filter((r) => r.property_id === propertyId && r.tenant_id === tenantId)
      .sort(
        (a, b) =>
          new Date(a.rent_start_date).getTime() -
          new Date(b.rent_start_date).getTime(),
      );
    // Prefer a period that brackets the instant; else the latest starting on/before it.
    let chosen: Rent | undefined;
    for (const r of candidates) {
      const start = new Date(r.rent_start_date).getTime();
      const end = r.expiry_date ? new Date(r.expiry_date).getTime() : Infinity;
      if (start <= at && at <= end) {
        chosen = r;
        break;
      }
      if (start <= at) chosen = r;
    }
    if (!chosen) return null;
    const start = dbDateKey(chosen.rent_start_date);
    const end = dbDateKey(chosen.expiry_date) ?? start;
    return start ? { startDate: start, endDate: end as string } : null;
  };

  const periodForPlan = (plan: PaymentPlan): TenancyPeriodDto | null =>
    periodFromInvoice(plan.renewal_invoice_id) ??
    rentPeriodForInstant(plan.property_id, plan.tenant_id, plan.created_at);

  // ── Group plans / requests by category key ─────────────────────────────
  const rowKeys = new Set<string>();
  const plansByKey = new Map<string, PaymentPlan[]>();
  const requestsByKey = new Map<string, PaymentPlanRequest[]>();
  for (const plan of plans) {
    const key = planCategoryKey(plan);
    push(plansByKey, key, plan);
    rowKeys.add(key);
  }
  for (const req of requests) {
    const key = requestCategoryKey(req);
    push(requestsByKey, key, req);
    rowKeys.add(key);
  }

  // ── Bucket history rows by category key (drop unresolvable ones) ────────
  const resolvePlanForHistory = (h: PropertyHistory): PaymentPlan | undefined => {
    if (!h.related_entity_id) return undefined;
    if (h.related_entity_type === 'payment_plan_installment') {
      return installmentToPlan.get(h.related_entity_id);
    }
    return planById.get(h.related_entity_id);
  };

  const lifecycleByKey = new Map<string, PropertyHistory[]>();
  const remindersByKey = new Map<string, PropertyHistory[]>();
  let unresolvedCount = 0;
  for (const h of histories) {
    const plan = resolvePlanForHistory(h);
    if (!plan) {
      unresolvedCount++;
      continue;
    }
    const key = planCategoryKey(plan);
    if (REMINDER_EVENTS.has(h.event_type)) push(remindersByKey, key, h);
    else push(lifecycleByKey, key, h);
  }

  // ── Build one row per key ──────────────────────────────────────────────
  const rows: CategoryRowDto[] = [];
  for (const key of rowKeys) {
    rows.push(
      buildRow({
        key,
        plansForKey: (plansByKey.get(key) ?? [])
          .slice()
          .sort(byCreatedAtAsc),
        requestsForKey: (requestsByKey.get(key) ?? [])
          .slice()
          .sort(byCreatedAtAsc),
        lifecycle: lifecycleByKey.get(key) ?? [],
        reminderRows: remindersByKey.get(key) ?? [],
        installmentById,
        adHocInvoicesById,
        periodForPlan,
        periodFromInvoice,
        todayKey,
      }),
    );
  }

  // Rows: most-recently-active first.
  rows.sort((a, b) => {
    const at = a.events[0]?.occurredAt ?? '';
    const bt = b.events[0]?.occurredAt ?? '';
    return bt.localeCompare(at);
  });

  return { rows, unresolvedCount };
}

function byCreatedAtAsc(
  a: { created_at?: Date | string },
  b: { created_at?: Date | string },
): number {
  return toMillis(a.created_at) - toMillis(b.created_at);
}

interface BuildRowArgs {
  key: string;
  plansForKey: PaymentPlan[]; // asc by created_at
  requestsForKey: PaymentPlanRequest[]; // asc by created_at
  lifecycle: PropertyHistory[];
  reminderRows: PropertyHistory[];
  installmentById: Map<string, PaymentPlanInstallment>;
  adHocInvoicesById: Map<string, AdHocInvoice>;
  periodForPlan: (plan: PaymentPlan) => TenancyPeriodDto | null;
  periodFromInvoice: (id: string | null | undefined) => TenancyPeriodDto | null;
  todayKey: string;
}

function buildRow(args: BuildRowArgs): CategoryRowDto {
  const {
    key,
    plansForKey,
    requestsForKey,
    lifecycle,
    reminderRows,
    installmentById,
    adHocInvoicesById,
    periodForPlan,
    periodFromInvoice,
    todayKey,
  } = args;

  const category = categoryOfKey(key);
  const latestPlan = plansForKey[plansForKey.length - 1] ?? null;
  const activePlanEntity = [...plansForKey]
    .reverse()
    .find((p) => p.status === PaymentPlanStatus.ACTIVE);
  const latestRequest =
    requestsForKey[requestsForKey.length - 1] ?? null;

  // ── Title / amount / scope / status ────────────────────────────────────
  const title = resolveTitle(key, category, latestPlan, adHocInvoicesById);
  const amount = latestPlan
    ? Number(latestPlan.total_amount)
    : latestRequest
      ? Number(latestRequest.total_amount)
      : 0;
  const scope = latestPlan?.scope ?? (category === 'ob' ? 'ob' : category === 'entire_tenancy' ? 'tenancy' : null);
  const status = resolveStatus(latestPlan, requestsForKey);

  // ── Events ─────────────────────────────────────────────────────────────
  const events: TimelineEventDto[] = [];
  const planForHistory = new Map<string, PaymentPlan>(
    plansForKey.map((p) => [p.id, p]),
  );

  // Request lifecycle (built from the request entities — richer than history).
  for (const req of requestsForKey) {
    const period = periodFromInvoice(req.renewal_invoice_id);
    events.push({
      id: `request_submitted:${req.id}`,
      type: 'request_submitted',
      occurredAt: toIso(req.created_at),
      description: `Tenant requested a payment plan for ₦${Number(
        req.total_amount,
      ).toLocaleString()}`,
      tenancyPeriod: period,
      request: {
        totalAmount: Number(req.total_amount),
        installmentAmount:
          req.installment_amount != null ? Number(req.installment_amount) : null,
        preferredSchedule: req.preferred_schedule || null,
        tenantNote: req.tenant_note ?? null,
        charges: (req.fee_breakdown ?? []).map((f) => ({
          label: f.label,
          amount: Number(f.amount),
        })),
      },
    });
    if (req.status === PaymentPlanRequestStatus.APPROVED && req.decided_at) {
      events.push({
        id: `request_approved:${req.id}`,
        type: 'request_approved',
        occurredAt: toIso(req.decided_at),
        description: 'Payment plan request approved',
        tenancyPeriod: period,
      });
    }
    if (req.status === PaymentPlanRequestStatus.DECLINED && req.decided_at) {
      events.push({
        id: `request_declined:${req.id}`,
        type: 'request_declined',
        occurredAt: toIso(req.decided_at),
        description: 'Payment plan request declined',
        reason: req.decline_reason ?? null,
        tenancyPeriod: period,
      });
    }
  }

  // Plan lifecycle history (created / edited / cancelled / completed / paid).
  for (const h of lifecycle) {
    const plan =
      (h.related_entity_type === 'payment_plan_installment'
        ? undefined
        : planForHistory.get(h.related_entity_id ?? '')) ??
      // installment-scoped rows still belong to a plan in this row; find via any.
      plansForKey.find((p) =>
        (p.installments ?? []).some((i) => i.id === h.related_entity_id),
      ) ??
      latestPlan ??
      undefined;
    const period = plan ? periodForPlan(plan) : null;
    const dot = lifecycleDot(h, period, installmentById, plan);
    if (dot) events.push(dot);
  }

  // Reminders — one collapsed dot per installment.
  const collapsed = collapseReminders(reminderRows, installmentById);
  for (const c of collapsed) {
    const plan = plansForKey.find((p) =>
      (p.installments ?? []).some((i) => i.id === c.installmentId),
    );
    events.push({
      id: `reminders:${c.installmentId}`,
      type: 'reminders',
      occurredAt: c.lastSentAt,
      description:
        `${c.count} reminder${c.count === 1 ? '' : 's'} sent for installment ${
          c.installmentSequence ?? '?'
        } — last ${c.lastKind === 'overdue' ? 'overdue notice' : 'reminder'} on ` +
        `${c.lastSentAt.slice(0, 10)}`,
      reminders: c,
      tenancyPeriod: plan ? periodForPlan(plan) : null,
    });
  }

  // Synthetic overdue — active plans only.
  for (const plan of plansForKey) {
    const period = periodForPlan(plan);
    for (const o of synthesizeOverdue(plan, todayKey)) {
      events.push({
        id: `overdue:${o.installmentId}`,
        type: 'installment_overdue',
        occurredAt: o.occurredAt,
        description: `Installment ${o.sequence} became overdue — ₦${o.amount.toLocaleString()}`,
        installment: {
          id: o.installmentId,
          sequence: o.sequence,
          amount: o.amount,
          dueDate: o.dueDate,
        },
        tenancyPeriod: period,
      });
    }
  }

  // Newest-first, stable.
  events.sort((a, b) => {
    const t = b.occurredAt.localeCompare(a.occurredAt);
    if (t !== 0) return t;
    const p = TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type];
    if (p !== 0) return p;
    return a.id.localeCompare(b.id);
  });

  return {
    key,
    category,
    scope,
    title,
    subtitle: null,
    amount,
    status,
    activePlan: activePlanEntity ? toActivePlanDto(activePlanEntity) : null,
    events,
  };
}

function snapshotFromPlan(
  plan: PaymentPlan | undefined,
): ScheduleSnapshotDto | undefined {
  if (!plan) return undefined;
  const installments = (plan.installments ?? [])
    .slice()
    .sort((a, b) => a.sequence - b.sequence);
  if (installments.length === 0) return undefined;
  return {
    totalAmount: Number(plan.total_amount),
    installments: installments.map((i) => ({
      sequence: i.sequence,
      amount: Number(i.amount),
      dueDate: dbDateKey(i.due_date) as string,
      status: i.status,
    })),
  };
}

function lifecycleDot(
  h: PropertyHistory,
  period: TenancyPeriodDto | null,
  installmentById: Map<string, PaymentPlanInstallment>,
  plan: PaymentPlan | undefined,
): TimelineEventDto | null {
  const base = {
    occurredAt: toIso(h.created_at),
    description: h.event_description ?? '',
    tenancyPeriod: period,
  };
  const meta = (h.metadata ?? {}) as {
    before?: ScheduleSnapshotDto;
    after?: ScheduleSnapshotDto;
    receiptToken?: string;
  };
  switch (h.event_type) {
    case 'payment_plan_created':
      return {
        ...base,
        id: `plan_created:${h.id}`,
        type: 'plan_created',
        snapshot: meta.after ? { after: meta.after } : undefined,
      };
    case 'payment_plan_updated':
      return {
        ...base,
        id: `plan_edited:${h.id}`,
        type: 'plan_edited',
        snapshot:
          meta.before || meta.after
            ? { before: meta.before, after: meta.after }
            : undefined,
      };
    case 'payment_plan_cancelled': {
      const after = meta.after ?? snapshotFromPlan(plan);
      return {
        ...base,
        id: `plan_cancelled:${h.id}`,
        type: 'plan_cancelled',
        snapshot: after ? { after } : undefined,
      };
    }
    case 'payment_plan_completed': {
      const after = meta.after ?? snapshotFromPlan(plan);
      return {
        ...base,
        id: `plan_completed:${h.id}`,
        type: 'plan_completed',
        snapshot: after ? { after } : undefined,
      };
    }
    case 'payment_plan_installment_paid': {
      const inst =
        h.related_entity_type === 'payment_plan_installment' && h.related_entity_id
          ? installmentById.get(h.related_entity_id)
          : undefined;
      return {
        ...base,
        id: `installment_paid:${h.id}`,
        type: 'installment_paid',
        receiptToken: meta.receiptToken ?? null,
        installment: inst
          ? {
              id: inst.id,
              sequence: inst.sequence,
              amount: Number(inst.amount),
              dueDate: dbDateKey(inst.due_date),
            }
          : null,
      };
    }
    default:
      return null;
  }
}

function resolveTitle(
  key: string,
  category: string,
  latestPlan: PaymentPlan | null,
  adHocInvoicesById: Map<string, AdHocInvoice>,
): string {
  if (category === 'ob') return 'Outstanding Balance';
  if (category === 'entire_tenancy') return 'Entire Tenancy';
  if (category === 'ad_hoc') {
    const inv = latestPlan?.ad_hoc_invoice_id
      ? adHocInvoicesById.get(latestPlan.ad_hoc_invoice_id)
      : undefined;
    const lineItem = inv?.line_items
      ?.slice()
      .sort((a, b) => a.sequence - b.sequence)[0];
    return (
      lineItem?.description ||
      inv?.notes ||
      latestPlan?.charge_name ||
      (inv?.invoice_number ? `Invoice ${inv.invoice_number}` : 'Ad-hoc charge')
    );
  }
  // specific_charge
  return latestPlan?.charge_name || 'Charge';
}

function resolveStatus(
  latestPlan: PaymentPlan | null,
  requestsForKey: PaymentPlanRequest[],
): CategoryRowStatus {
  if (latestPlan) {
    switch (latestPlan.status) {
      case PaymentPlanStatus.ACTIVE:
        return 'in_progress';
      case PaymentPlanStatus.COMPLETED:
        return 'completed';
      case PaymentPlanStatus.CANCELLED:
        return 'cancelled';
    }
  }
  if (requestsForKey.some((r) => r.status === PaymentPlanRequestStatus.PENDING)) {
    return 'awaiting_approval';
  }
  const latestRequest = requestsForKey[requestsForKey.length - 1];
  if (latestRequest?.status === PaymentPlanRequestStatus.DECLINED) {
    return 'declined';
  }
  return 'awaiting_approval';
}

function toActivePlanDto(plan: PaymentPlan): ActivePlanDto {
  return {
    id: plan.id,
    scope: plan.scope,
    chargeName: plan.charge_name,
    sourceType: plan.source_type ?? null,
    adHocInvoiceId: plan.ad_hoc_invoice_id ?? null,
    planType: plan.plan_type,
    totalAmount: Number(plan.total_amount),
    installments: (plan.installments ?? [])
      .slice()
      .sort((a, b) => a.sequence - b.sequence)
      .map((i) => ({
        id: i.id,
        sequence: i.sequence,
        amount: Number(i.amount),
        dueDate: dbDateKey(i.due_date) as string,
        status: i.status,
      })),
  };
}
