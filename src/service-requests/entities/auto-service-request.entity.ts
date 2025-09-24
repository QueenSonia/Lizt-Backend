import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum ServiceRequestStatus {
  OPEN = 'open',
  IN_PROGRESS = 'in_progress',
  PENDING = 'pending',
  RESOLVED = 'resolved',
  CLOSED = 'closed',
  CANCELLED = 'cancelled',
}

export enum ServiceRequestPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent',
}

export enum ServiceRequestSource {
  TAWK_CHAT = 'tawk_chat',
  EMAIL = 'email',
  PHONE = 'phone',
  PORTAL = 'portal',
  MANUAL = 'manual',
}

export interface TawkMetadata {
  tawkChatId: string;
  tawkEvent: 'chat:start' | 'chat:end';
  tawkPropertyName: string;
  initialMessage?: string;
  chatDuration?: number; // in seconds
  agentAssigned?: string;
  visitorInfo: {
    city: string;
    country: string;
    userAgent?: string;
    ipAddress?: string;
  };
  chatHistory?: Array<{
    timestamp: string;
    sender: 'visitor' | 'agent';
    message: string;
  }>;
}

@Entity('auto_service_requests')
@Index(['propertyTenant', 'status'])
@Index(['source', 'createdAt'])
@Index(['externalId', 'source'], { unique: true })
export class AutoServiceRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 255 })
  title: string;

  @Column('text')
  description: string;

  @Column({
    type: 'enum',
    enum: ServiceRequestStatus,
    default: ServiceRequestStatus.OPEN,
  })
  status: ServiceRequestStatus;

  @Column({
    type: 'enum',
    enum: ServiceRequestPriority,
    default: ServiceRequestPriority.MEDIUM,
  })
  priority: ServiceRequestPriority;

  @Column({
    type: 'enum',
    enum: ServiceRequestSource,
  })
  source: ServiceRequestSource;

  @Column({ name: 'external_id', nullable: true, length: 255 })
  externalId: string; // Tawk chat ID or other external reference

  // Customer Information
  @Column({ name: 'customer_name', length: 255 })
  customerName: string;

  @Column({ name: 'customer_email', length: 255 })
  customerEmail: string;

  @Column({ name: 'customer_phone', nullable: true, length: 50 })
  customerPhone?: string;

  @Column({ name: 'customer_location', nullable: true, length: 255 })
  customerLocation?: string;

  // Assignment
  @Column({ name: 'assigned_to', nullable: true, length: 255 })
  assignedTo?: string; // User ID or agent name

  @Column({ name: 'assigned_at', nullable: true, type: 'timestamp' })
  assignedAt?: Date;

  // Resolution
  @Column({ name: 'resolved_at', nullable: true, type: 'timestamp' })
  resolvedAt?: Date;

  @Column({ name: 'resolution_notes', nullable: true, type: 'text' })
  resolutionNotes?: string;

  // Metadata - stores Tawk-specific data as JSON
  @Column({ type: 'jsonb', nullable: true })
  metadata?: TawkMetadata | Record<string, any>;

  // Internal notes for staff
  @Column({ name: 'internal_notes', nullable: true, type: 'text' })
  internalNotes?: string;

  // Tags for categorization
  @Column({ type: 'simple-array', nullable: true })
  tags?: string[];

  // Due date for resolution
  @Column({ name: 'due_date', nullable: true, type: 'timestamp' })
  dueDate?: Date;

  // Relations
  @ManyToOne(() => PropertyTenant, { eager: true })
  @JoinColumn({ name: 'property_tenant_id' })
  propertyTenant: PropertyTenant;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // Calculated fields
  get isOverdue() {
    return (
      this.dueDate &&
      this.dueDate < new Date() &&
      this.status !== ServiceRequestStatus.CLOSED
    );
  }

  get ageInDays(): number {
    const now = new Date();
    const created = new Date(this.createdAt);
    return Math.floor(
      (now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24),
    );
  }

  // Helper methods
  markAsResolved(resolutionNotes?: string): void {
    this.status = ServiceRequestStatus.RESOLVED;
    this.resolvedAt = new Date();
    if (resolutionNotes) {
      this.resolutionNotes = resolutionNotes;
    }
  }

  assignTo(assignee: string): void {
    this.assignedTo = assignee;
    this.assignedAt = new Date();
    if (this.status === ServiceRequestStatus.OPEN) {
      this.status = ServiceRequestStatus.IN_PROGRESS;
    }
  }

  addTag(tag: string): void {
    if (!this.tags) {
      this.tags = [];
    }
    if (!this.tags.includes(tag)) {
      this.tags.push(tag);
    }
  }

  removeTag(tag: string): void {
    if (this.tags) {
      this.tags = this.tags.filter((t) => t !== tag);
    }
  }

  updateTawkMetadata(updates: Partial<TawkMetadata>): void {
    if (this.source === ServiceRequestSource.TAWK_CHAT) {
      this.metadata = {
        ...((this.metadata as TawkMetadata) || {}),
        ...updates,
      };
    }
  }
}
