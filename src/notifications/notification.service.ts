import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Notification } from './entities/notification.entity';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { PushNotificationService } from './push-notification.service';
import { NotificationType } from './enums/notification-type';
import { ManagementScopeService } from '../common/scope/management-scope.service';
import { Account, accountHasRole } from '../users/entities/account.entity';
import { RolesEnum } from '../base.entity';
import { Property } from 'src/properties/entities/property.entity';
import { MaintenanceRequest } from 'src/maintenance-requests/entities/maintenance-request.entity';
import { UtilService } from 'src/utils/utility-service';

@Injectable()
export class NotificationService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(Property)
    private readonly propertyRepo: Repository<Property>,
    @InjectRepository(MaintenanceRequest)
    private readonly mrRepo: Repository<MaintenanceRequest>,
    private readonly pushNotificationService: PushNotificationService,
    private readonly scopeService: ManagementScopeService,
    private readonly util: UtilService,
  ) {}

  /**
   * The notification "owner" ids a requester may see: their own account id plus
   * — for a property-manager admin — every managed landlord's account id.
   * Operational notifications (KYC/payments/maintenance) carry
   * `user_id = property.owner_id` (the landlord), so the admin's live feed must
   * span the managed set; a non-admin resolves to just themselves.
   */
  private async resolveNotificationOwnerIds(
    requesterId: string,
  ): Promise<string[]> {
    if (!requesterId) return [];
    const managed =
      await this.scopeService.resolveManagedLandlordIds(requesterId);
    return Array.from(new Set([requesterId, ...managed]));
  }

  /**
   * Assemble the denormalized `search_text` that powers the Live Feed search.
   * Type-agnostic: pulls whatever the row's own ids resolve to (property +
   * its live tenants, owning landlord, maintenance request) and folds them in
   * with the always-present description + type label. Each absent id simply
   * contributes nothing. Snapshot semantics — baked once, at create time.
   */
  private async buildSearchText(dto: CreateNotificationDto): Promise<string> {
    const [property, landlord, mr] = await Promise.all([
      dto.property_id
        ? this.propertyRepo.findOne({
            where: { id: dto.property_id },
            relations: ['property_tenants', 'property_tenants.tenant'],
          })
        : null,
      dto.user_id
        ? this.accountRepository.findOne({
            where: { id: dto.user_id },
            relations: ['user'],
          })
        : null,
      dto.maintenance_request_id
        ? this.mrRepo.findOne({ where: { id: dto.maintenance_request_id } })
        : null,
    ]);

    const parts: Array<string | null | undefined> = [
      dto.description,
      dto.type,
      property?.name,
      property?.location,
      ...(property?.property_tenants ?? []).map((pt) => pt.tenant?.profile_name),
      landlord?.profile_name,
      [landlord?.user?.first_name, landlord?.user?.last_name]
        .filter(Boolean)
        .join(' '),
      mr?.issue_category,
      mr?.description,
      mr?.request_id,
      mr?.artisan_name_snapshot,
    ];

    return this.util.normalizeSearchText(parts.filter(Boolean).join(' '));
  }

  async create(dto: CreateNotificationDto): Promise<Notification> {
    const search_text = await this.buildSearchText(dto);
    const notification = this.notificationRepository.create({
      ...dto,
      search_text,
    });
    const saved = await this.notificationRepository.save(notification);

    // Trigger push notification to the operator's subscribed devices
    if (dto.user_id) {
      const pushTargetId = await this.resolvePushTargetId(dto.user_id);
      const pushTitle = this.getPushTitle(dto.type);
      // Fire-and-forget: push delivery must never block or fail the insert.
      void this.pushNotificationService.sendToUser(pushTargetId, {
        title: pushTitle,
        body: dto.description,
        url: dto.property_id
          ? `/landlord/property-detail?propertyId=${dto.property_id}`
          : '/',
      });
    }

    return saved;
  }

  /**
   * Push goes to whoever operates the dashboard, while the feed row stays
   * addressed to the landlord (attribution + read-side scoping). For a
   * LANDLORD-addressed notification that is the managing admin
   * (`accounts.creator_id`); legacy landlords with no admin keep their own
   * push. Non-landlord recipients (tenant-addressed rows exist, e.g. the
   * properties tenant flows) are never redirected.
   */
  private async resolvePushTargetId(ownerAccountId: string): Promise<string> {
    const account = await this.accountRepository.findOne({
      where: { id: ownerAccountId },
      select: { id: true, roles: true, creator_id: true },
    });
    if (!account || !accountHasRole(account, RolesEnum.LANDLORD)) {
      return ownerAccountId;
    }
    return account.creator_id ?? ownerAccountId;
  }

  private getPushTitle(type?: string): string {
    switch (type) {
      case NotificationType.KYC_SUBMITTED:
        return 'New KYC Application';
      case NotificationType.MAINTENANCE_REQUEST:
        return 'Maintenance Request';
      case NotificationType.OFFER_LETTER_SENT:
        return 'Offer Letter Sent';
      case NotificationType.OFFER_LETTER_ACCEPTED:
        return 'Offer Letter Accepted';
      case NotificationType.OFFER_LETTER_REJECTED:
        return 'Offer Letter Declined';
      case NotificationType.PROPERTY_CREATED:
        return 'Property Created';
      case NotificationType.TENANT_ATTACHED:
        return 'Tenant Added';
      case NotificationType.TENANCY_ENDED:
        return 'Tenancy Ended';
      case NotificationType.RENEWAL_DEACTIVATED:
        return 'Renewal Deactivated';
      case NotificationType.REMOVAL_SCHEDULED:
        return 'Removal Scheduled';
      case NotificationType.SCHEDULED_END_CANCELLED:
        return 'Scheduled End Cancelled';
      case NotificationType.TENANCY_RENEWED:
        return 'Tenancy Renewed';
      case NotificationType.APPLICANT_HANDOFF:
        return 'Applicant Needs Help';
      case NotificationType.LANDLORD_ADDED:
        return 'Landlord Added';
      case NotificationType.ONBOARDING_SUBMITTED:
        return 'Onboarding Application';
      case NotificationType.NOTICE_AGREEMENT:
        return 'Notice Agreement';
      case NotificationType.PAYMENT_RECEIVED:
        return 'Payment Received';
      case NotificationType.INVOICE_GENERATED:
        return 'Invoice Generated';
      case NotificationType.INVOICE_SENT:
        return 'Invoice Sent';
      case NotificationType.INVOICE_VIEWED:
        return 'Invoice Viewed';
      case NotificationType.RECEIPT_ISSUED:
        return 'Receipt Issued';
      case NotificationType.RECEIPT_SENT:
        return 'Receipt Sent';
      case NotificationType.RECEIPT_VIEWED:
        return 'Receipt Viewed';
      case NotificationType.RENT_REMINDER:
        return 'Rent Reminder';
      case NotificationType.PAYMENT_PLAN_INSTALLMENT_REMINDER:
        return 'Installment Reminder';
      case NotificationType.RENEWAL_LINK_SENT:
        return 'Renewal Link Sent';
      case NotificationType.RENEWAL_PAYMENT_RECEIVED:
        return 'Renewal Payment Received';
      case NotificationType.OUTSTANDING_BALANCE_RECORDED:
        return 'Outstanding Balance Recorded';
      case NotificationType.USER_ADDED_HISTORY:
        return 'History Entry Added';
      case NotificationType.PAYMENT_TRANSFER_REJECTED:
        return 'Payment Transfer Rejected';
      case NotificationType.RENT_REMINDER_FAILED:
        return 'Rent Reminder Failed';
      case NotificationType.MAINTENANCE_CONFIRMATION_REMINDER:
        return 'Maintenance Reminder';
      case NotificationType.MAINTENANCE_AUTO_CLOSED:
        return 'Maintenance Request Closed';
      default:
        return 'Panda Homes';
    }
  }

  // Scoped "all notifications" for the live feed: the requester's own plus, for
  // an admin, every managed landlord's. Replaces the old unscoped global read.
  async findAll(requesterId: string): Promise<Notification[]> {
    const ownerIds = await this.resolveNotificationOwnerIds(requesterId);
    if (!ownerIds.length) return [];
    return await this.notificationRepository.find({
      where: { user_id: In(ownerIds) },
      order: { date: 'DESC' },
    });
  }

  // Unscoped by-id read for INTERNAL callers (e.g. update()'s re-fetch). The
  // public/by-id endpoint must use findOneForRequester instead.
  async findOne(id: string): Promise<Notification | null> {
    return await this.notificationRepository.findOneBy({ id });
  }

  async findOneForRequester(
    id: string,
    requesterId: string,
  ): Promise<Notification | null> {
    const notification = await this.notificationRepository.findOne({
      where: { id },
      relations: ['property'],
    });
    if (!notification) return null;
    // In scope when the notification targets the requester (or a managed
    // landlord), or sits on a property such an owner owns.
    const ownerIds = await this.resolveNotificationOwnerIds(requesterId);
    const inScope =
      (notification.user_id && ownerIds.includes(notification.user_id)) ||
      (notification.property?.owner_id &&
        ownerIds.includes(notification.property.owner_id));
    return inScope ? notification : null;
  }

  async findByPropertyId(
    property_id: string,
    requesterId: string,
  ): Promise<Notification[]> {
    const ownerIds = await this.resolveNotificationOwnerIds(requesterId);
    if (!ownerIds.length) return [];
    return await this.notificationRepository
      .createQueryBuilder('notification')
      .leftJoinAndSelect('notification.property', 'property')
      .where('notification.property_id = :property_id', { property_id })
      .andWhere('property.owner_id IN (:...ownerIds)', { ownerIds })
      .getMany();
  }

  // Looks up all notifications connected to properties owned by a specific user.
  // Loads related data (property, tenants, maintenanceRequest) in one query.
  // Sorts them by date (newest first).
  // Returns the full list as a Promise.
  async findByUserId(
    user_id: string,
    options: { page: number; limit: number; search?: string },
  ): Promise<{
    notifications: (Notification & { landlord_name: string | null })[];
    total: number;
  }> {
    console.log(
      `Finding notifications for user_id: ${user_id} with page: ${options.page}, limit: ${options.limit}`,
    );

    const { page = 1, limit = 20 } = options;
    const skip = (page - 1) * limit;

    // Admin live feed spans the managed landlords (operational notifications
    // carry user_id = the landlord's account id); a non-admin sees just their
    // own. resolveNotificationOwnerIds returns [self] when nothing is managed.
    const ownerIds = await this.resolveNotificationOwnerIds(user_id);
    if (!ownerIds.length) return { notifications: [], total: 0 };

    const query = this.notificationRepository
      .createQueryBuilder('notification')
      .leftJoinAndSelect('notification.property', 'property')
      .leftJoinAndSelect('property.property_tenants', 'property_tenants')
      .leftJoinAndSelect('property_tenants.tenant', 'tenant')
      .leftJoinAndSelect(
        'notification.maintenanceRequest',
        'maintenanceRequest',
      )
      // Common-area maintenance requests carry no property_id (a common area
      // hangs off the landlord account, not a property), so the property join
      // above yields null for them. Carry the common area through instead — the
      // feed falls back to its name for the "Property:" line.
      .leftJoin('maintenanceRequest.common_area', 'mrCommonArea')
      .addSelect(['mrCommonArea.id', 'mrCommonArea.name'])
      // Owning landlord's account, name columns only (never leak the full
      // account row — it carries the password hash).
      .leftJoin('notification.user', 'owner')
      .leftJoin('owner.user', 'ownerUser')
      .addSelect([
        'owner.id',
        'owner.profile_name',
        'ownerUser.id',
        'ownerUser.first_name',
        'ownerUser.last_name',
      ])
      .where('notification.user_id IN (:...ownerIds)', { ownerIds });

    // Server-side Live Feed search: match the normalized, denormalized
    // search_text (pg_trgm GIN-indexed). Normalize the term the same way it was
    // baked so accents/case agree. Escape LIKE wildcards in user input.
    const term = this.util.normalizeSearchText(options.search);
    if (term) {
      const escaped = term.replace(/[\\%_]/g, (m) => '\\' + m);
      query.andWhere('notification.search_text LIKE :term', {
        term: `%${escaped}%`,
      });
    }

    query.orderBy('notification.date', 'DESC').skip(skip).take(limit);

    const [rows, total] = await query.getManyAndCount();

    // The admin feed spans several landlords, so each row carries the owning
    // landlord's display name (accounts.profile_name, else the person's name).
    const notifications = rows.map((row) => {
      const { user: owner, ...rest } = row;
      const landlord_name =
        owner?.profile_name ||
        [owner?.user?.first_name, owner?.user?.last_name]
          .filter(Boolean)
          .join(' ') ||
        null;
      return { ...rest, landlord_name } as Notification & {
        landlord_name: string | null;
      };
    });

    return { notifications, total };
  }

  async findByMaintenanceRequestId(
    maintenance_request_id: string,
  ): Promise<Notification | null> {
    return await this.notificationRepository.findOne({
      where: { maintenance_request_id },
    });
  }

  async update(
    id: string,
    updateData: Partial<Notification>,
  ): Promise<Notification> {
    await this.notificationRepository.update(id, updateData);
    const updated = await this.findOne(id);
    if (!updated) {
      throw new Error(`Notification with id ${id} not found`);
    }
    return updated;
  }
}
