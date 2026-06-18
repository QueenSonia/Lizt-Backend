import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PropertiesService } from '../properties.service';

interface TenantRespondedEvent {
  scheduled_move_out_id: string;
  tenant_account_id: string;
  accepted: boolean;
}

/**
 * Applies a tenant's WhatsApp Accept/Deny response to a landlord's
 * "deactivate renewal" request. Lives in PropertiesModule so it can call
 * PropertiesService directly — the WhatsApp bot emits the event instead of
 * injecting PropertiesService, avoiding a circular module dependency.
 */
@Injectable()
export class RenewalDeactivationResponseListener {
  private readonly logger = new Logger(
    RenewalDeactivationResponseListener.name,
  );

  constructor(private readonly propertiesService: PropertiesService) {}

  @OnEvent('renewal_deactivation.tenant_responded')
  async handleTenantResponded(event: TenantRespondedEvent): Promise<void> {
    try {
      if (event.accepted) {
        await this.propertiesService.confirmRenewalDeactivation(
          event.scheduled_move_out_id,
          event.tenant_account_id,
        );
      } else {
        await this.propertiesService.denyRenewalDeactivation(
          event.scheduled_move_out_id,
          event.tenant_account_id,
        );
      }
    } catch (err) {
      // Already-handled / mismatched-tenant / not-found are expected races
      // (double-tap, landlord cancelled first). Log and move on.
      this.logger.warn(
        `Failed to apply renewal-deactivation response for ${event.scheduled_move_out_id}: ${
          (err as { message?: string })?.message ?? err
        }`,
      );
    }
  }
}
