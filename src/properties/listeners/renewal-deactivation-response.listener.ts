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
  async handleTenantResponded(
    event: TenantRespondedEvent,
  ): Promise<{ applied: boolean; accepted: boolean }> {
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
      return { applied: true, accepted: event.accepted };
    } catch (err) {
      // Already-handled / mismatched-tenant / not-found are expected races
      // (double-tap, or the landlord cancelled the request first). Log and
      // report applied:false so the bot sends an accurate "no longer active"
      // reply instead of a false "your tenancy will end" confirmation.
      this.logger.warn(
        `Failed to apply renewal-deactivation response for ${event.scheduled_move_out_id}: ${
          (err as { message?: string })?.message ?? err
        }`,
      );
      return { applied: false, accepted: event.accepted };
    }
  }
}
