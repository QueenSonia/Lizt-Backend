import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ChatMessage } from 'src/chat/chat-message.entity';
import { Account } from 'src/users/entities/account.entity';
import { TeamMember } from 'src/users/entities/team-member.entity';
import { MaintenanceRequest } from 'src/maintenance-requests/entities/maintenance-request.entity';
import {
  MaintenanceRequestCreatorTypeEnum,
  MaintenanceRequestScopeEnum,
  MaintenanceRequestStatusEnum,
} from 'src/maintenance-requests/dto/create-maintenance-request.dto';
import { TemplateSenderService } from './template-sender';
import { UtilService } from 'src/utils/utility-service';
import { NotificationRecipientsService } from 'src/common/notify/notification-recipients.service';
import { NotificationCategory } from 'src/common/notify/notification-category.enum';

interface MrChatMessageCreatedEvent {
  message: ChatMessage;
  maintenance_request_id: string;
  maintenance_request_uuid: string;
  author_account_id: string;
  landlord_account_id: string | null;
}

interface RecipientPlan {
  account: Account;
  reason: 'landlord' | 'assigned_fm';
}

// Skip WA on these statuses — mirrors ChatService.THREAD_LOCKED_STATUSES.
// Pre-approval has no thread yet; rejected / denied / closed are terminal
// and the conversation is done. If the status flips between save and event
// delivery, this guard prevents pinging recipients about a dead thread.
const NOTIFY_LOCKED_STATUSES = new Set<MaintenanceRequestStatusEnum>([
  MaintenanceRequestStatusEnum.NOT_APPROVED,
  MaintenanceRequestStatusEnum.PENDING_TENANT_CONFIRMATION,
  MaintenanceRequestStatusEnum.REJECTED,
  MaintenanceRequestStatusEnum.DENIED_BY_TENANT,
  MaintenanceRequestStatusEnum.CLOSED,
]);

// Mirror of ChatService.isThreadLocked: an FM-filed request in
// PENDING_TENANT_CONFIRMATION is already landlord-approved + assigned, so its
// thread is OPEN (landlord ⇄ assigned FM coordinate while the tenant confirms).
// Landlord-filed PTC is still pre-approval and stays locked.
function isThreadLocked(mr: {
  status: MaintenanceRequestStatusEnum;
  creator_type: MaintenanceRequestCreatorTypeEnum;
}): boolean {
  if (
    mr.status === MaintenanceRequestStatusEnum.PENDING_TENANT_CONFIRMATION &&
    mr.creator_type === MaintenanceRequestCreatorTypeEnum.FACILITY_MANAGER
  ) {
    return false;
  }
  return NOTIFY_LOCKED_STATUSES.has(mr.status);
}

const PREVIEW_MAX_CHARS = 220;
// Body slot {{3}} is a description excerpt — meaningful context for the
// recipient ("Pipe leak in kitchen") instead of an opaque "MR-2026-00123".
// Kept short so the body fits comfortably in one WhatsApp message preview.
const DESCRIPTION_EXCERPT_MAX_CHARS = 60;

@Injectable()
export class MrChatNotificationService {
  private readonly logger = new Logger(MrChatNotificationService.name);

  constructor(
    @InjectRepository(MaintenanceRequest)
    private readonly mrRepo: Repository<MaintenanceRequest>,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    @InjectRepository(TeamMember)
    private readonly teamMemberRepo: Repository<TeamMember>,
    private readonly templateSender: TemplateSenderService,
    private readonly utilService: UtilService,
    private readonly eventEmitter: EventEmitter2,
    private readonly notificationRecipients: NotificationRecipientsService,
  ) {}

  @OnEvent('mr-chat.message.created')
  async onMessageCreated(payload: MrChatMessageCreatedEvent): Promise<void> {
    try {
      await this.dispatch(payload);
    } catch (err) {
      const message = (err as { message?: string })?.message ?? 'unknown';
      this.logger.error(
        `MR chat notify failed for ${payload?.maintenance_request_id}: ${message}`,
      );
    }
  }

  private async dispatch(payload: MrChatMessageCreatedEvent): Promise<void> {
    const mr = await this.mrRepo.findOne({
      where: { request_id: payload.maintenance_request_id },
      relations: ['property', 'common_area', 'facilityManager'],
    });
    if (!mr) {
      this.logger.warn(
        `MR not found for chat notify: ${payload.maintenance_request_id}`,
      );
      return;
    }
    if (isThreadLocked(mr)) {
      // Defensive: we shouldn't get here because ChatService also blocks
      // these statuses, but if status flips between save and event delivery,
      // bail out rather than ping recipients about a dead thread.
      return;
    }

    const recipients = await this.resolveRecipients(mr, payload);
    if (recipients.length === 0) return;

    const sender = await this.accountRepo.findOne({
      where: { id: payload.author_account_id },
      relations: ['user'],
    });
    const senderDisplay = this.displayName(sender, payload.message.senderName);

    // Media-only messages carry no text — fall back to an attachment label so
    // the template body {{...}} isn't a blank line.
    const rawPreview =
      (payload.message.content ?? '').trim() ||
      (payload.message.media?.length ? '📎 Sent an attachment' : '');
    const preview = this.utilService.sanitizeTemplateParam(
      rawPreview,
      PREVIEW_MAX_CHARS,
    );

    // Description excerpt replaces the opaque request_id in body {{3}}.
    // The id stays available for the URL button + quick-reply payload.
    const descriptionExcerpt = this.utilService.sanitizeTemplateParam(
      mr.description ?? mr.issue_category ?? 'Maintenance request',
      DESCRIPTION_EXCERPT_MAX_CHARS,
    );

    const propertyOrArea =
      mr.scope === MaintenanceRequestScopeEnum.COMMON_AREA
        ? (mr.common_area?.name ?? mr.property_name ?? 'Common area')
        : (mr.property?.name ?? mr.property_name ?? 'Property');

    for (const plan of recipients) {
      // 1. In-app toast — fires for every recipient. The frontend dedupes
      //    against the currently-focused MR (ChatRealtimeContext drops the
      //    toast if you're already on this thread) so online users don't
      //    get the toast on top of the live bubble. Online users on a
      //    different screen still get the dashboard toast.
      this.eventEmitter.emit('mr-chat.toast', {
        account_id: plan.account.id,
        toast: {
          maintenance_request_id: mr.request_id,
          maintenance_request_uuid: mr.id,
          sender_display_name: senderDisplay,
          sender_account_id: payload.author_account_id,
          description_excerpt: descriptionExcerpt,
          property_or_common_area_name: propertyOrArea,
          message_preview: preview,
          created_at: payload.message.created_at,
        },
      });

      // 2. WhatsApp — ALWAYS sent to the two recipients (landlord +
      //    assigned FM), regardless of presence. The two parties of the
      //    assignment need the durable ping so they can pick up the thread
      //    later even if they were online elsewhere when the message came in.
      const phone = plan.account.user?.phone_number;
      if (!phone) continue;
      try {
        await this.templateSender.sendMrChatNotification({
          phone_number: this.utilService.normalizePhoneNumber(phone),
          recipient_first_name: this.firstName(plan.account),
          sender_display_name: senderDisplay,
          request_description_excerpt: descriptionExcerpt,
          property_or_common_area_name: propertyOrArea,
          message_preview: preview,
          maintenance_request_id: mr.request_id,
          maintenance_request_uuid: mr.id,
        });
      } catch (err) {
        const message = (err as { message?: string })?.message ?? 'unknown';
        this.logger.warn(
          `WA chat ping failed (${plan.reason}) for ${mr.request_id} → ${phone}: ${message}`,
        );
      }
    }
  }

  // Recipient set: owner-side recipients (the managing admin — and, once
  // subscribed, the landlord) + assigned FM, minus the author. The thread is
  // private to the owner side + assigned FM for write access — no other team
  // FMs can post (see ChatService.resolveWriteRole), so there are no other
  // recipients to fan out to. The author is excluded so they don't get a
  // toast or WhatsApp echo of their own message.
  private async resolveRecipients(
    mr: MaintenanceRequest,
    payload: MrChatMessageCreatedEvent,
  ): Promise<RecipientPlan[]> {
    const byId = new Map<string, RecipientPlan>();

    const landlordId =
      payload.landlord_account_id ?? this.resolveLandlordId(mr);
    if (landlordId) {
      const ownerSide = await this.notificationRecipients.resolveRecipients(
        landlordId,
        NotificationCategory.MAINTENANCE_CHAT,
      );
      for (const recipient of ownerSide) {
        if (recipient.accountId === payload.author_account_id) continue;
        if (byId.has(recipient.accountId)) continue;
        const account = await this.loadAccount(recipient.accountId);
        if (account) {
          byId.set(recipient.accountId, { account, reason: 'landlord' });
        }
      }
    }

    if (mr.assigned_to) {
      const tm = await this.teamMemberRepo.findOne({
        where: { id: mr.assigned_to },
        relations: ['account', 'account.user'],
      });
      const assignedAccount = tm?.account;
      if (
        assignedAccount &&
        assignedAccount.id !== payload.author_account_id &&
        !byId.has(assignedAccount.id)
      ) {
        byId.set(assignedAccount.id, {
          account: assignedAccount,
          reason: 'assigned_fm',
        });
      }
    }

    return Array.from(byId.values());
  }

  private async loadAccount(id: string): Promise<Account | null> {
    return this.accountRepo.findOne({
      where: { id },
      relations: ['user'],
    });
  }

  private resolveLandlordId(mr: MaintenanceRequest): string | null {
    if (mr.scope === MaintenanceRequestScopeEnum.UNIT) {
      return mr.property?.owner_id ?? null;
    }
    // Both owner columns hold the landlord's Account.id directly.
    return mr.common_area?.owner_id ?? null;
  }

  private firstName(account: Account | null): string {
    if (!account) return 'there';
    const first = account.user?.first_name?.trim();
    if (first) return this.utilService.toSentenceCase(first);
    const profile = account.profile_name?.trim();
    if (profile) return profile.split(/\s+/)[0];
    return 'there';
  }

  private displayName(
    account: Account | null,
    fallback: string | null | undefined,
  ): string {
    if (account) {
      const profile = account.profile_name?.trim();
      if (profile) return profile;
      const composed = [account.user?.first_name, account.user?.last_name]
        .filter(Boolean)
        .join(' ')
        .trim();
      if (composed) return composed;
    }
    return (fallback ?? '').trim() || 'A team member';
  }
}
