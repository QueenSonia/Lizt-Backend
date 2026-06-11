import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { TenantBalancesService } from '../src/tenant-balances/tenant-balances.service';
import { TenanciesService } from '../src/tenancies/tenancies.service';
import {
  TenantBalanceLedger,
  TenantBalanceLedgerType,
} from '../src/tenant-balances/entities/tenant-balance-ledger.entity';
import { PaymentPlanInstallment } from '../src/payment-plans/entities/payment-plan-installment.entity';
import { PaymentPlanScope } from '../src/payment-plans/entities/payment-plan.entity';

/**
 * Repair phantom wallet credits from invoice-fee charge plans.
 *
 * BACKGROUND (the bug this repairs):
 *   A charge-scope payment plan that targets a current-period invoice fee
 *   (rent / service charge / a named "other" fee) carves that fee out of the
 *   renewal invoice's fee_breakdown at creation — which already reduces the
 *   invoice total. The OLD markInstallmentPaid then ALSO wrote a +amount
 *   OB_PAYMENT wallet credit per installment, which refreshInvoiceTotals
 *   subtracts from the (already reduced) invoice total a SECOND time. Net: the
 *   tenant obligation was reduced ~2x per installment, leaving an un-backed
 *   wallet credit that silently discounted future/other charges.
 *
 *   The Outstanding-Balance synthetic charge (charge_external_id ===
 *   'outstanding_balance') is NOT affected — it settles real wallet debt and
 *   legitimately credits the wallet. Tenancy-scope plans are also legitimate.
 *
 * WHAT THIS DOES:
 *   1. Finds every OB_PAYMENT ledger row written by a payment-plan installment
 *      (related_entity_type = 'payment_plan_installment').
 *   2. Classifies the owning plan: invoice-fee charge plan = phantom (reverse);
 *      Outstanding-Balance / tenancy = legitimate (keep).
 *   3. For each phantom credit not already reversed, writes a compensating
 *      OB_CHARGE (negative balance_change) tagged metadata.phantom_credit_reversal
 *      so the breakdown net-pass (Phase 2) can hide the pair and re-runs are no-ops.
 *   4. After each affected (tenant, landlord) pair, re-derives invoice totals.
 *
 * IDEMPOTENT. DRY-RUN by default. Pass --apply to write.
 *
 * Usage:
 *   ts-node -r tsconfig-paths/register scripts/repair-phantom-charge-plan-credits.ts          # dry run
 *   ts-node -r tsconfig-paths/register scripts/repair-phantom-charge-plan-credits.ts --apply  # write
 */

const BATCH_ID = 'p1-phantom-repair';

interface PhantomRow {
  ledgerId: string;
  tenantId: string;
  landlordId: string;
  propertyId: string | null;
  amount: number; // the original positive credit (balance_change)
  installmentId: string;
  planId: string;
  chargeName: string;
}

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(
    `\n=== Repair phantom charge-plan credits — ${apply ? 'APPLY (writing)' : 'DRY RUN (no writes)'} ===\n`,
  );

  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const dataSource = app.get(DataSource);
    const balances = app.get(TenantBalancesService);
    const tenancies = app.get(TenanciesService);

    const ledgerRepo = dataSource.getRepository(TenantBalanceLedger);
    const installmentRepo = dataSource.getRepository(PaymentPlanInstallment);

    // 1. All installment-sourced wallet credits.
    const credits = await ledgerRepo.find({
      where: {
        type: TenantBalanceLedgerType.OB_PAYMENT,
        related_entity_type: 'payment_plan_installment',
      },
      order: { created_at: 'ASC' },
    });
    console.log(`Found ${credits.length} installment OB_PAYMENT ledger rows.`);

    // 2. Resolve the owning plan for each and classify.
    const phantoms: PhantomRow[] = [];
    let legitimate = 0;
    let orphaned = 0;
    for (const row of credits) {
      const installmentId = row.related_entity_id;
      if (!installmentId) {
        orphaned++;
        continue;
      }
      const installment = await installmentRepo.findOne({
        where: { id: installmentId },
        relations: ['plan'],
      });
      const plan = installment?.plan;
      if (!plan) {
        orphaned++;
        continue;
      }

      // Same predicate as PaymentPlansService.isInvoiceFeeChargePlan.
      const isInvoiceFeeCharge =
        plan.scope === PaymentPlanScope.CHARGE &&
        plan.charge_external_id !== 'outstanding_balance';

      if (!isInvoiceFeeCharge) {
        legitimate++;
        continue;
      }

      phantoms.push({
        ledgerId: row.id,
        tenantId: row.tenant_id,
        landlordId: row.landlord_id,
        propertyId: row.property_id ?? plan.property_id ?? null,
        amount: Number(row.balance_change),
        installmentId,
        planId: plan.id,
        chargeName: plan.charge_name,
      });
    }

    // 3. Drop those already reversed by a prior run.
    const existingReversals = await ledgerRepo.find({
      where: {
        type: TenantBalanceLedgerType.OB_CHARGE,
        related_entity_type: 'payment_plan_installment',
      },
    });
    const reversedLedgerIds = new Set<string>(
      existingReversals
        .filter((r) => (r.metadata as any)?.phantom_credit_reversal === true)
        .map((r) => (r.metadata as any)?.original_ledger_id)
        .filter(Boolean),
    );
    const toReverse = phantoms.filter((p) => !reversedLedgerIds.has(p.ledgerId));

    const totalNaira = toReverse.reduce((s, p) => s + p.amount, 0);
    const affectedPairs = new Map<string, { tenantId: string; landlordId: string }>();
    toReverse.forEach((p) =>
      affectedPairs.set(`${p.tenantId}:${p.landlordId}`, {
        tenantId: p.tenantId,
        landlordId: p.landlordId,
      }),
    );

    console.log(
      `\nClassification: ${phantoms.length} phantom, ${legitimate} legitimate (OB/tenancy), ${orphaned} orphaned (no plan).`,
    );
    console.log(
      `Already reversed by a prior run: ${phantoms.length - toReverse.length}.`,
    );
    console.log(
      `\nTo reverse: ${toReverse.length} credits totalling ₦${totalNaira.toLocaleString()} across ${affectedPairs.size} tenant-landlord pair(s).`,
    );
    for (const p of toReverse) {
      console.log(
        `  • plan ${p.planId} "${p.chargeName}" inst ${p.installmentId} — ₦${p.amount.toLocaleString()} (ledger ${p.ledgerId})`,
      );
    }

    if (!apply) {
      console.log('\nDRY RUN — no writes. Re-run with --apply to compensate.\n');
      return;
    }

    // 4. Write compensating OB_CHARGE per phantom credit.
    for (const p of toReverse) {
      await balances.applyChange(
        p.tenantId,
        p.landlordId,
        -p.amount, // reverse the credit
        {
          type: TenantBalanceLedgerType.OB_CHARGE,
          description: `Phantom payment-plan credit reversed — "${p.chargeName}" (₦${p.amount.toLocaleString()})`,
          propertyId: p.propertyId ?? undefined,
          relatedEntityType: 'payment_plan_installment',
          relatedEntityId: p.installmentId,
          metadata: {
            phantom_credit_reversal: true,
            reversal: true,
            original_ledger_id: p.ledgerId,
            payment_plan_id: p.planId,
            installment_id: p.installmentId,
            batch_id: BATCH_ID,
          },
        },
      );
    }

    // 5. Re-derive invoice totals for each affected pair.
    for (const { tenantId, landlordId } of affectedPairs.values()) {
      try {
        await tenancies.refreshInvoiceTotals(tenantId, landlordId);
      } catch (e) {
        console.warn(
          `  ! refreshInvoiceTotals failed for ${tenantId}/${landlordId}: ${(e as Error).message}`,
        );
      }
    }

    console.log(
      `\n✅ Applied ${toReverse.length} reversals (₦${totalNaira.toLocaleString()}); refreshed ${affectedPairs.size} pair(s).\n`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('Repair script failed:', err);
  process.exit(1);
});
