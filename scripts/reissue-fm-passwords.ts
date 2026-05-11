/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * One-off script — re-issue memorable temporary passwords to every existing
 * facility-manager account that was created before the multi-role login work.
 *
 * Why this exists:
 *   The original FM-invite flow generated a random password, hashed it, threw
 *   the plain value away, and never sent it anywhere. That bug effectively
 *   meant no FM has ever successfully signed in. After deploying the new login
 *   stack, run this once on production to give all existing FMs working creds.
 *
 * Scope:
 *   Only accounts whose roles[] is exactly ['facility_manager']. Dual-role rows
 *   (e.g. landlord + FM) are skipped — those have a usable password from the
 *   landlord side and the FM half is reachable with the same credentials.
 *
 * Usage (from lizt-backend/):
 *   npm run script:reissue-fm-passwords -- --dry-run   # preview only
 *   npm run script:reissue-fm-passwords                # re-issue + send WA
 *
 * The script bootstraps a Nest application context (no HTTP server) so it can
 * inject the same UtilService, AccountRepository, and WhatsappBotService that
 * the production app uses, instead of duplicating their logic.
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AppModule } from '../src/app.module';
import { Account } from '../src/users/entities/account.entity';
import { RolesEnum } from '../src/base.entity';
import { UtilService } from '../src/utils/utility-service';
import { WhatsappBotService } from '../src/whatsapp-bot/whatsapp-bot.service';

interface RunResult {
  ok: number;
  failed: number;
  skipped: number;
  failures: Array<{ accountId: string; phone: string; reason: string }>;
}

function maskPhone(phone: string | undefined | null): string {
  if (!phone) return '<no-phone>';
  if (phone.length <= 4) return phone;
  return `${phone.slice(0, 4)}***${phone.slice(-4)}`;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  console.log(
    `\n🔧 reissue-fm-passwords starting${dryRun ? ' (DRY RUN — no writes, no sends)' : ''}\n`,
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const accountRepo = app.get<Repository<Account>>(
      getRepositoryToken(Account),
    );
    const utilService = app.get(UtilService);
    const whatsappService = app.get(WhatsappBotService);

    // Find FM-only accounts. We rely on the post-migration roles[] column;
    // legacy single-role rows with roles=['facility_manager'] match here.
    // Use a raw query so we can pin the equality semantics for arrays.
    const candidates: Account[] = await accountRepo
      .createQueryBuilder('account')
      .leftJoinAndSelect('account.user', 'user')
      .where('account.roles = :roles', {
        roles: [RolesEnum.FACILITY_MANAGER],
      })
      .andWhere('account.deleted_at IS NULL')
      .getMany();

    console.log(`Found ${candidates.length} FM-only accounts.\n`);

    if (candidates.length === 0) {
      console.log('Nothing to do. Exiting.');
      return;
    }

    const result: RunResult = {
      ok: 0,
      failed: 0,
      skipped: 0,
      failures: [],
    };

    for (const account of candidates) {
      const phone = account.user?.phone_number ?? '';
      const masked = maskPhone(phone);

      if (!phone) {
        console.log(
          `SKIP ${account.id} ${masked} (no phone number on linked user)`,
        );
        result.skipped += 1;
        continue;
      }

      if (dryRun) {
        console.log(`DRY-RUN ${account.id} ${masked} (would re-issue)`);
        result.ok += 1;
        continue;
      }

      try {
        const { plain, hash } = await utilService.generatePassword();

        // Persist new hash before sending — if the WhatsApp send fails, the
        // user can still recover via forgot-password against the new hash.
        account.password = hash;
        account.is_verified = true;
        await accountRepo.save(account);

        const firstName =
          account.user?.first_name ??
          account.profile_name ??
          'Facility Manager';

        await whatsappService.sendToFacilityManagerWithTemplate({
          phone_number: phone,
          name: utilService.toSentenceCase(firstName),
          team: 'your team',
          role: 'Facility Manager',
          temporary_password: plain,
        });

        console.log(`OK ${account.id} ${masked}`);
        result.ok += 1;
      } catch (err: any) {
        const reason = err?.message || String(err);
        console.error(`FAIL ${account.id} ${masked} :: ${reason}`);
        result.failed += 1;
        result.failures.push({ accountId: account.id, phone: masked, reason });
      }
    }

    console.log(
      `\n— Summary —\n  OK:      ${result.ok}\n  Failed:  ${result.failed}\n  Skipped: ${result.skipped}\n`,
    );

    if (result.failures.length > 0) {
      console.log('Failures:');
      for (const f of result.failures) {
        console.log(`  ${f.accountId} ${f.phone} :: ${f.reason}`);
      }
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('Script crashed:', err);
  process.exit(1);
});
