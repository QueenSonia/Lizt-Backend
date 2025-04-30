import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../base.entity';
import { Property } from '../../properties/entities/property.entity';

@Entity({ name: 'rent_increases' })
export class RentIncrease extends BaseEntity {
  @Column({ nullable: false, type: 'uuid' })
  property_id: string;

  @Column({ type: 'int', nullable: false })
  initial_rent: number;

  @Column({ type: 'int', nullable: false })
  current_rent: number;

  @Column({ nullable: false, type: 'timestamp' })
  rent_increase_date: Date;

  @Column({ nullable: true, type: 'text' })
  reason?: string | null;

  @ManyToOne(() => Property, (p) => p.rent_increases)
  @JoinColumn({ name: 'property_id', referencedColumnName: 'id' })
  property: Property;
}
