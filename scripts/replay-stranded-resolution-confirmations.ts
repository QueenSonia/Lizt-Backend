/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * One-off script — replay the tenant "Yes, it's fixed" tap for maintenance
 * requests whose confirmation crashed before it could be applied.
 *
 * Why this exists:
 *   `findResolutionRequest` looked the request up by `{ id: requestId }` while
 *   the WhatsApp button payload carries the *human* request_id ("#SR…"). Every
 *   tap threw `invalid input syntax for type uuid` before mutating anything, so
 *   these requests are stranded in RESOLVED: never closed, landlord + FMs never
 *   notified, and the tenant got no reply at all. Fixed in 9606ac5.
 *
 * What a tap was supposed to do (handleConfirmResolutionYes):
 *   1. status → CLOSED, with the tenant recorded as the actor
 *   2. "Fantastic! Glad that's sorted 😊" back to the tenant
 *   3. maintenance_request_closed template to landlord + FMs
 *   This script does all three, in that order.
 *
 * Runtime: this does NOT talk to the running API over HTTP — there is no URL or
 * auth token. It boots the Nest AppModule in-process via
 * createApplicationContext and calls the service directly, so it needs the same
 * env the server uses (DB + WhatsApp creds). Easiest is to run it on the
 * droplet, from the repo root, where .env already resolves.
 *
 * Safety:
 *   - Goes through TenantFlowService.confirmTenantRequestFixed, which delegates
 *     to confirmTenantRequestResolved — that verifies the caller IS the tenant
 *     and that status is still RESOLVED. A request that has since been
 *     auto-closed or reopened is skipped, not stomped.
 *   - Additionally asserts the tenant's phone matches the number that actually
 *     tapped (from the error log), so a mistyped request_id can't close a
 *     stranger's request. Omit the phone to skip that assertion.
 *   - Dry-run is the DEFAULT; `--commit` is required to write. This deviates
 *     from the --dry-run convention of the sibling scripts on purpose: this one
 *     both mutates rows and fans WhatsApp messages out to multiple stakeholders
 *     across several requests, so the safe mode is the one you get by accident.
 *
 * Usage (from lizt-backend/, env pointed at the target DB + WhatsApp creds):
 *   npx ts-node -r tsconfig-paths/register scripts/replay-stranded-resolution-confirmations.ts
 *   npx ts-node -r tsconfig-paths/register scripts/replay-stranded-resolution-confirmations.ts --commit
 *
 *   # override the target list (phone optional, after a colon):
 *   ... --requests '#SR5297520BN:2347036784937,#SR288013CKG'
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AppModule } from '../src/app.module';
import { MaintenanceRequest } from '../src/maintenance-requests/entities/maintenance-request.entity';
import { MaintenanceRequestStatusEnum } from '../src/maintenance-requests/dto/create-maintenance-request.dto';
import { TenantFlowService } from '../src/whatsapp-bot/tenant-flow';
import { TemplateSenderService } from '../src/whatsapp-bot/template-sender';
import { UtilService } from '../src/utils/utility-service';

/**
 * Every tap stranded by the regression, derived from chat_logs on prod rather
 * than the pm2 error log (which had already rotated past some of them):
 *
 *   SELECT metadata->'raw_message'->'button'->>'payload' FROM chat_logs
 *   WHERE direction='INBOUND' AND payload LIKE 'confirm_resolution\_%:%'
 *
 * cross-joined against maintenance_requests.status = 'resolved'. All five are
 * "yes" taps — no stranded "no" taps exist, so closing is the right action for
 * every entry here. Phone is the number that tapped, cross-checked against the
 * request's tenant at run time.
 */
const DEFAULT_TARGETS: Array<{ requestId: string; phone?: string }> = [
  { requestId: '#SR5297520BN', phone: '2347036784937' }, // Jidechukwu Nwanya, 07-14
  { requestId: '#SR767404J6A', phone: '2348184350211' }, // Tunji Oginni, 07-14
  { requestId: '#SR288013CKG', phone: '2348133614809' }, // Oluwafunke Odelana, 07-15
  { requestId: '#SR2567042P7', phone: '2347058415299' }, // Oreoluwa Abijo, 07-15
  { requestId: '#SR388086CNO', phone: '2348033742412' }, // Omotayo Famurewa, 07-18
];

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function parseTargets(): Array<{ requestId: string; phone?: string }> {
  const raw = argValue('--requests');
  if (!raw) return DEFAULT_TARGETS;
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [requestId, phone] = entry.split(':');
      return { requestId: requestId.trim(), phone: phone?.trim() || undefined };
    });
}

async function main(): Promise<void> {
  const targets = parseTargets();
  const commit = process.argv.includes('--commit');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const summary: string[] = [];

  try {
    const mrRepo = app.get<Repository<MaintenanceRequest>>(
      getRepositoryToken(MaintenanceRequest),
    );
    const tenantFlow = app.get(TenantFlowService);
    const templateSender = app.get(TemplateSenderService);
    const utilService = app.get(UtilService);

    console.log(
      commit
        ? '=== COMMIT — rows will change and messages will send ===\n'
        : '=== DRY RUN — nothing will be written or sent (pass --commit) ===\n',
    );

    for (const { requestId, phone } of targets) {
      const sr = await mrRepo.findOne({
        where: { request_id: requestId },
        relations: ['tenant', 'tenant.user', 'property'],
      });

      if (!sr) {
        console.log(`${requestId}: NOT FOUND — skipped`);
        summary.push(`${requestId}: not found`);
        continue;
      }

      const tenantUser = sr.tenant?.user;
      const tenantPhone = tenantUser?.phone_number ?? null;
      const tenantName = tenantUser
        ? utilService.formatPersonName(
            tenantUser.first_name,
            tenantUser.last_name,
          )
        : '(no tenant)';

      console.log(`${requestId}:`);
      console.log(`  uuid:     ${sr.id}`);
      console.log(`  status:   ${sr.status}`);
      console.log(`  tenant:   ${tenantName} → ${tenantPhone ?? '(no phone)'}`);
      console.log(`  property: ${sr.property?.name ?? sr.property_name ?? '—'}`);
      console.log(`  issue:    ${(sr.description ?? '').slice(0, 80)}`);

      if (!tenantUser?.id) {
        console.log('  → SKIPPED: no tenant user on this request\n');
        summary.push(`${requestId}: no tenant user`);
        continue;
      }

      // Cross-check the tapping number against the request's tenant.
      if (phone) {
        const expected = utilService.normalizePhoneNumber(phone);
        const actual = tenantPhone
          ? utilService.normalizePhoneNumber(tenantPhone)
          : null;
        if (expected !== actual) {
          console.log(
            `  → SKIPPED: tapping number ${expected} != tenant ${actual ?? 'none'}\n`,
          );
          summary.push(`${requestId}: phone mismatch`);
          continue;
        }
      }

      // The tap is only meaningful while the request still awaits confirmation.
      // Auto-close (confirmation-reminder cap) or a reopen may have moved it on.
      if (sr.status !== MaintenanceRequestStatusEnum.RESOLVED) {
        console.log(
          `  → SKIPPED: status is ${sr.status}, no longer awaiting confirmation\n`,
        );
        summary.push(`${requestId}: already ${sr.status}`);
        continue;
      }

      if (!commit) {
        console.log('  → would CLOSE, text the tenant, notify landlord + FMs\n');
        summary.push(`${requestId}: ready to replay`);
        continue;
      }

      // 1 + 3: close as the tenant, then notify landlord + FMs.
      const ok = await tenantFlow.confirmTenantRequestFixed({
        tenantUserId: tenantUser.id,
        requestId,
      });

      if (!ok) {
        console.log('  → FAILED: confirmTenantRequestFixed returned false\n');
        summary.push(`${requestId}: confirm returned false`);
        continue;
      }

      // 2: the reply the crash denied them. Sent after the close so a WhatsApp
      // failure here can't roll back or block the state change. Free-form text
      // is subject to the 24h session window, so on an old tap this will often
      // fail — by design that costs us nothing but the reply.
      if (tenantPhone) {
        try {
          await templateSender.sendText(
            utilService.normalizePhoneNumber(tenantPhone),
            "Fantastic! Glad that's sorted 😊",
          );
        } catch (err: any) {
          console.log(
            `  ! closed, but tenant text failed: ${err?.message ?? err}`,
          );
        }
      }

      console.log('  → CLOSED + notified\n');
      summary.push(`${requestId}: replayed`);
    }

    console.log('--- summary ---');
    summary.forEach((line) => console.log(`  ${line}`));
    if (!commit) {
      console.log('\nRe-run with --commit to apply.');
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(
    'replay-stranded-resolution-confirmations failed:',
    err?.message ?? err,
  );
  process.exit(1);
});
