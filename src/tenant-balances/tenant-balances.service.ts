import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
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
}

@Injectable()
export class TenantBalancesService {
  constructor(
    @InjectRepository(TenantBalance)
    private readonly balanceRepo: Repository<TenantBalance>,
    @InjectRepository(TenantBalanceLedger)
    private readonly ledgerRepo: Repository<TenantBalanceLedger>,
    private readonly dataSource: DataSource,
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
  ): Promise<TenantBalance> {
    if (amount === 0) {
      return this.getOrCreate(tenantId, landlordId, notes);
    }

    return this.dataSource.transaction(async (manager) => {
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
        }),
      );

      return record;
    });
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
