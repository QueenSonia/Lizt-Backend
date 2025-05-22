// entities/notification.entity.ts
import { Entity, Column, PrimaryGeneratedColumn, ManyToOne } from 'typeorm';
import { NotificationType } from '../enums/notification-type';
import { Account } from 'src/users/entities/account.entity';

@Entity()
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  date: string;

  @Column({ type: 'enum', enum: NotificationType })
  type: NotificationType;

  @Column()
  description: string;

  @Column({ default: 'Pending' })
  status: 'Pending' | 'Completed';

  @Column()
  property_id: string; // <-- snake_case and UUID

  @Column()
  user_id:string

  @ManyToOne(() =>Account, (user) => user.notification, { onDelete: 'CASCADE' })
  user: Account; // <-- snake_case and UUID
}
