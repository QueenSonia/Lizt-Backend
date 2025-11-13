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
  service_request_id?: string; // Service request ID
  description?: string; // Issue description
  created_at?: Date; // Timestamp
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

  @OnEvent('service.created')
  async handleServiceRequestCreated(
    payload: ServiceCreatedEvent,
  ): Promise<void> {
    this.logger.log(
      `Received service.created event for tenant ${payload.user_id} and property ${payload.property_id}`,
    );

    await this.createHistoryEntryWithRetry(payload);
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
        service_request_id,
        description,
        created_at,
      } = payload;

      // Create property history entry with event_type 'service_request'
      const historyEntry = this.propertyHistoryRepository.create({
        property_id,
        tenant_id: user_id,
        event_type: 'service_request',
        event_description: description || 'Service request created',
        related_entity_id: service_request_id,
        related_entity_type: 'service_request',
        created_at: created_at || new Date(),
      });

      await this.propertyHistoryRepository.save(historyEntry);

      this.logger.log(
        `Successfully created property history entry for service request ${service_request_id}`,
      );

      // Emit WebSocket event to notify property viewers and landlord
      if (this.eventsGateway) {
        this.eventsGateway.emitServiceRequestCreated(
          property_id,
          payload.landlord_id,
          {
            serviceRequestId: service_request_id,
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
        // Don't throw - we want the service request to succeed even if history fails
      }
    }
  }
}
