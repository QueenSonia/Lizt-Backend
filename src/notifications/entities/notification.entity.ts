// entities/notification.entity.ts
import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';
import { NotificationType } from '../enums/notification-type';

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
}
