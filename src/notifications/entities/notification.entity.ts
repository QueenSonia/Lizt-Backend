// entities/notification.entity.ts
import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from 'typeorm';
import { NotificationType } from '../enums/notification-type';
import { Account } from 'src/users/entities/account.entity';
import { Property } from 'src/properties/entities/property.entity';

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

  @Column({type: 'uuid', nullable: false})
  property_id: string; // <-- snake_case and UUID

  @Column({type: 'uuid', nullable: false})
  user_id:string 
  
  @ManyToOne(() =>Property, (property) => property.notification)
    @JoinColumn({ name: 'property_id', referencedColumnName: 'id' })
  property: Property;

  @ManyToOne(() =>Account, (user) => user.notification)
  @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
  user: Account; // <-- snake_case and UUID
}
