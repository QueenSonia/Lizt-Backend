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
 * Due date the send was actually computed against. Editing a plan can move
 * an installment's due_date after reminders have gone out, so a label read
 * off the CURRENT due date drifts (a D-1 send re-reads as D-25). Newer rows
 * stamp metadata.due_date_at_send; older rows carry it only inside the human
 * description ("… due 07/07/2026", en-GB dd/mm/yyyy) — parse that instead.
 */
function dueKeyAtSend(row: PropertyHistory): string | null {
  const stamped = row.metadata?.due_date_at_send;
  if (typeof stamped === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(stamped)) {
    return stamped;
  }
  const m = row.event_description?.match(/ due (\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/**
 * A human D-label for a single send, derived at read time (the reminder row
 * doesn't persist which cadence step it was). Overdue sends read 'overdue';
 * pre-due sends read 'D-<n>' where n is days-until-due (7 / 1 / 0), measured
 * against the due date in effect when the send happened.
 */
function labelFor(
  row: PropertyHistory,
  installment: PaymentPlanInstallment | undefined,
): string {
  if (kindOf(row) === 'overdue') return 'overdue';
  const dueKey =
    dueKeyAtSend(row) ?? (installment ? dbDateKey(installment.due_date) : null);
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
