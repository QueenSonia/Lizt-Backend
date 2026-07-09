import { PropertyHistory } from '../../property-history/entities/property-history.entity';
import { PaymentPlanInstallment } from '../entities/payment-plan-installment.entity';
import {
  CollapsedRemindersDto,
  ReminderKind,
  ReminderSendDto,
} from './dto/payment-plan-timeline.dto';
import {
  businessDateKey,
  daysBetweenKeys,
  dbDateKey,
  toIso,
  toMillis,
} from './date-util';

export const REMINDER_UPCOMING_EVENT = 'payment_plan_installment_reminder_sent';
export const REMINDER_OVERDUE_EVENT = 'payment_plan_installment_overdue_sent';

function kindOf(row: PropertyHistory): ReminderKind {
  return row.event_type === REMINDER_OVERDUE_EVENT ? 'overdue' : 'upcoming';
}

/**
 * A human D-label for a single send, derived at read time (the reminder row
 * doesn't persist which cadence step it was). Overdue sends read 'overdue';
 * pre-due sends read 'D-<n>' where n is days-until-due (7 / 1 / 0).
 */
function labelFor(
  row: PropertyHistory,
  installment: PaymentPlanInstallment | undefined,
): string {
  if (kindOf(row) === 'overdue') return 'overdue';
  const dueKey = installment ? dbDateKey(installment.due_date) : null;
  if (!dueKey || !row.created_at) return 'reminder';
  const sentKey = businessDateKey(row.created_at);
  const daysUntilDue = daysBetweenKeys(dueKey, sentKey);
  return daysUntilDue >= 0 ? `D-${daysUntilDue}` : 'overdue';
}

/**
 * Collapse every reminder-send history row into ONE dot per installment:
 * count + last-sent + which kind was last, with the full send list kept for
 * expansion. `rows` must already be scoped to this category's installments.
 */
export function collapseReminders(
  rows: PropertyHistory[],
  installmentById: Map<string, PaymentPlanInstallment>,
): CollapsedRemindersDto[] {
  const byInstallment = new Map<string, PropertyHistory[]>();
  for (const row of rows) {
    const id = row.related_entity_id;
    if (!id) continue;
    const arr = byInstallment.get(id) ?? [];
    arr.push(row);
    byInstallment.set(id, arr);
  }

  const out: CollapsedRemindersDto[] = [];
  for (const [installmentId, sends] of byInstallment) {
    sends.sort((a, b) => toMillis(a.created_at) - toMillis(b.created_at));
    const installment = installmentById.get(installmentId);
    const sendDtos: ReminderSendDto[] = sends.map((row) => ({
      sentAt: toIso(row.created_at),
      kind: kindOf(row),
      label: labelFor(row, installment),
    }));
    const last = sends[sends.length - 1];
    out.push({
      installmentId,
      installmentSequence: installment?.sequence ?? null,
      count: sends.length,
      lastSentAt: toIso(last.created_at),
      lastKind: kindOf(last),
      sends: sendDtos,
    });
  }
  return out;
}
