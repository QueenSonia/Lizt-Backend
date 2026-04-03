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

  async getBalances(
    tenantId: string,
    landlordId: string,
  ): Promise<{ outstanding_balance: number; credit_balance: number }> {
    const record = await this.balanceRepo.findOne({
      where: { tenant_id: tenantId, landlord_id: landlordId },
    });
    return {
      outstanding_balance: record
        ? parseFloat(record.outstanding_balance as unknown as string)
        : 0,
      credit_balance: record
        ? parseFloat(record.credit_balance as unknown as string)
        : 0,
    };
  }

  async getOutstandingBalance(
    tenantId: string,
    landlordId: string,
  ): Promise<number> {
    return (await this.getBalances(tenantId, landlordId)).outstanding_balance;
  }

  async getCreditBalance(
    tenantId: string,
    landlordId: string,
  ): Promise<number> {
    return (await this.getBalances(tenantId, landlordId)).credit_balance;
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
  // Mutation helpers — each atomically updates TenantBalance + writes ledger
  // ---------------------------------------------------------------------------

  async addOutstandingBalance(
    tenantId: string,
    landlordId: string,
    amount: number,
    ctx: LedgerContext,
    notes?: string,
  ): Promise<TenantBalance> {
    return this.dataSource.transaction(async (manager) => {
      let record = await manager.findOne(TenantBalance, {
        where: { tenant_id: tenantId, landlord_id: landlordId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!record) {
        record = manager.create(TenantBalance, {
          tenant_id: tenantId,
          landlord_id: landlordId,
          outstanding_balance: 0,
          credit_balance: 0,
          notes: notes ?? null,
        });
      }
      const before = parseFloat(record.outstanding_balance as unknown as string);
      record.outstanding_balance = before + amount;
      await manager.save(record);
      await manager.save(
        manager.create(TenantBalanceLedger, {
          tenant_id: tenantId,
          landlord_id: landlordId,
          property_id: ctx.propertyId ?? null,
          type: ctx.type,
          description: ctx.description,
          outstanding_balance_change: amount,
          credit_balance_change: 0,
          outstanding_balance_after: record.outstanding_balance,
          credit_balance_after: parseFloat(record.credit_balance as unknown as string),
          related_entity_type: ctx.relatedEntityType ?? null,
          related_entity_id: ctx.relatedEntityId ?? null,
        }),
      );
      return record;
    });
  }

  async subtractOutstandingBalance(
    tenantId: string,
    landlordId: string,
    amount: number,
    ctx: LedgerContext,
  ): Promise<TenantBalance> {
    return this.dataSource.transaction(async (manager) => {
      let record = await manager.findOne(TenantBalance, {
        where: { tenant_id: tenantId, landlord_id: landlordId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!record) {
        record = manager.create(TenantBalance, {
          tenant_id: tenantId,
          landlord_id: landlordId,
          outstanding_balance: 0,
          credit_balance: 0,
          notes: null,
        });
      }
      const before = parseFloat(record.outstanding_balance as unknown as string);
      const change = Math.min(amount, before); // can't go negative
      record.outstanding_balance = before - change;
      await manager.save(record);
      await manager.save(
        manager.create(TenantBalanceLedger, {
          tenant_id: tenantId,
          landlord_id: landlordId,
          property_id: ctx.propertyId ?? null,
          type: ctx.type,
          description: ctx.description,
          outstanding_balance_change: -change,
          credit_balance_change: 0,
          outstanding_balance_after: record.outstanding_balance,
          credit_balance_after: parseFloat(record.credit_balance as unknown as string),
          related_entity_type: ctx.relatedEntityType ?? null,
          related_entity_id: ctx.relatedEntityId ?? null,
        }),
      );
      return record;
    });
  }

  async clearOutstandingBalance(
    tenantId: string,
    landlordId: string,
    ctx: LedgerContext,
  ): Promise<TenantBalance> {
    return this.dataSource.transaction(async (manager) => {
      let record = await manager.findOne(TenantBalance, {
        where: { tenant_id: tenantId, landlord_id: landlordId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!record) {
        record = manager.create(TenantBalance, {
          tenant_id: tenantId,
          landlord_id: landlordId,
          outstanding_balance: 0,
          credit_balance: 0,
          notes: null,
        });
      }
      const before = parseFloat(record.outstanding_balance as unknown as string);
      if (before === 0) return record; // nothing to clear
      record.outstanding_balance = 0;
      await manager.save(record);
      await manager.save(
        manager.create(TenantBalanceLedger, {
          tenant_id: tenantId,
          landlord_id: landlordId,
          property_id: ctx.propertyId ?? null,
          type: ctx.type,
          description: ctx.description,
          outstanding_balance_change: -before,
          credit_balance_change: 0,
          outstanding_balance_after: 0,
          credit_balance_after: parseFloat(record.credit_balance as unknown as string),
          related_entity_type: ctx.relatedEntityType ?? null,
          related_entity_id: ctx.relatedEntityId ?? null,
        }),
      );
      return record;
    });
  }

  async addCreditBalance(
    tenantId: string,
    landlordId: string,
    amount: number,
    ctx: LedgerContext,
  ): Promise<TenantBalance> {
    if (amount <= 0) return this.getOrCreate(tenantId, landlordId);
    return this.dataSource.transaction(async (manager) => {
      let record = await manager.findOne(TenantBalance, {
        where: { tenant_id: tenantId, landlord_id: landlordId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!record) {
        record = manager.create(TenantBalance, {
          tenant_id: tenantId,
          landlord_id: landlordId,
          outstanding_balance: 0,
          credit_balance: 0,
          notes: null,
        });
      }
      const before = parseFloat(record.credit_balance as unknown as string);
      record.credit_balance = before + amount;
      await manager.save(record);
      await manager.save(
        manager.create(TenantBalanceLedger, {
          tenant_id: tenantId,
          landlord_id: landlordId,
          property_id: ctx.propertyId ?? null,
          type: ctx.type,
          description: ctx.description,
          outstanding_balance_change: 0,
          credit_balance_change: amount,
          outstanding_balance_after: parseFloat(record.outstanding_balance as unknown as string),
          credit_balance_after: record.credit_balance,
          related_entity_type: ctx.relatedEntityType ?? null,
          related_entity_id: ctx.relatedEntityId ?? null,
        }),
      );
      return record;
    });
  }

  async subtractCreditBalance(
    tenantId: string,
    landlordId: string,
    amount: number,
    ctx: LedgerContext,
  ): Promise<TenantBalance> {
    return this.dataSource.transaction(async (manager) => {
      let record = await manager.findOne(TenantBalance, {
        where: { tenant_id: tenantId, landlord_id: landlordId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!record) {
        record = manager.create(TenantBalance, {
          tenant_id: tenantId,
          landlord_id: landlordId,
          outstanding_balance: 0,
          credit_balance: 0,
          notes: null,
        });
      }
      const before = parseFloat(record.credit_balance as unknown as string);
      const change = Math.min(amount, before);
      record.credit_balance = before - change;
      await manager.save(record);
      await manager.save(
        manager.create(TenantBalanceLedger, {
          tenant_id: tenantId,
          landlord_id: landlordId,
          property_id: ctx.propertyId ?? null,
          type: ctx.type,
          description: ctx.description,
          outstanding_balance_change: 0,
          credit_balance_change: -change,
          outstanding_balance_after: parseFloat(record.outstanding_balance as unknown as string),
          credit_balance_after: record.credit_balance,
          related_entity_type: ctx.relatedEntityType ?? null,
          related_entity_id: ctx.relatedEntityId ?? null,
        }),
      );
      return record;
    });
  }

  async clearCreditBalance(
    tenantId: string,
    landlordId: string,
    ctx: LedgerContext,
  ): Promise<TenantBalance> {
    return this.dataSource.transaction(async (manager) => {
      let record = await manager.findOne(TenantBalance, {
        where: { tenant_id: tenantId, landlord_id: landlordId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!record) {
        record = manager.create(TenantBalance, {
          tenant_id: tenantId,
          landlord_id: landlordId,
          outstanding_balance: 0,
          credit_balance: 0,
          notes: null,
        });
      }
      const before = parseFloat(record.credit_balance as unknown as string);
      if (before === 0) return record;
      record.credit_balance = 0;
      await manager.save(record);
      await manager.save(
        manager.create(TenantBalanceLedger, {
          tenant_id: tenantId,
          landlord_id: landlordId,
          property_id: ctx.propertyId ?? null,
          type: ctx.type,
          description: ctx.description,
          outstanding_balance_change: 0,
          credit_balance_change: -before,
          outstanding_balance_after: parseFloat(record.outstanding_balance as unknown as string),
          credit_balance_after: 0,
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
  ): Promise<TenantBalance> {
    const existing = await this.balanceRepo.findOne({
      where: { tenant_id: tenantId, landlord_id: landlordId },
    });
    if (existing) return existing;
    return this.balanceRepo.save(
      this.balanceRepo.create({
        tenant_id: tenantId,
        landlord_id: landlordId,
        outstanding_balance: 0,
        credit_balance: 0,
        notes: null,
      }),
    );
  }
}
