import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PropertyHistory } from '../property-history/entities/property-history.entity';
import { EventsGateway } from './events.gateway';

export interface ServiceCreatedEvent {
  user_id: string; // Tenant account ID
  property_id: string; // Property ID
  landlord_id?: string; // Landlord/Owner ID
  tenant_name: string; // Tenant display name
  property_name: string; // Property name
  maintenance_request_id?: string; // Maintenance request ID
  description?: string; // Issue description
  created_at?: Date; // Timestamp
}

export interface TenancyRenewedEvent {
  property_id: string;
  property_name: string;
  tenant_id: string;
  tenant_name: string;
  user_id: string; // landlord/owner id
  rent_amount: number;
  payment_frequency: string;
  start_date: string;
  end_date: string;
}

@Injectable()
export class HistoryEventListener {
  private readonly logger = new Logger(HistoryEventListener.name);
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 1000; // 1 second

  constructor(
    @InjectRepository(PropertyHistory)
    private readonly propertyHistoryRepository: Repository<PropertyHistory>,
    @Inject(forwardRef(() => EventsGateway))
    private readonly eventsGateway: EventsGateway,
  ) {}

  @OnEvent('maintenance.created')
  async handleMaintenanceRequestCreated(
    payload: ServiceCreatedEvent,
  ): Promise<void> {
    this.logger.log(
      `Received service.created event for tenant ${payload.user_id} and property ${payload.property_id}`,
    );

    await this.createHistoryEntryWithRetry(payload);
  }

  // Tenant-gated creations (FM- or landlord-filed pending tenant confirmation)
  // emit a dedicated event INSTEAD of `maintenance.created` so the
  // notifications listener can build a different in-app message ("waiting on
  // confirmation"). The property_history row should still land, so we mirror
  // the create handler here. Same payload shape — same retry path.
  @OnEvent('maintenance.fm_filed_pending_tenant')
  @OnEvent('maintenance.landlord_filed_pending_tenant')
  async handleMaintenanceRequestCreatedPendingTenant(
    payload: ServiceCreatedEvent,
  ): Promise<void> {
    this.logger.log(
      `Received tenant-gated maintenance create event for tenant ${payload.user_id} and property ${payload.property_id}`,
    );
    await this.createHistoryEntryWithRetry(payload);
  }

  @OnEvent('maintenance.updated')
  async handleMaintenanceRequestUpdated(payload: any): Promise<void> {
    this.logger.log(
      `Received service.updated event for request ${payload.request_id}`,
    );

    try {
      // Fix #19: Store status and description as JSON instead of fragile delimiter
      const historyEntry = this.propertyHistoryRepository.create({
        property_id: payload.property_id,
        tenant_id: payload.tenant_id,
        event_type: 'maintenance_request_updated',
        event_description: JSON.stringify({
          status: payload.status,
          description: payload.description,
          previous_status: payload.previous_status,
        }),
        related_entity_id: payload.request_id,
        related_entity_type: 'maintenance_request',
        created_at: payload.updated_at || new Date(),
      });

      await this.propertyHistoryRepository.save(historyEntry);

      // Fix #6: Emit the correct WebSocket event for updates
      if (this.eventsGateway) {
        this.eventsGateway.emitMaintenanceRequestUpdated(
          payload.property_id,
          payload.landlord_id,
          {
            maintenanceRequestId: payload.request_id,
            description: payload.description,
            tenantName: payload.tenant_name,
            propertyName: payload.property_name,
            status: payload.status,
            previousStatus: payload.previous_status,
          },
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to create history entry for update: ${error.message}`,
        error.stack,
      );
    }
  }

  @OnEvent('maintenance.assigned')
  async handleMaintenanceRequestAssigned(payload: any): Promise<void> {
    // Push to open clients so the assignee column on every list/card and
    // the assignee dropdown in the detail modal refresh live. We do this
    // even for common-area requests (which don't get a property_history
    // entry) by emitting before the early-return below.
    if (this.eventsGateway && payload?.maintenance_request_id) {
      this.eventsGateway.emitMaintenanceRequestUpdated(
        payload.property_id ?? '',
        payload.landlord_id,
        {
          maintenanceRequestId: payload.maintenance_request_id,
          description: payload.description,
          tenantName: payload.tenant_name,
          propertyName: payload.property_name,
        },
      );
    }

    if (!payload?.property_id) {
      // Common-area requests don't have a property_id — they live on a
      // separate timeline and are skipped here.
      return;
    }

    try {
      const historyEntry = this.propertyHistoryRepository.create({
        property_id: payload.property_id,
        tenant_id: payload.tenant_id ?? null,
        event_type: 'maintenance_request_assigned',
        event_description: JSON.stringify({
          previous_assignee_name: payload.previous_assignee_name ?? 'unassigned',
          new_assignee_name: payload.new_assignee_name ?? 'unassigned',
          description: payload.description ?? null,
        }),
        related_entity_id: payload.maintenance_request_id,
        related_entity_type: 'maintenance_request',
        created_at: payload.created_at || new Date(),
      });

      await this.propertyHistoryRepository.save(historyEntry);
    } catch (error) {
      this.logger.error(
        `Failed to create history entry for assignment: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Bridges the priority-toggle event to the websocket. Priority is metadata
   * (not a status transition), so we deliberately do NOT write a history row
   * or trigger the notifications listener — only the live UI cache refresh.
   */
  @OnEvent('maintenance.priority_changed')
  handleMaintenancePriorityChanged(payload: any): void {
    if (!this.eventsGateway || !payload?.request_id) return;
    this.eventsGateway.emitMaintenanceRequestUpdated(
      payload.property_id ?? '',
      payload.landlord_id,
      {
        maintenanceRequestId: payload.request_id,
        description: payload.description,
        tenantName: payload.tenant_name,
        propertyName: payload.property_name,
        status: payload.status,
      },
    );
  }

  /**
   * Tenant confirm/deny on an FM-filed request changes the status and (for
   * confirm) opens the landlord approval path. Without a websocket push,
   * landlord dashboards stay stale until refresh. We don't write a history
   * row here — the maintenance.updated handler covers that path separately
   * when the service flips the actual `status` column; these two events
   * are emitted from different code paths so we treat them independently.
   */
  @OnEvent('maintenance.tenant_confirmed')
  handleMaintenanceTenantConfirmed(payload: any): void {
    if (!this.eventsGateway || !payload?.request_id) return;
    this.eventsGateway.emitMaintenanceRequestUpdated(
      payload.property_id ?? '',
      payload.landlord_id,
      {
        maintenanceRequestId: payload.request_id,
        description: payload.description,
        tenantName: payload.tenant_name,
        propertyName: payload.property_name,
        status: payload.status,
        previousStatus: payload.previous_status,
      },
    );
  }

  @OnEvent('maintenance.tenant_denied')
  handleMaintenanceTenantDenied(payload: any): void {
    if (!this.eventsGateway || !payload?.request_id) return;
    this.eventsGateway.emitMaintenanceRequestUpdated(
      payload.property_id ?? '',
      payload.landlord_id,
      {
        maintenanceRequestId: payload.request_id,
        description: payload.description,
        tenantName: payload.tenant_name,
        propertyName: payload.property_name,
        status: payload.status,
        previousStatus: payload.previous_status,
      },
    );
  }

  @OnEvent('tenancy.renewed')
  async handleTenancyRenewed(payload: TenancyRenewedEvent): Promise<void> {
    this.logger.log(
      `Received tenancy.renewed event for property ${payload.property_id}`,
    );

    try {
      // Emit WebSocket event to notify landlord and property viewers
      if (this.eventsGateway) {
        this.eventsGateway.emitTenancyRenewed(
          payload.user_id,
          payload.property_id,
          {
            propertyName: payload.property_name,
            tenantName: payload.tenant_name,
            rentAmount: payload.rent_amount,
            paymentFrequency: payload.payment_frequency,
            startDate: payload.start_date,
            endDate: payload.end_date,
          },
        );
      }

      this.logger.log(
        `Successfully emitted tenancy renewed WebSocket event for property ${payload.property_id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to emit tenancy renewed event: ${error.message}`,
        error.stack,
      );
    }
  }

  private async createHistoryEntryWithRetry(
    payload: ServiceCreatedEvent,
    attempt: number = 1,
  ): Promise<void> {
    try {
      // Extract event payload data
      const {
        user_id,
        property_id,
        maintenance_request_id,
        description,
        created_at,
      } = payload;

      // Create property history entry with event_type 'maintenance_request_created'
      const historyEntry = this.propertyHistoryRepository.create({
        property_id,
        tenant_id: user_id,
        event_type: 'maintenance_request_created',
        event_description: description || 'Maintenance request created',
        related_entity_id: maintenance_request_id,
        related_entity_type: 'maintenance_request',
        created_at: created_at || new Date(),
      });

      await this.propertyHistoryRepository.save(historyEntry);

      this.logger.log(
        `Successfully created property history entry for maintenance request ${maintenance_request_id}`,
      );

      // Emit WebSocket event to notify property viewers and landlord
      if (this.eventsGateway) {
        this.eventsGateway.emitMaintenanceRequestCreated(
          property_id,
          payload.landlord_id,
          {
            maintenanceRequestId: maintenance_request_id,
            description,
            tenantName: payload.tenant_name,
            propertyName: payload.property_name,
          },
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to create property history entry (attempt ${attempt}/${this.MAX_RETRIES}): ${error.message}`,
        error.stack,
      );

      // Retry mechanism with exponential backoff
      if (attempt < this.MAX_RETRIES) {
        const delay = this.RETRY_DELAY * Math.pow(2, attempt - 1);
        this.logger.log(`Retrying in ${delay}ms...`);

        await new Promise((resolve) => setTimeout(resolve, delay));
        await this.createHistoryEntryWithRetry(payload, attempt + 1);
      } else {
        this.logger.error(
          `Failed to create property history entry after ${this.MAX_RETRIES} attempts. Event payload: ${JSON.stringify(payload)}`,
        );
        // Don't throw - we want the maintenance request to succeed even if history fails
      }
    }
  }
}
