/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * One-off backfill — auto-close the backlog of unit-scoped maintenance requests
 * that have already been reminded to confirm resolution 2+ times and never got
 * a response. For each such request this:
 *   1. closes it (RESOLVED → CLOSED, attempt outcome EXPIRED, auto_closed=true),
 *      mirroring MaintenanceRequestsService.autoCloseUnitForNoResponse,
 *   2. queues the tenant "closed — no response" WhatsApp template (a PENDING
 *      whatsapp_notification_log row the deployed app's retry cron sends), and
 *   3. writes the closure row to the landlord Live Feed (notifications table).
 *
 * Steady-state, the daily MaintenanceReminderService does this on the weekly
 * tick after the 2nd reminder. This is the IMMEDIATE one-time catch-up for
 * requests already past the cap when the feature shipped (no 7-day grace).
 *
 * Runs on a standalone TypeORM DataSource (src/data-source.ts) — NOT the Nest
 * AppModule — so it works regardless of the app's WhatsApp/bootstrap wiring and
 * does no sending itself. The queued PENDING rows are delivered by the deployed
 * environment's retry cron (via the simulator on dev; via Meta on prod, which
 * is why prod needs the template approved first).
 *
 * ⚠️ PREREQUISITES:
 *   1. Migration 1925 applied to the target DB (expired outcome, notification
 *      types, auto_closed column).
 *   2. On PROD only: the `tenant_maintenance_auto_closed` template APPROVED in
 *      Meta (dev sends via the simulator, so no approval needed there).
 *
 * Usage (from lizt-backend/, env pointed at the target DB):
 *   npm run script:backfill-maintenance-auto-close                 # dry-run (default)
 *   npm run script:backfill-maintenance-auto-close -- --confirm    # close + notify
 *
 * Dry-run lists every request that WOULD be closed and mutates nothing.
 * Re-running is safe: closed requests no longer match, and the close is a
 * conditional (status=resolved) update.
 */

import 'reflect-metadata';
import { AppDataSource, ensureDbConnection } from '../src/data-source';
import { MaintenanceRequest } from '../src/maintenance-requests/entities/maintenance-request.entity';
import {
  MaintenanceResolutionAttempt,
  ResolutionAttemptOutcomeEnum,
} from '../src/maintenance-requests/entities/maintenance-resolution-attempt.entity';
import {
  MaintenanceRequestScopeEnum,
  MaintenanceRequestStatusEnum,
} from '../src/maintenance-requests/dto/create-maintenance-request.dto';
import {
  WhatsAppNotificationLog,
  WhatsAppNotificationStatus,
} from '../src/whatsapp-bot/entities/whatsapp-notification-log.entity';
import { Notification } from '../src/notifications/entities/notification.entity';
import { NotificationType } from '../src/notifications/enums/notification-type';

// Must match MaintenanceReminderService.
const CONFIRMATION_TEMPLATE_TYPE = 'sendTenantConfirmationTemplate';
const CLOSURE_TEMPLATE_TYPE = 'sendTenantMaintenanceAutoClosedTemplate';
const MAX_CONFIRMATION_REMINDERS = 2;

/** Meta-safe free text: strip invisibles, collapse whitespace, trim, cap. */
function sanitize(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

function sentenceCase(value: string | null | undefined): string {
  const s = (value ?? '').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

function issueSnippet(description: string | null | undefined): string {
  const text = (description ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return 'the reported issue';
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

async function main(): Promise<void> {
  const confirm = process.argv.includes('--confirm');

  await ensureDbConnection();
  const mrRepo = AppDataSource.getRepository(MaintenanceRequest);
  const attemptRepo = AppDataSource.getRepository(MaintenanceResolutionAttempt);
  const logRepo = AppDataSource.getRepository(WhatsAppNotificationLog);
  const notificationRepo = AppDataSource.getRepository(Notification);

  try {
    // Same candidate set as the cron, minus the day/window gates.
    const candidates = await mrRepo
      .createQueryBuilder('sr')
      .leftJoinAndSelect('sr.tenant', 'tenant')
      .leftJoinAndSelect('tenant.user', 'tenantUser')
      .leftJoinAndSelect('sr.property', 'property')
      .where('sr.status = :status', {
        status: MaintenanceRequestStatusEnum.RESOLVED,
      })
      .andWhere('sr.scope = :scope', {
        scope: MaintenanceRequestScopeEnum.UNIT,
      })
      .andWhere('sr.tenant_id IS NOT NULL')
      .andWhere('sr.resolution_date IS NOT NULL')
      .getMany();

    const toClose: { sr: MaintenanceRequest; reminders: number }[] = [];
    for (const sr of candidates) {
      const reminders = await logRepo
        .createQueryBuilder('log')
        .where('log.reference_id = :id', { id: sr.id })
        .andWhere('log.type = :type', { type: CONFIRMATION_TEMPLATE_TYPE })
        .andWhere('log.status IN (:...statuses)', {
          statuses: [
            WhatsAppNotificationStatus.PENDING,
            WhatsAppNotificationStatus.SENT,
          ],
        })
        .getCount();
      if (reminders >= MAX_CONFIRMATION_REMINDERS) toClose.push({ sr, reminders });
    }

    console.log(
      `\nTarget DB host: ${(process.env.PROD_DB_HOST ?? '').split('.')[0] || '(unknown)'}`,
    );
    console.log(
      `Found ${candidates.length} unconfirmed RESOLVED unit request(s); ${toClose.length} at/over the ${MAX_CONFIRMATION_REMINDERS}-reminder cap.\n`,
    );
    for (const { sr, reminders } of toClose) {
      console.log(
        `  ${sr.request_id} (${sr.id}) — ${reminders} reminders — "${issueSnippet(sr.description)}"`,
      );
    }

    if (!confirm) {
      console.log(
        `\n[dry-run] Nothing closed. Re-run with --confirm to close ${toClose.length} request(s) and notify tenants.`,
      );
      return;
    }

    let closed = 0;
    let notified = 0;
    for (const { sr } of toClose) {
      try {
        // Idempotent conditional close (mirrors autoCloseUnitForNoResponse).
        const res = await mrRepo
          .createQueryBuilder()
          .update(MaintenanceRequest)
          .set({
            status: MaintenanceRequestStatusEnum.CLOSED,
            auto_closed: true,
          })
          .where('id = :id', { id: sr.id })
          .andWhere('status = :resolved', {
            resolved: MaintenanceRequestStatusEnum.RESOLVED,
          })
          .execute();
        if (!res.affected) continue; // already closed elsewhere
        closed++;

        // Latest resolution attempt → EXPIRED.
        const attempt = await attemptRepo.findOne({
          where: { maintenance_request_id: sr.id },
          order: { attempt_number: 'DESC' },
        });
        if (attempt) {
          attempt.outcome = ResolutionAttemptOutcomeEnum.EXPIRED;
          attempt.outcome_decided_at = new Date();
          await attemptRepo.save(attempt);
        }

        // Queue the tenant closure template (PENDING → sent by the deployed
        // env's retry cron; simulator on dev).
        const tenantUser = sr.tenant?.user;
        if (tenantUser?.phone_number) {
          await logRepo.save(
            logRepo.create({
              type: CLOSURE_TEMPLATE_TYPE,
              payload: {
                phone_number: tenantUser.phone_number,
                tenant_name: sentenceCase(tenantUser.first_name),
                maintenance_title: sanitize(sr.description),
              },
              reference_id: sr.id,
              status: WhatsAppNotificationStatus.PENDING,
              attempts: 0,
              last_attempted_at: null,
              last_error: null,
            }),
          );
          notified++;
        }

        // Live Feed row (addressed to the landlord; admin visibility + push are
        // handled by the app's read-scoping / push retarget).
        const landlordId = sr.property?.owner_id ?? null;
        if (landlordId) {
          const tenantName =
            `${sentenceCase(tenantUser?.first_name)} ${sentenceCase(
              tenantUser?.last_name,
            )}`.trim() || 'the tenant';
          const propertyLabel =
            sr.property?.name ?? sr.property_name ?? 'their unit';
          await notificationRepo.save(
            notificationRepo.create({
              date: new Date().toISOString(),
              type: NotificationType.MAINTENANCE_AUTO_CLOSED,
              description: `Maintenance request "${issueSnippet(sr.description)}" at ${propertyLabel} was automatically closed after ${tenantName} did not respond to ${MAX_CONFIRMATION_REMINDERS} confirmation reminders.`,
              status: 'Completed',
              property_id: sr.property_id,
              user_id: landlordId,
              maintenance_request_id: sr.id,
            }),
          );
        }
      } catch (err) {
        console.error(`  ✗ ${sr.request_id}: ${(err as Error)?.message ?? err}`);
      }
    }

    console.log(
      `\n✅ Closed ${closed} request(s); queued ${notified} tenant closure notification(s).`,
    );
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error('backfill-maintenance-auto-close failed:', err?.message ?? err);
  process.exit(1);
});
