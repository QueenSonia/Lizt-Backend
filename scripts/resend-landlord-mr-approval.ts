/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * One-off script — re-send the landlord WhatsApp "approve / reject" prompt for a
 * single maintenance request.
 *
 * Why this exists:
 *   When the landlord originally tapped Approve, the common-area ownership bug
 *   (common_areas.owner_id stored a User.id, compared against the caller's
 *   Account.id) made the bot reply "You do not have access to this request."
 *   After the fix + migration 1801, the request is actionable again — but the
 *   original WhatsApp message's buttons are stale. This re-sends a fresh
 *   `landlord_maintenance_request_notification` (same template, same Approve /
 *   Reject button payloads) so the landlord can tap Approve again.
 *
 * Prerequisites:
 *   - The fixed code must be LIVE on the target environment (prod), and migration
 *     1801 applied to its DB. Re-sending against the old code just reproduces the
 *     bug.
 *   - The request must still be `not_approved`.
 *
 * Usage (from lizt-backend/, with env pointed at the target DB + WhatsApp creds):
 *   npm run script:resend-mr-approval -- --id <requestId> --dry-run   # preview
 *   npm run script:resend-mr-approval -- --id <requestId>             # send
 *
 * Defaults to the soakaway common-area request if --id is omitted.
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AppModule } from '../src/app.module';
import { MaintenanceRequest } from '../src/maintenance-requests/entities/maintenance-request.entity';
import { Account } from '../src/users/entities/account.entity';
import { MaintenanceRequestStatusEnum } from '../src/maintenance-requests/dto/create-maintenance-request.dto';
import { TemplateSenderService } from '../src/whatsapp-bot/template-sender';
import { UtilService } from '../src/utils/utility-service';

const DEFAULT_REQUEST_ID = '55ed35ec-3950-4647-9aa8-1dedcbf096f7';

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const requestId = argValue('--id') ?? DEFAULT_REQUEST_ID;
  const dryRun = process.argv.includes('--dry-run');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const mrRepo = app.get<Repository<MaintenanceRequest>>(
      getRepositoryToken(MaintenanceRequest),
    );
    const accountRepo = app.get<Repository<Account>>(
      getRepositoryToken(Account),
    );
    const templateSender = app.get(TemplateSenderService);
    const utilService = app.get(UtilService);

    const sr = await mrRepo.findOne({
      where: { id: requestId },
      relations: ['property', 'common_area', 'tenant', 'tenant.user'],
    });
    if (!sr) {
      throw new Error(`Maintenance request ${requestId} not found`);
    }
    if (sr.status !== MaintenanceRequestStatusEnum.NOT_APPROVED) {
      throw new Error(
        `Request ${requestId} is ${sr.status}, not not_approved — nothing to approve.`,
      );
    }

    // Both owner columns now hold the landlord's Account.id (migration 1801).
    const landlordAccountId =
      sr.property?.owner_id ?? sr.common_area?.owner_id ?? null;
    if (!landlordAccountId) {
      throw new Error(`Request ${requestId} has no resolvable owner.`);
    }

    const landlordAccount = await accountRepo.findOne({
      where: { id: landlordAccountId },
      relations: ['user'],
    });
    const phone = landlordAccount?.user?.phone_number;
    if (!phone) {
      throw new Error(
        `No phone number on landlord account ${landlordAccountId}.`,
      );
    }

    const propertyName =
      sr.property?.name ?? sr.common_area?.name ?? sr.property_name ?? '';
    const reporter =
      (sr.tenant?.user
        ? `${sr.tenant.user.first_name ?? ''} ${sr.tenant.user.last_name ?? ''}`.trim()
        : '') ||
      sr.tenant_name ||
      'Facility manager';
    const dateCreated = new Date(sr.date_reported ?? sr.created_at).toLocaleString(
      'en-US',
      {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Africa/Lagos',
      },
    );

    console.log('Resending landlord approval prompt:');
    console.log(`  request:   ${sr.id} (${sr.status})`);
    console.log(`  scope:     ${sr.scope}`);
    console.log(`  area/prop: ${propertyName}`);
    console.log(`  landlord:  acct ${landlordAccountId} → ${phone}`);
    console.log(`  reporter:  ${reporter}`);

    if (dryRun) {
      console.log('\n[dry-run] No message sent.');
      return;
    }

    await templateSender.sendFacilityMaintenanceRequest({
      phone_number: phone,
      manager_name: reporter,
      property_name: propertyName,
      property_location: sr.property?.location ?? '',
      maintenance_request: utilService.sanitizeTemplateParam(
        sr.description ?? '',
      ),
      tenant_name: reporter,
      tenant_phone_number: sr.tenant?.user?.phone_number ?? '',
      date_created: dateCreated,
      is_landlord: true,
      maintenance_request_id: sr.id,
    });

    console.log('\n✅ Sent. The landlord can tap Approve / Reject again.');
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('resend-landlord-mr-approval failed:', err?.message ?? err);
  process.exit(1);
});
