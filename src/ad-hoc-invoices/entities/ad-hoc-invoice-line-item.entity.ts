import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../base.entity';
import { AdHocInvoice } from './ad-hoc-invoice.entity';

@Entity({ name: 'ad_hoc_invoice_line_items' })
@Index(['invoice_id'])
export class AdHocInvoiceLineItem extends BaseEntity {
  @Column({ type: 'uuid' })
  invoice_id: string;

  @ManyToOne(() => AdHocInvoice, (inv) => inv.line_items, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'invoice_id' })
  invoice: AdHocInvoice;

  @Column({ type: 'varchar', length: 255 })
  description: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: number;

  /** 1-based position within the invoice. */
  @Column({ type: 'int' })
  sequence: number;
}
