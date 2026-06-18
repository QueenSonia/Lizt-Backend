import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationService } from '../notification.service';
import { NotificationType } from '../enums/notification-type';
import { Account } from 'src/users/entities/account.entity';
import { TemplateSenderService } from 'src/whatsapp-bot/template-sender';
import { UtilService } from 'src/utils/utility-service';

interface RequestedEvent {
  scheduled_move_out_id: string;
  property_id: string;
  tenant_id: string;
  landlord_id?: string;
  property_name?: string;
  tenant_name?: string;
  effective_date: string;
}

interface RespondedEvent {
  scheduled_move_out_id: string;
  property_id: string;
  tenant_id: string;
  landlord_id?: string;
  property_name?: string;
  effective_date?: string;
}

/**
 * Notifications for the landlord "deactivate renewal" flow:
 *  - renewal_deactivation.requested      → ask the tenant to confirm (WhatsApp)
 *  - renewal_deactivation.tenant_confirmed → tell the landlord it's scheduled
 *  - renewal_deactivation.tenant_denied    → tell the landlord it was declined
 */
@Injectable()
export class RenewalDeactivationListener {
  private readonly logger = new Logger(RenewalDeactivationListener.name);

  private readonly requestedSeen = new Map<string, number>();
  private readonly confirmedSeen = new Map<string, number>();
  private readonly deniedSeen = new Map<string, number>();
  private readonly DEDUP_MS = 60_000;

  constructor(
    private readonly notificationService: NotificationService,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @Inject(forwardRef(() => TemplateSenderService))
    private readonly templateSenderService: TemplateSenderService,
    private readonly utilService: UtilService,
  ) {}

  private dedup(map: Map<string, number>, key: string): boolean {
    const now = Date.now();
    const last = map.get(key);
    if (last && now - last < this.DEDUP_MS) return false;
    map.set(key, now);
    return true;
  }

  /** Resolve an account's normalized WhatsApp phone from its Account.id. */
  private async resolveAccountPhone(
    accountId: string | null | undefined,
  ): Promise<string | null> {
    if (!accountId) return null;
    const account = await this.accountRepository.findOne({
      where: { id: accountId },
      relations: ['user'],
    });
    const phoneRaw = account?.user?.phone_number;
    if (!phoneRaw) return null;
    return this.utilService.normalizePhoneNumber(phoneRaw);
  }

  /** Resolve an account's display name (profile_name → first+last → fallback). */
  private async resolveAccountDisplayName(
    accountId: string | null | undefined,
    fallback = 'there',
  ): Promise<string> {
    if (!accountId) return fallback;
    const account = await this.accountRepository.findOne({
      where: { id: accountId },
      relations: ['user'],
    });
    const profile = account?.profile_name?.trim();
    if (profile) return profile;
    const first = account?.user?.first_name?.trim() ?? '';
    const last = account?.user?.last_name?.trim() ?? '';
    return `${first} ${last}`.trim() || fallback;
  }

  @OnEvent('renewal_deactivation.requested')
  async handleRequested(event: RequestedEvent): Promise<void> {
    if (!this.dedup(this.requestedSeen, event.scheduled_move_out_id)) return;
    try {
      const tenantPhone = await this.resolveAccountPhone(event.tenant_id);
      if (!tenantPhone) {
        this.logger.warn(
          `No phone for tenant ${event.tenant_id}; cannot send deactivation confirmation`,
        );
        return;
      }
      const tenantName =
        event.tenant_name ||
        (await this.resolveAccountDisplayName(event.tenant_id));
      await this.templateSenderService.sendTenantConfirmRenewalDeactivation({
        phone_number: tenantPhone,
        tenant_name: tenantName,
        property_name: event.property_name ?? 'your property',
        end_date: event.effective_date,
        scheduled_move_out_id: event.scheduled_move_out_id,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to send tenant deactivation confirmation: ${
          (err as { message?: string })?.message ?? err
        }`,
      );
    }
  }

  @OnEvent('renewal_deactivation.tenant_confirmed')
  async handleConfirmed(event: RespondedEvent): Promise<void> {
    if (!this.dedup(this.confirmedSeen, event.scheduled_move_out_id)) return;
    try {
      const tenantName = await this.resolveAccountDisplayName(
        event.tenant_id,
        'The tenant',
      );

      // In-app notification for the landlord.
      if (event.landlord_id) {
        await this.notificationService.create({
          date: new Date().toISOString(),
          type: NotificationType.RENEWAL_DEACTIVATION_ACCEPTED,
          description: `${tenantName} accepted the renewal deactivation for ${
            event.property_name ?? 'your property'
          }. The tenancy will end on ${event.effective_date ?? 'the due date'}.`,
          status: 'Pending',
          property_id: event.property_id,
          user_id: event.landlord_id,
        });
      }

      const landlordPhone = await this.resolveAccountPhone(event.landlord_id);
      if (landlordPhone) {
        const landlordName = await this.resolveAccountDisplayName(
          event.landlord_id,
        );
        await this.templateSenderService.sendLandlordRenewalDeactivationAccepted(
          {
            phone_number: landlordPhone,
            landlord_name: landlordName,
            tenant_name: tenantName,
            property_name: event.property_name ?? 'your property',
            end_date: event.effective_date ?? 'the due date',
          },
        );
      }
    } catch (err) {
      this.logger.warn(
        `Failed to notify landlord of renewal-deactivation acceptance: ${
          (err as { message?: string })?.message ?? err
        }`,
      );
    }
  }

  @OnEvent('renewal_deactivation.tenant_denied')
  async handleDenied(event: RespondedEvent): Promise<void> {
    if (!this.dedup(this.deniedSeen, event.scheduled_move_out_id)) return;
    try {
      const tenantName = await this.resolveAccountDisplayName(
        event.tenant_id,
        'The tenant',
      );

      if (event.landlord_id) {
        await this.notificationService.create({
          date: new Date().toISOString(),
          type: NotificationType.RENEWAL_DEACTIVATION_DECLINED,
          description: `${tenantName} declined the renewal deactivation for ${
            event.property_name ?? 'your property'
          }. Renewal will continue as normal.`,
          status: 'Pending',
          property_id: event.property_id,
          user_id: event.landlord_id,
        });
      }

      const landlordPhone = await this.resolveAccountPhone(event.landlord_id);
      if (landlordPhone) {
        const landlordName = await this.resolveAccountDisplayName(
          event.landlord_id,
        );
        await this.templateSenderService.sendLandlordRenewalDeactivationDenied({
          phone_number: landlordPhone,
          landlord_name: landlordName,
          tenant_name: tenantName,
          property_name: event.property_name ?? 'your property',
        });
      }
    } catch (err) {
      this.logger.warn(
        `Failed to notify landlord of renewal-deactivation denial: ${
          (err as { message?: string })?.message ?? err
        }`,
      );
    }
  }
}
