import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { MaintenanceRequest } from 'src/maintenance-requests/entities/maintenance-request.entity';
import { SendMessageDto } from './dto/send-message.dto';
import { ChatMessage, MessageSender, MessageType } from './chat-message.entity';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  MaintenanceRequestCreatorTypeEnum,
  MaintenanceRequestScopeEnum,
  MaintenanceRequestStatusEnum,
} from 'src/maintenance-requests/dto/create-maintenance-request.dto';
import { TenantStatusEnum } from 'src/properties/dto/create-property.dto';
import { Account } from 'src/users/entities/account.entity';
import { TeamMember } from 'src/users/entities/team-member.entity';
import { RolesEnum } from 'src/base.entity';

// Statuses where the unified thread is locked. Three flavours:
//   - pre-approval (not_approved / pending_tenant_confirmation) — no thread
//     yet; the landlord hasn't approved + assigned.
//   - rejected / denied_by_tenant — terminal, never had a thread.
//   - closed — terminal, the tenant has confirmed resolution. The thread
//     stays readable but no further posts are accepted; landlord and FM
//     have finished the conversation by definition.
// Active statuses (approved / resolved / reopened) keep the thread open.
// "Resolved" is intentionally writable — the FM has marked it resolved but
// the tenant hasn't confirmed yet, so coordination may still be needed.
const THREAD_LOCKED_STATUSES = new Set<MaintenanceRequestStatusEnum>([
  MaintenanceRequestStatusEnum.NOT_APPROVED,
  MaintenanceRequestStatusEnum.PENDING_TENANT_CONFIRMATION,
  MaintenanceRequestStatusEnum.REJECTED,
  MaintenanceRequestStatusEnum.DENIED_BY_TENANT,
  MaintenanceRequestStatusEnum.CLOSED,
]);

interface SendMaintenanceChatArgs {
  requestId: string;
  authorAccount: Account & { id: string };
  activeRole: RolesEnum | string;
  content: string;
}

export interface MaintenanceChatMessageView {
  id: string;
  maintenance_request_id: string;
  sender: MessageSender;
  type: MessageType;
  content: string;
  isRead: boolean;
  senderName: string | null;
  sender_account_id: string | null;
  // ISO string so the wire format is stable across timezones and the frontend
  // can parse without guessing whether it got a Date or a string.
  created_at: string;
}

function toIsoString(value: string | Date | undefined): string {
  if (!value) return new Date().toISOString();
  return value instanceof Date ? value.toISOString() : value;
}

const UUID_RX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(ChatMessage)
    private readonly chatMessageRepository: Repository<ChatMessage>,
    @InjectRepository(MaintenanceRequest)
    private readonly maintenanceRequestRepo: Repository<MaintenanceRequest>,
    @InjectRepository(PropertyTenant)
    private readonly propertyTenantRepo: Repository<PropertyTenant>,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    @InjectRepository(TeamMember)
    private readonly teamMemberRepo: Repository<TeamMember>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async sendMessage(
    userId: string,
    sendMessageDto: SendMessageDto,
  ): Promise<ChatMessage> {
    if (sendMessageDto.sender === MessageSender.TENANT) {
      const propertyTenant = await this.propertyTenantRepo.findOne({
        where: { tenant_id: userId, status: TenantStatusEnum.ACTIVE },
        relations: ['property', 'tenant', 'tenant.user'],
      });

      if (!propertyTenant) {
        throw new Error('Tenant not found');
      }

      const isMaintenanceRequestExists = await this.maintenanceRequestRepo.findOne({
        where: { request_id: sendMessageDto.requestId },
      });

      if (!isMaintenanceRequestExists) {
        const maintenanceRequest = this.maintenanceRequestRepo.create({
          tenant_id: userId,
          property_id: propertyTenant.property_id,
          tenant_name: propertyTenant.tenant.profile_name,
          property_name: propertyTenant.property.name,
          issue_category: 'service',
          date_reported: new Date(),
          description: sendMessageDto.content,
          request_id: sendMessageDto.requestId,
          creator_type: MaintenanceRequestCreatorTypeEnum.TENANT,
          creator_user_id: propertyTenant.tenant.user?.id ?? null,
        });

        (await this.maintenanceRequestRepo.save(maintenanceRequest)) as any;

        this.eventEmitter.emit('maintenance.created', {
          user_id: userId,
          property_id: propertyTenant.property_id,
          landlord_id: propertyTenant.property?.owner_id,
          tenant_name: propertyTenant.tenant.profile_name,
          property_name: propertyTenant.property.name,
          maintenance_request_id: maintenanceRequest.id,
          description: sendMessageDto.content,
          created_at: maintenanceRequest.created_at,
        });
      }
    }

    const message = this.chatMessageRepository.create({
      ...sendMessageDto,
      maintenance_request_id: sendMessageDto.requestId,
    });

    return this.chatMessageRepository.save(message);
  }

  async getAllMessagesForUser(
    currentUser: 'admin' | 'tenant' | 'rep',
  ): Promise<any[]> {
    const normalizedUser = currentUser === 'rep' ? 'admin' : currentUser;

    return (
      this.chatMessageRepository
        .createQueryBuilder('message')
        .select('message.maintenance_request_id', 'requestId')
        .addSelect('MAX(message.created_at)', 'lastMessageAt')
        .addSelect('COUNT(*)', 'messageCount')
        .addSelect(
          `COUNT(CASE
         WHEN message.isRead = false
         AND message.sender != :normalizedUser
         THEN 1
       END)`,
          'unread',
        )
        .leftJoin('message.maintenanceRequest', 'maintenanceRequest')
        .addSelect('maintenanceRequest.tenant_name', 'tenant_name')
        .addSelect('maintenanceRequest.issue_category', 'issue_category')
        .addSelect('maintenanceRequest.description', 'description')
        .addSelect('maintenanceRequest.status', 'status')
        .groupBy('message.maintenance_request_id')
        .addGroupBy('maintenanceRequest.tenant_name')
        .addGroupBy('maintenanceRequest.issue_category')
        .addGroupBy('maintenanceRequest.description')
        .addGroupBy('maintenanceRequest.status')
        .orderBy('MAX(message.created_at)', 'DESC')
        .setParameter('normalizedUser', normalizedUser)
        .getRawMany()
    );
  }

  async getMessagesByRequestId(requestId: string): Promise<ChatMessage[]> {
    return this.chatMessageRepository.find({
      where: { maintenance_request_id: requestId },
      relations: ['maintenanceRequest', 'maintenanceRequest.tenant.user'],
      order: { created_at: 'ASC' },
    });
  }

  async markMessagesAsRead(
    requestId: string,
    sender: MessageSender,
  ): Promise<void> {
    await this.chatMessageRepository.update(
      {
        maintenance_request_id: requestId,
        sender: Not(sender),
        isRead: false,
      },
      { isRead: true },
    );
  }

  async markAsResolved(requestId: string) {
    await this.maintenanceRequestRepo.update(
      {
        request_id: requestId,
      },
      {
        status: MaintenanceRequestStatusEnum.RESOLVED,
      },
    );
  }

  async createSystemMessage(data: {
    maintenanceRequestId: string;
    content: string;
  }): Promise<ChatMessage> {
    return this.chatMessageRepository.save({
      maintenanceRequest: { id: data.maintenanceRequestId },
      sender: MessageSender.SYSTEM,
      type: MessageType.SYSTEM,
      content: data.content,
      senderName: 'System',
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // Unified Updates & Thread (landlord + team FMs)
  // ──────────────────────────────────────────────────────────────────────

  // Resolves the landlord Account.id that owns an MR. Both property.owner_id
  // and common_area.owner_id hold the landlord's Account.id directly. Returns
  // null if neither resolves (orphan MR).
  private resolveLandlordAccountId(mr: MaintenanceRequest): string | null {
    if (mr.scope === MaintenanceRequestScopeEnum.UNIT) {
      return mr.property?.owner_id ?? null;
    }
    if (mr.scope === MaintenanceRequestScopeEnum.COMMON_AREA) {
      return mr.common_area?.owner_id ?? null;
    }
    return null;
  }

  // Read access: anyone on the landlord's team can view the thread. Lets
  // a non-assigned FM see what's happening on an MR they're not driving —
  // useful for handover / shadowing. Write access is narrower (see
  // resolveWriteRole) so they can't actually post.
  private async resolveReadAccess(
    viewerAccountId: string,
    landlordAccountId: string | null,
  ): Promise<boolean> {
    if (!landlordAccountId) return false;
    if (viewerAccountId === landlordAccountId) return true;

    const teamMember = await this.teamMemberRepo
      .createQueryBuilder('tm')
      .innerJoin('tm.team', 'team')
      .where('team."creatorId" = :landlordId', { landlordId: landlordAccountId })
      .andWhere('tm."accountId" = :viewerId', { viewerId: viewerAccountId })
      .andWhere('tm.role = :role', { role: RolesEnum.FACILITY_MANAGER })
      .getOne();
    return !!teamMember;
  }

  // Write access: only the landlord owner and the FM currently assigned to
  // this MR (mr.assigned_to → TeamMember.account.id). Returns the
  // MessageSender role to stamp on the saved row, or null to refuse the
  // post. Reassignment rotates this — the previous assignee loses write
  // access, the new assignee gains it. Historical messages by the previous
  // FM stay readable since this check fires at write time, not retroactively.
  private async resolveWriteRole(
    viewerAccountId: string,
    landlordAccountId: string | null,
    assignedTeamMemberId: string | null,
  ): Promise<MessageSender.LANDLORD | MessageSender.FACILITY_MANAGER | null> {
    if (!landlordAccountId) return null;
    if (viewerAccountId === landlordAccountId) return MessageSender.LANDLORD;

    if (!assignedTeamMemberId) return null;
    const assignedTm = await this.teamMemberRepo.findOne({
      where: { id: assignedTeamMemberId },
      relations: ['account'],
    });
    const assignedAccountId = assignedTm?.account?.id ?? null;
    if (!assignedAccountId) return null;
    return assignedAccountId === viewerAccountId
      ? MessageSender.FACILITY_MANAGER
      : null;
  }

  // Accepts either the UUID id or the human-readable request_id varchar.
  // The rest of the chat code path uses request_id (the FK on chat_messages
  // and the room name on the gateway), so we resolve to the MR first and
  // then thread MR.request_id through everywhere.
  private async findMrByEither(
    idOrRequestId: string,
  ): Promise<MaintenanceRequest | null> {
    if (UUID_RX.test(idOrRequestId)) {
      return this.maintenanceRequestRepo.findOne({
        where: { id: idOrRequestId },
        relations: ['property', 'common_area'],
      });
    }
    return this.maintenanceRequestRepo.findOne({
      where: { request_id: idOrRequestId },
      relations: ['property', 'common_area'],
    });
  }

  async listMaintenanceChat(
    requestId: string,
    viewer: Account & { id: string },
  ): Promise<{
    request_id: string;
    messages: MaintenanceChatMessageView[];
    canPost: boolean;
    viewerAccountId: string;
  }> {
    const mr = await this.findMrByEither(requestId);
    if (!mr) throw new NotFoundException('Maintenance request not found');

    const landlordAccountId = await this.resolveLandlordAccountId(mr);
    const canRead = await this.resolveReadAccess(viewer.id, landlordAccountId);
    if (!canRead) {
      throw new ForbiddenException(
        'You do not have access to this request thread',
      );
    }

    // Write check is separate — non-assigned team FMs can read but not post.
    const writeRole = await this.resolveWriteRole(
      viewer.id,
      landlordAccountId,
      mr.assigned_to ?? null,
    );
    const hasWriteAccess = writeRole !== null;

    const messages = await this.chatMessageRepository.find({
      where: { maintenance_request_id: mr.request_id },
      order: { created_at: 'ASC' },
    });

    const view: MaintenanceChatMessageView[] = messages.map((m) => ({
      id: m.id,
      maintenance_request_id: m.maintenance_request_id,
      sender: m.sender,
      type: m.type,
      content: m.content,
      isRead: m.isRead,
      senderName: m.senderName ?? null,
      sender_account_id: m.sender_account_id ?? null,
      created_at: toIsoString(m.created_at),
    }));

    return {
      // Canonical request_id (varchar) — clients use it for socket rooms
      // (mr:focus / mr:blur) so we don't have to assume what they passed in.
      request_id: mr.request_id,
      messages: view,
      // canPost combines BOTH gates: the thread must not be in a locked
      // status AND the viewer must have write authority (landlord or the
      // currently-assigned FM). Non-assigned team FMs see canPost=false
      // even on approved threads.
      canPost: hasWriteAccess && !THREAD_LOCKED_STATUSES.has(mr.status),
      viewerAccountId: viewer.id,
    };
  }

  async sendMaintenanceChatMessage(
    args: SendMaintenanceChatArgs,
  ): Promise<MaintenanceChatMessageView> {
    const content = (args.content ?? '').trim();
    if (!content) {
      throw new ForbiddenException('Message content is required');
    }

    const mr = await this.findMrByEither(args.requestId);
    if (!mr) throw new NotFoundException('Maintenance request not found');

    if (THREAD_LOCKED_STATUSES.has(mr.status)) {
      throw new ForbiddenException(
        'Thread is not available on this request yet',
      );
    }

    const landlordAccountId = await this.resolveLandlordAccountId(mr);
    const senderRole = await this.resolveWriteRole(
      args.authorAccount.id,
      landlordAccountId,
      mr.assigned_to ?? null,
    );
    if (!senderRole) {
      // Either not on the team at all, or a non-assigned team FM. Both get
      // a clear message — the frontend hides the input for the latter, but
      // a stale write attempt could still race here.
      throw new ForbiddenException(
        'Only the landlord and the assigned facility manager can post on this thread.',
      );
    }

    const senderName =
      args.authorAccount.profile_name ||
      [args.authorAccount.user?.first_name, args.authorAccount.user?.last_name]
        .filter(Boolean)
        .join(' ') ||
      (senderRole === MessageSender.LANDLORD ? 'Landlord' : 'Facility Manager');

    const saved = await this.chatMessageRepository.save(
      this.chatMessageRepository.create({
        maintenance_request_id: mr.request_id,
        sender: senderRole,
        type: MessageType.TEXT,
        content,
        senderName,
        sender_account_id: args.authorAccount.id,
        isRead: false,
      }),
    );

    // Two listeners pick this up: ChatGateway broadcasts to the MR's room for
    // live UI updates, and MrChatNotificationService fans out WhatsApp pings
    // to offline recipients (landlord + assigned FM + prior posters − author).
    this.eventEmitter.emit('mr-chat.message.created', {
      message: saved,
      maintenance_request_id: mr.request_id,
      maintenance_request_uuid: mr.id,
      author_account_id: args.authorAccount.id,
      landlord_account_id: landlordAccountId,
    });

    return {
      id: saved.id,
      maintenance_request_id: saved.maintenance_request_id,
      sender: saved.sender,
      type: saved.type,
      content: saved.content,
      isRead: saved.isRead,
      senderName: saved.senderName ?? null,
      sender_account_id: saved.sender_account_id ?? null,
      created_at: toIsoString(saved.created_at),
    };
  }
}
