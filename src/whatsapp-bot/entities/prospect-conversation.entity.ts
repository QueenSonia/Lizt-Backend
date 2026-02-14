import {
    Entity,
    Column,
    OneToMany,
    ManyToOne,
    JoinColumn,
    Index,
} from 'typeorm';
import { BaseEntity } from '../../base.entity';
import { ProspectMessage } from './prospect-message.entity';
import { Users } from '../../users/entities/user.entity';

export enum ProspectConversationStatus {
    AI_HANDLED = 'ai_handled',
    AGENT_HANDLED = 'agent_handled',
    CLOSED = 'closed',
}

export enum ProspectChannel {
    WHATSAPP = 'whatsapp',
    WEB = 'web',
}

export interface ProspectPreferences {
    budget_min?: number;
    budget_max?: number;
    preferred_locations?: string[];
    bedrooms?: number;
    move_in_date?: string;
    property_type?: string;
    other_notes?: string;
}

export interface ProspectSchedule {
    requested_dates?: string[];
    confirmed_date?: string;
    notes?: string;
}

@Entity('prospect_conversations')
@Index(['phone_number'])
@Index(['status'])
@Index(['channel'])
@Index(['web_session_id'])
export class ProspectConversation extends BaseEntity {
    @Column({ type: 'varchar', nullable: true })
    phone_number: string;

    @Column({ type: 'varchar', nullable: true })
    prospect_name: string;

    @Column({
        type: 'enum',
        enum: ProspectChannel,
        default: ProspectChannel.WHATSAPP,
    })
    channel: ProspectChannel;

    @Column({
        type: 'enum',
        enum: ProspectConversationStatus,
        default: ProspectConversationStatus.AI_HANDLED,
    })
    status: ProspectConversationStatus;

    @Column({ type: 'text', nullable: true })
    summary: string;

    @Column({ type: 'varchar', nullable: true })
    intent: string;

    @Column({ type: 'jsonb', nullable: true })
    preferences: ProspectPreferences;

    @Column({ type: 'uuid', array: true, nullable: true })
    interested_property_ids: string[];

    @Column({ type: 'jsonb', nullable: true })
    schedule: ProspectSchedule;

    @Column({ type: 'uuid', nullable: true })
    assigned_agent_id: string | null;

    @Column({ type: 'timestamp', nullable: true })
    last_message_at: Date;

    @Column({ type: 'varchar', nullable: true })
    web_session_id: string;

    @OneToMany(() => ProspectMessage, (msg) => msg.conversation, {
        cascade: true,
    })
    messages: ProspectMessage[];

    @ManyToOne(() => Users, { nullable: true })
    @JoinColumn({ name: 'assigned_agent_id' })
    assigned_agent: Users;
}
