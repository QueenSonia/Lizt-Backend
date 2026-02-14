import {
    Entity,
    Column,
    ManyToOne,
    JoinColumn,
    Index,
} from 'typeorm';
import { BaseEntity } from '../../base.entity';
import { ProspectConversation } from './prospect-conversation.entity';

export enum MessageDirection {
    INBOUND = 'inbound',
    OUTBOUND = 'outbound',
}

export enum ProspectMessageSenderType {
    PROSPECT = 'prospect',
    AI = 'ai',
    AGENT = 'agent',
}

@Entity('prospect_messages')
@Index(['conversation_id'])
export class ProspectMessage extends BaseEntity {
    @Column({ type: 'uuid' })
    conversation_id: string;

    @Column({
        type: 'enum',
        enum: MessageDirection,
    })
    direction: MessageDirection;

    @Column({
        type: 'enum',
        enum: ProspectMessageSenderType,
    })
    sender_type: ProspectMessageSenderType;

    @Column({ type: 'text' })
    content: string;

    @Column({ type: 'jsonb', nullable: true })
    metadata: Record<string, any>;

    @ManyToOne(() => ProspectConversation, (conv) => conv.messages, {
        onDelete: 'CASCADE',
    })
    @JoinColumn({ name: 'conversation_id' })
    conversation: ProspectConversation;
}
