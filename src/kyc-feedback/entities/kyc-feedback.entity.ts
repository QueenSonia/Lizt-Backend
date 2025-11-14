import {
  Entity,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { BaseEntity } from 'src/base.entity';
import { Users } from 'src/users/entities/user.entity';

@Entity('kyc_feedback')
export class KycFeedback extends BaseEntity {
  @Column({ type: 'int' })
  rating: number; // 1-5 stars

  @Column({ type: 'text', nullable: true })
  comment: string;

  @Column({ type: 'varchar', nullable: true })
  tenant_email: string;

  @Column({ type: 'varchar', nullable: true })
  tenant_name: string;

  @Column({ type: 'uuid', nullable: true })
  landlord_id: string;

  @ManyToOne(() => Users, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'landlord_id' })
  landlord?: Users;

  @Column({ type: 'varchar', nullable: true })
  property_name: string;

  @CreateDateColumn()
  submitted_at: Date;

  toJSON() {
    const feedback = this as any;
    delete feedback.landlord;
    return feedback;
  }
}
