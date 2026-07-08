/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * One-off backfill — auto-close the backlog of unit-scoped maintenance requests
 * that have already been reminded to confirm resolution 2+ times and never got
 * a response. For each such request this:
 *   1. closes it (RESOLVED → CLOSED, attempt outcome EXPIRED, auto_closed=true)
 *      via MaintenanceRequestsService.autoCloseUnitForNoResponse (idempotent),
 *   2. queues the tenant "closed — no response" WhatsApp template, and
 *   3. writes the closure row to the landlord Live Feed.
 *
 * Steady-state, the daily MaintenanceReminderService does this on the weekly
 * tick after the 2nd reminder. This script performs the IMMEDIATE one-time
 * catch-up for requests that were already past the cap when the feature shipped
 * (no 7-day grace — they've had far longer already).
 *
 * ⚠️ PREREQUISITES — do NOT run until BOTH are true:
 *   1. The `tenant_maintenance_auto_closed` template is APPROVED in Meta.
 *      Running earlier means every queued closure notification fails the Meta
 *      send and burns its 3 retries.
 *   2. The code (this feature) + migration 1925 are LIVE on the target env
 *      (prod), so the `expired` outcome, the notification enum values, and the
 *      `auto_closed` column all exist.
 *
 * Usage (from lizt-backend/, env pointed at the target DB + WhatsApp creds):
 *   npm run script:backfill-maintenance-auto-close                 # dry-run (default)
 *   npm run script:backfill-maintenance-auto-close -- --confirm    # actually close + notify
 *
 * Dry-run lists every request that WOULD be closed and its reminder count, and
 * mutates nothing. Re-running after a partial run is safe: closed requests no
 * longer match (status != RESOLVED) and the conditional close is idempotent.
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AppModule } from '../src/app.module';
import { MaintenanceRequest } from '../src/maintenance-requests/entities/maintenance-request.entity';
import {
  MaintenanceRequestScopeEnum,
  MaintenanceRequestStatusEnum,
} from '../src/maintenance-requests/dto/create-maintenance-request.dto';
import { MaintenanceRequestsService } from '../src/maintenance-requests/maintenance-requests.service';
import { WhatsAppNotificationLogService } from '../src/whatsapp-bot/whatsapp-notification-log.service';
import { NotificationService } from '../src/notifications/notification.service';
import { NotificationType } from '../src/notifications/enums/notification-type';
import { UtilService } from '../src/utils/utility-service';

// Must match MaintenanceReminderService.
const CONFIRMATION_TEMPLATE_TYPE = 'sendTenantConfirmationTemplate';
const CLOSURE_TEMPLATE_TYPE = 'sendTenantMaintenanceAutoClosedTemplate';
const MAX_CONFIRMATION_REMINDERS = 2;

function issueSnippet(sr: MaintenanceRequest): string {
  const text = (sr.description ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return 'the reported issue';
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

async function main(): Promise<void> {
  const confirm = process.argv.includes('--confirm');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const mrRepo = app.get<Repository<MaintenanceRequest>>(
      getRepositoryToken(MaintenanceRequest),
    );
    const mrService = app.get(MaintenanceRequestsService);
    const logService = app.get(WhatsAppNotificationLogService);
    const notificationService = app.get(NotificationService);
    const utilService = app.get(UtilService);

    // Same candidate set as the cron, minus the day/window gates (this is the
    // immediate catch-up): unit-scoped, still RESOLVED, has a tenant to notify.
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

    // Keep only those already at/over the reminder cap.
    const toClose: { sr: MaintenanceRequest; reminders: number }[] = [];
    for (const sr of candidates) {
      const reminders = await logService.countByReference(
        sr.id,
        CONFIRMATION_TEMPLATE_TYPE,
      );
      if (reminders >= MAX_CONFIRMATION_REMINDERS) {
        toClose.push({ sr, reminders });
      }
    }

    console.log(
      `Found ${candidates.length} unconfirmed RESOLVED unit request(s); ${toClose.length} at/over the ${MAX_CONFIRMATION_REMINDERS}-reminder cap.\n`,
    );
    for (const { sr, reminders } of toClose) {
      console.log(
        `  ${sr.request_id} (${sr.id}) — ${reminders} reminders — "${issueSnippet(sr)}"`,
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
        const didClose = await mrService.autoCloseUnitForNoResponse(sr.id);
        if (!didClose) continue; // already closed by the cron / a prior run
        closed++;

        const tenantUser = sr.tenant?.user;
        if (tenantUser?.phone_number) {
          await logService.queue(
            CLOSURE_TEMPLATE_TYPE,
            {
              phone_number: utilService.normalizePhoneNumber(
                tenantUser.phone_number,
              ),
              tenant_name: utilService.toSentenceCase(
                tenantUser.first_name ?? '',
              ),
              maintenance_title: utilService.sanitizeTemplateParam(
                sr.description ?? '',
              ),
            },
            sr.id,
          );
          notified++;
        }

        const landlordId = sr.property?.owner_id ?? null;
        if (landlordId) {
          const tenantName =
            `${utilService.toSentenceCase(tenantUser?.first_name ?? '')} ${utilService.toSentenceCase(
              tenantUser?.last_name ?? '',
            )}`.trim() || 'the tenant';
          const propertyLabel =
            sr.property?.name ?? sr.property_name ?? 'their unit';
          await notificationService.create({
            date: new Date().toISOString(),
            type: NotificationType.MAINTENANCE_AUTO_CLOSED,
            description: `Maintenance request "${issueSnippet(sr)}" at ${propertyLabel} was automatically closed after ${tenantName} did not respond to ${MAX_CONFIRMATION_REMINDERS} confirmation reminders.`,
            status: 'Completed',
            property_id: sr.property_id,
            user_id: landlordId,
            maintenance_request_id: sr.id,
          });
        }
      } catch (err) {
        console.error(
          `  ✗ ${sr.request_id}: ${(err as Error)?.message ?? err}`,
        );
      }
    }

    console.log(
      `\n✅ Closed ${closed} request(s); queued ${notified} tenant closure notification(s).`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('backfill-maintenance-auto-close failed:', err?.message ?? err);
  process.exit(1);
});
