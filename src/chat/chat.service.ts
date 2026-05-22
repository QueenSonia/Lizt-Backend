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

// Statuses where the unified thread is locked — pre-approval has no thread yet
// (including pending_tenant_confirmation, which is FM-on-behalf-of-tenant
// waiting for the tenant's nod before the landlord ever sees it) and the
// rejected/denied terminal states never had one. Anything past approval
// (approved/resolved/reopened/closed) keeps the thread open per the
// always-on-once-started rule.
const THREAD_LOCKED_STATUSES = new Set<MaintenanceRequestStatusEnum>([
  MaintenanceRequestStatusEnum.NOT_APPROVED,
  MaintenanceRequestStatusEnum.PENDING_TENANT_CONFIRMATION,
  MaintenanceRequestStatusEnum.REJECTED,
  MaintenanceRequestStatusEnum.DENIED_BY_TENANT,
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

  // Resolves the landlord Account.id that owns an MR — property.owner_id is
  // already Account.id for unit-scope; common_area.owner_id is Users.id so we
  // join via Account.userId. Returns null if neither resolves (orphan MR).
  private async resolveLandlordAccountId(
    mr: MaintenanceRequest,
  ): Promise<string | null> {
    if (mr.scope === MaintenanceRequestScopeEnum.UNIT) {
      return mr.property?.owner_id ?? null;
    }
    if (mr.scope === MaintenanceRequestScopeEnum.COMMON_AREA) {
      const ownerUserId = mr.common_area?.owner_id;
      if (!ownerUserId) return null;
      // Prefer the account with LANDLORD in its roles[]. There can be multiple
      // accounts per user (per-role accounts), and we want the landlord one.
      const landlord = await this.accountRepo
        .createQueryBuilder('a')
        .where('a."userId" = :uid', { uid: ownerUserId })
        .andWhere(':role = ANY(a.roles)', { role: RolesEnum.LANDLORD })
        .getOne();
      return landlord?.id ?? null;
    }
    return null;
  }

  // Authorizes a viewer against an MR's team. Returns the role the viewer
  // would post as: 'landlord' if they own it, 'facility_manager' if they're a
  // team member, null otherwise.
  private async resolveViewerRole(
    viewerAccountId: string,
    landlordAccountId: string | null,
  ): Promise<MessageSender.LANDLORD | MessageSender.FACILITY_MANAGER | null> {
    if (!landlordAccountId) return null;
    if (viewerAccountId === landlordAccountId) return MessageSender.LANDLORD;

    const teamMember = await this.teamMemberRepo
      .createQueryBuilder('tm')
      .innerJoin('tm.team', 'team')
      .where('team."creatorId" = :landlordId', { landlordId: landlordAccountId })
      .andWhere('tm."accountId" = :viewerId', { viewerId: viewerAccountId })
      .andWhere('tm.role = :role', { role: RolesEnum.FACILITY_MANAGER })
      .getOne();
    return teamMember ? MessageSender.FACILITY_MANAGER : null;
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
    const viewerRole = await this.resolveViewerRole(
      viewer.id,
      landlordAccountId,
    );
    if (!viewerRole) {
      throw new ForbiddenException(
        'You do not have access to this request thread',
      );
    }

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
      canPost: !THREAD_LOCKED_STATUSES.has(mr.status),
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
    const senderRole = await this.resolveViewerRole(
      args.authorAccount.id,
      landlordAccountId,
    );
    if (!senderRole) {
      throw new ForbiddenException(
        'You do not have access to this request thread',
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
