import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ChatMessage } from 'src/chat/chat-message.entity';
import { ChatPresenceService } from 'src/chat/chat-presence.service';
import { Account } from 'src/users/entities/account.entity';
import { TeamMember } from 'src/users/entities/team-member.entity';
import { MaintenanceRequest } from 'src/maintenance-requests/entities/maintenance-request.entity';
import {
  MaintenanceRequestScopeEnum,
  MaintenanceRequestStatusEnum,
} from 'src/maintenance-requests/dto/create-maintenance-request.dto';
import { TemplateSenderService } from './template-sender';
import { UtilService } from 'src/utils/utility-service';
import { RolesEnum } from 'src/base.entity';

interface MrChatMessageCreatedEvent {
  message: ChatMessage;
  maintenance_request_id: string;
  maintenance_request_uuid: string;
  author_account_id: string;
  landlord_account_id: string | null;
}

interface RecipientPlan {
  account: Account;
  reason: 'landlord' | 'assigned_fm' | 'prior_poster';
}

// Skip WA on these statuses — the thread shouldn't be active at all, and the
// gateway listener will have already broadcast the message to anyone viewing.
const NOTIFY_LOCKED_STATUSES = new Set<MaintenanceRequestStatusEnum>([
  MaintenanceRequestStatusEnum.NOT_APPROVED,
  MaintenanceRequestStatusEnum.PENDING_TENANT_CONFIRMATION,
  MaintenanceRequestStatusEnum.REJECTED,
  MaintenanceRequestStatusEnum.DENIED_BY_TENANT,
]);

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
    @InjectRepository(ChatMessage)
    private readonly chatRepo: Repository<ChatMessage>,
    private readonly presence: ChatPresenceService,
    private readonly templateSender: TemplateSenderService,
    private readonly utilService: UtilService,
    private readonly eventEmitter: EventEmitter2,
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
    if (NOTIFY_LOCKED_STATUSES.has(mr.status)) {
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

    const preview = this.utilService.sanitizeTemplateParam(
      payload.message.content ?? '',
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
        ? mr.common_area?.name ?? mr.property_name ?? 'Common area'
        : mr.property?.name ?? mr.property_name ?? 'Property';

    for (const plan of recipients) {
      if (this.presence.isActive(plan.account.id)) {
        // Online: push a toast to whatever dashboard screen they're on. They
        // see the live thread update too if the modal is open (mr:{id} room);
        // the frontend dedupes against that. No WhatsApp ping.
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
        continue;
      }

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

  // Recipient set: landlord + assigned FM + anyone who has previously posted
  // in this thread, minus the author. Deduplicated by account id.
  private async resolveRecipients(
    mr: MaintenanceRequest,
    payload: MrChatMessageCreatedEvent,
  ): Promise<RecipientPlan[]> {
    const byId = new Map<string, RecipientPlan>();

    const landlordId =
      payload.landlord_account_id ?? (await this.resolveLandlordId(mr));
    if (landlordId && landlordId !== payload.author_account_id) {
      const account = await this.loadAccount(landlordId);
      if (account) byId.set(landlordId, { account, reason: 'landlord' });
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

    // Prior posters — DISTINCT sender_account_id from this thread, excluding
    // author and anyone already in the set. The CURRENT message is excluded
    // because its row carries the author's id.
    const priorPosters = await this.chatRepo
      .createQueryBuilder('m')
      .select('DISTINCT m.sender_account_id', 'account_id')
      .where('m.maintenance_request_id = :id', { id: mr.request_id })
      .andWhere('m.sender_account_id IS NOT NULL')
      .andWhere('m.sender_account_id != :author', {
        author: payload.author_account_id,
      })
      .getRawMany<{ account_id: string }>();

    for (const row of priorPosters) {
      if (!row.account_id || byId.has(row.account_id)) continue;
      const account = await this.loadAccount(row.account_id);
      if (account) byId.set(row.account_id, { account, reason: 'prior_poster' });
    }

    return Array.from(byId.values());
  }

  private async loadAccount(id: string): Promise<Account | null> {
    return this.accountRepo.findOne({
      where: { id },
      relations: ['user'],
    });
  }

  private async resolveLandlordId(
    mr: MaintenanceRequest,
  ): Promise<string | null> {
    if (mr.scope === MaintenanceRequestScopeEnum.UNIT) {
      return mr.property?.owner_id ?? null;
    }
    // Common area owner_id is Users.id — find the LANDLORD-role account for
    // that user.
    const ownerUserId = mr.common_area?.owner_id;
    if (!ownerUserId) return null;
    const landlord = await this.accountRepo
      .createQueryBuilder('a')
      .where('a."userId" = :uid', { uid: ownerUserId })
      .andWhere(':role = ANY(a.roles)', { role: RolesEnum.LANDLORD })
      .getOne();
    return landlord?.id ?? null;
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
      const composed = [
        account.user?.first_name,
        account.user?.last_name,
      ]
        .filter(Boolean)
        .join(' ')
        .trim();
      if (composed) return composed;
    }
    return (fallback ?? '').trim() || 'A team member';
  }
}
