import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { TenantBalance } from './entities/tenant-balance.entity';
import {
  TenantBalanceLedger,
  TenantBalanceLedgerType,
} from './entities/tenant-balance-ledger.entity';

export interface LedgerContext {
  type: TenantBalanceLedgerType;
  description: string;
  propertyId?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  /**
   * Free-form tags persisted to `tenant_balance_ledger.metadata`.
   * Billing v2 writes set `{ batch_id: 'billing-v2', breakdown?: Fee[] }`
   * so reversal SQL can target the batch and the breakdown modal can
   * render per-fee subtotals for bundled charges.
   */
  metadata?: Record<string, unknown>;
}

@Injectable()
export class TenantBalancesService {
  constructor(
    @InjectRepository(TenantBalance)
    private readonly balanceRepo: Repository<TenantBalance>,
    @InjectRepository(TenantBalanceLedger)
    private readonly ledgerRepo: Repository<TenantBalanceLedger>,
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ---------------------------------------------------------------------------
  // Read helpers
  // ---------------------------------------------------------------------------

  /**
   * Returns the signed wallet balance for a tenant-landlord pair.
   * positive = tenant has credit; negative = tenant owes (outstanding).
   */
  async getBalance(tenantId: string, landlordId: string): Promise<number> {
    const record = await this.balanceRepo.findOne({
      where: { tenant_id: tenantId, landlord_id: landlordId },
    });
    return record ? parseFloat(record.balance as unknown as string) : 0;
  }

  /**
   * Σ of the un-collected remainder of every ACTIVE wallet-backed payment plan
   * (source_type 'outstanding_balance' / 'ad_hoc_invoice') the tenant holds
   * under this landlord — i.e. wallet debt those plans, not a renewal invoice,
   * will collect. Renewal-invoice fold sites subtract this (via
   * computeRenewalFold) so the same debt is never billed twice.
   *
   * Lives here because every fold site already injects TenantBalancesService
   * for getBalance, and it owns wallet-derived reads. Raw SQL (no PaymentPlan
   * entity import) avoids a module circular dep; guarded so a failure falls back
   * to "no adjustment" rather than breaking the (frequent) fold callers.
   * Mirrors PaymentPlansService.computePlannableOb's `claimed` term.
   */
  async sumActiveWalletBackedPlanClaims(
    tenantId: string,
    landlordId: string,
  ): Promise<number> {
    try {
      // Paid-to-date rule (SQL mirror of installmentPaidToDate in
      // common/billing/installment-paid.util): PAID rows count their
      // amount_paid (face fallback for legacy rows), PARTIAL rows count
      // amount_paid — a landlord-recorded partial reduces the claim just like
      // a full installment payment does.
      const rows: { claimed: string }[] = await this.dataSource.query(
        `SELECT COALESCE(SUM(GREATEST(0, pp.total_amount - COALESCE(paid.sum_paid, 0))), 0) AS claimed
           FROM payment_plans pp
           JOIN properties p ON p.id = pp.property_id
           LEFT JOIN (
             SELECT plan_id,
                    SUM(CASE WHEN status = 'paid'
                             THEN COALESCE(amount_paid, amount)
                             ELSE COALESCE(amount_paid, 0) END) AS sum_paid
               FROM payment_plan_installments
              WHERE status IN ('paid', 'partial')
              GROUP BY plan_id
           ) paid ON paid.plan_id = pp.id
          WHERE pp.tenant_id = $1
            AND p.owner_id = $2
            AND pp.status = 'active'
            AND pp.source_type IN ('outstanding_balance', 'ad_hoc_invoice')`,
        [tenantId, landlordId],
      );
      return Number(rows?.[0]?.claimed ?? 0);
    } catch {
      return 0;
    }
  }

  async getLedger(
    tenantId: string,
    landlordId: string,
  ): Promise<TenantBalanceLedger[]> {
    return this.ledgerRepo.find({
      where: { tenant_id: tenantId, landlord_id: landlordId },
      order: { created_at: 'DESC' },
      relations: ['property'],
    });
  }

  // ---------------------------------------------------------------------------
  // Mutation — atomically updates TenantBalance and writes a ledger entry
  // ---------------------------------------------------------------------------

  /**
   * Apply a signed change to the wallet balance and record it in the ledger.
   *
   * @param amount  positive = balance increases (payment / credit in)
   *                negative = balance decreases (charge / debt added)
   */
  async applyChange(
    tenantId: string,
    landlordId: string,
    amount: number,
    ctx: LedgerContext,
    notes?: string,
    externalManager?: EntityManager,
  ): Promise<TenantBalance> {
    if (amount === 0) {
      return this.getOrCreate(tenantId, landlordId, notes);
    }

    const run = async (manager: EntityManager): Promise<TenantBalance> => {
      let record = await manager.findOne(TenantBalance, {
        where: { tenant_id: tenantId, landlord_id: landlordId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!record) {
        record = manager.create(TenantBalance, {
          tenant_id: tenantId,
          landlord_id: landlordId,
          balance: 0,
          notes: notes ?? null,
        });
      }

      const before = parseFloat(record.balance as unknown as string);
      record.balance = before + amount;
      await manager.save(record);

      await manager.save(
        manager.create(TenantBalanceLedger, {
          tenant_id: tenantId,
          landlord_id: landlordId,
          property_id: ctx.propertyId ?? null,
          type: ctx.type,
          description: ctx.description,
          balance_change: amount,
          balance_after: record.balance,
          related_entity_type: ctx.relatedEntityType ?? null,
          related_entity_id: ctx.relatedEntityId ?? null,
          metadata: ctx.metadata ?? null,
        }),
      );

      return record;
    };

    const record = externalManager
      ? await run(externalManager)
      : await this.dataSource.transaction(run);

    // Notify consumers that cache derived totals (renewal invoices, etc.)
    // that the wallet changed for this pair.
    this.eventEmitter.emit('tenant.balance.changed', {
      tenantId,
      landlordId,
    });

    return record;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async getOrCreate(
    tenantId: string,
    landlordId: string,
    notes?: string,
  ): Promise<TenantBalance> {
    const existing = await this.balanceRepo.findOne({
      where: { tenant_id: tenantId, landlord_id: landlordId },
    });
    if (existing) return existing;
    return this.balanceRepo.save(
      this.balanceRepo.create({
        tenant_id: tenantId,
        landlord_id: landlordId,
        balance: 0,
        notes: notes ?? null,
      }),
    );
  }
}
