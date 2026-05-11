import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CreateServiceRequestDto,
  ServiceRequestCreatorTypeEnum,
  ServiceRequestFilter,
  ServiceRequestScopeEnum,
  ServiceRequestStatusEnum,
} from './dto/create-service-request.dto';
import { UpdateServiceRequestResponseDto } from './dto/update-service-request.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { ServiceRequest } from './entities/service-request.entity';
import { ServiceRequestStatusHistory } from './entities/service-request-status-history.entity';
import { In, Repository } from 'typeorm';
import { buildServiceRequestFilter } from 'src/filters/query-filter';
import { UtilService } from 'src/utils/utility-service';
import { config } from 'src/config';
import { TenantStatusEnum } from 'src/properties/dto/create-property.dto';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { Property } from 'src/properties/entities/property.entity';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TeamMember } from 'src/users/entities/team-member.entity';
import { RolesEnum } from 'src/base.entity';

export interface TawkWebhookPayload {
  event: 'chat:start' | 'chat:end';
  chatId: string;
  time: string;
  message?: {
    text: string;
    type: string;
    sender: {
      type: 'visitor' | 'agent';
    };
  };
  visitor: {
    name: string;
    email: string;
    city: string;
    country: string;
  };
  property: {
    id: string;
    name: string;
  };
}

interface RequestActor {
  id: string;
  role: string;
}

@Injectable()
export class ServiceRequestsService {
  private readonly logger = new Logger(ServiceRequestsService.name);

  constructor(
    @InjectRepository(ServiceRequest)
    private readonly serviceRequestRepository: Repository<ServiceRequest>,
    @InjectRepository(ServiceRequestStatusHistory)
    private readonly statusHistoryRepository: Repository<ServiceRequestStatusHistory>,
    @InjectRepository(PropertyTenant)
    private readonly propertyTenantRepository: Repository<PropertyTenant>,
    @InjectRepository(Property)
    private readonly propertyRepository: Repository<Property>,
    @InjectRepository(TeamMember)
    private readonly teamMemberRepository: Repository<TeamMember>,
    private readonly eventEmitter: EventEmitter2,
    private readonly utilService: UtilService,
  ) {}

  async createServiceRequest(
    data: CreateServiceRequestDto,
    actor?: RequestActor,
  ): Promise<any> {
    if (actor?.role === RolesEnum.FACILITY_MANAGER) {
      return this.createServiceRequestAsFacilityManager(data, actor);
    }
    return this.createServiceRequestAsTenant(data, actor);
  }

  private async createServiceRequestAsTenant(
    data: CreateServiceRequestDto,
    actor?: RequestActor,
  ): Promise<any> {
    const tenantUserId = actor?.id;
    if (!tenantUserId) {
      throw new HttpException(
        'Authentication required',
        HttpStatus.UNAUTHORIZED,
      );
    }

    // Resolve the tenant's PropertyTenant row for this property — confirms
    // active tenancy AND gives us the Account.id (not the User.id) for the
    // tenant_id column.
    const tenantExistInProperty = await this.propertyTenantRepository.findOne({
      where: {
        tenant: { user: { id: tenantUserId } },
        property_id: data.property_id,
        status: TenantStatusEnum.ACTIVE,
      },
      relations: [
        'tenant',
        'tenant.user',
        'property',
        'property.facility_manager',
        'property.facility_manager.account',
        'property.facility_manager.account.user',
      ],
    });

    if (!tenantExistInProperty?.id) {
      throw new HttpException(
        'You are not currently renting this property',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const assignedFm = tenantExistInProperty.property.facility_manager;
    const selected_managers = assignedFm?.account?.user?.phone_number
      ? [
          {
            phone_number: this.utilService.normalizePhoneNumber(
              assignedFm.account.user.phone_number,
            ),
            name: this.utilService.toSentenceCase(
              assignedFm.account.user.first_name,
            ),
          },
        ]
      : [];

    const requestId = this.utilService.generateServiceRequestId();
    const tenantName =
      `${tenantExistInProperty.tenant.user.first_name} ${tenantExistInProperty.tenant.user.last_name}`.trim();

    const request = this.serviceRequestRepository.create({
      request_id: requestId,
      tenant_id: tenantExistInProperty.tenant.id,
      property_id: tenantExistInProperty.property?.id,
      tenant_name: tenantName,
      property_name: tenantExistInProperty.property?.name,
      issue_category: 'service',
      date_reported: new Date(),
      description: data.text,
      status: ServiceRequestStatusEnum.NOT_APPROVED,
      scope: data.scope ?? ServiceRequestScopeEnum.UNIT,
      is_urgent: data.is_urgent ?? false,
      creator_type: ServiceRequestCreatorTypeEnum.TENANT,
      creator_user_id: tenantExistInProperty.tenant.user.id,
    });

    const savedRequest = await this.serviceRequestRepository.save(request);

    await this.createStatusHistoryEntry(
      savedRequest.id,
      null,
      ServiceRequestStatusEnum.NOT_APPROVED,
      tenantExistInProperty.tenant.user.id,
      'tenant',
      'Service request created',
    );

    try {
      this.eventEmitter.emit('service.created', {
        user_id: tenantExistInProperty.tenant.id,
        property_id: tenantExistInProperty.property?.id,
        landlord_id: tenantExistInProperty.property?.owner_id,
        tenant_name: tenantName,
        property_name: tenantExistInProperty.property.name,
        service_request_id: savedRequest.id,
        description: data.text,
        created_at: savedRequest.created_at,
        creator_type: ServiceRequestCreatorTypeEnum.TENANT,
        scope: savedRequest.scope,
        is_urgent: savedRequest.is_urgent,
      });
    } catch (error) {
      this.logger.error('Failed to emit service.created event:', error);
    }

    return {
      ...savedRequest,
      property_name: tenantExistInProperty.property?.name,
      property_location: tenantExistInProperty.property?.location,
      facility_managers: selected_managers,
    };
  }

  private async createServiceRequestAsFacilityManager(
    data: CreateServiceRequestDto,
    actor: RequestActor,
  ): Promise<any> {
    // Verify the FM is assigned to this property. Properties have a single
    // facility_manager_id pointing to a team_member row whose account belongs
    // to the FM's user. Walk: user -> team_member rows -> property fk match.
    const fmTeamMembers = await this.teamMemberRepository.find({
      where: {
        account: { user: { id: actor.id } },
        role: RolesEnum.FACILITY_MANAGER,
      },
      relations: ['account', 'account.user'],
    });
    if (fmTeamMembers.length === 0) {
      throw new HttpException(
        'You are not registered as a facility manager',
        HttpStatus.FORBIDDEN,
      );
    }

    const property = await this.propertyRepository.findOne({
      where: {
        id: data.property_id,
        facility_manager_id: In(fmTeamMembers.map((t) => t.id)),
      },
    });
    if (!property) {
      throw new HttpException(
        'You are not assigned to this property',
        HttpStatus.FORBIDDEN,
      );
    }

    const fmUser = fmTeamMembers[0].account?.user;
    const fmName = fmUser
      ? `${fmUser.first_name ?? ''} ${fmUser.last_name ?? ''}`.trim() ||
        'Facility Manager'
      : 'Facility Manager';

    const request = this.serviceRequestRepository.create({
      request_id: this.utilService.generateServiceRequestId(),
      tenant_id: null,
      property_id: property.id,
      tenant_name: '—',
      property_name: property.name,
      issue_category: 'service',
      date_reported: new Date(),
      description: data.text,
      status: ServiceRequestStatusEnum.NOT_APPROVED,
      scope: data.scope ?? ServiceRequestScopeEnum.COMMON_AREA,
      is_urgent: data.is_urgent ?? false,
      creator_type: ServiceRequestCreatorTypeEnum.FACILITY_MANAGER,
      creator_user_id: actor.id,
      assigned_to: fmTeamMembers[0].id,
    });

    const savedRequest = await this.serviceRequestRepository.save(request);

    await this.createStatusHistoryEntry(
      savedRequest.id,
      null,
      ServiceRequestStatusEnum.NOT_APPROVED,
      actor.id,
      'facility_manager',
      `Service request created by ${fmName}`,
    );

    try {
      this.eventEmitter.emit('service.created', {
        user_id: actor.id,
        property_id: property.id,
        landlord_id: property.owner_id,
        tenant_name: '—',
        property_name: property.name,
        service_request_id: savedRequest.id,
        description: data.text,
        created_at: savedRequest.created_at,
        creator_type: ServiceRequestCreatorTypeEnum.FACILITY_MANAGER,
        creator_name: fmName,
        scope: savedRequest.scope,
        is_urgent: savedRequest.is_urgent,
      });
    } catch (error) {
      this.logger.error('Failed to emit service.created event:', error);
    }

    return {
      ...savedRequest,
      property_name: property.name,
      property_location: property.location,
    };
  }

  async getAllServiceRequests(
    user_id: string,
    queryParams: ServiceRequestFilter,
    role?: string,
  ) {
    const page = queryParams?.page
      ? Number(queryParams?.page)
      : config.DEFAULT_PAGE_NO;
    const size = queryParams?.size
      ? Number(queryParams.size)
      : config.DEFAULT_PER_PAGE;
    const skip = (page - 1) * size;

    const query = await buildServiceRequestFilter(queryParams);

    let propertyFilter: Record<string, unknown>;
    if (role === RolesEnum.FACILITY_MANAGER) {
      const myTeamMemberships = await this.teamMemberRepository.find({
        where: {
          account: { user: { id: user_id } },
          role: RolesEnum.FACILITY_MANAGER,
        },
        relations: ['account', 'account.user'],
        select: { id: true },
      });
      const tmIds = myTeamMemberships.map((m) => m.id);
      if (tmIds.length === 0) {
        return {
          service_requests: [],
          pagination: {
            totalRows: 0,
            perPage: size,
            currentPage: page,
            totalPages: 0,
            hasNextPage: false,
          },
        };
      }
      propertyFilter = { facility_manager_id: In(tmIds) };
    } else {
      propertyFilter = { owner_id: user_id };
    }

    const [serviceRequests, count] =
      await this.serviceRequestRepository.findAndCount({
        where: {
          ...query,
          property: propertyFilter,
        },
        relations: [
          'tenant',
          'tenant.user',
          'creator',
          'property',
          'statusHistory',
          'statusHistory.changedBy',
        ],
        skip,
        take: size,
        order: {
          created_at: 'DESC',
          statusHistory: {
            changed_at: 'ASC',
          },
        },
      });

    const totalPages = Math.ceil(count / size);
    return {
      service_requests: serviceRequests,
      pagination: {
        totalRows: count,
        perPage: size,
        currentPage: page,
        totalPages,
        hasNextPage: page < totalPages,
      },
    };
  }

  async getServiceRequestById(id: string, userId: string): Promise<any> {
    const serviceRequest = await this.serviceRequestRepository.findOne({
      where: { id },
      relations: [
        'tenant',
        'tenant.user',
        'creator',
        'property',
        'statusHistory',
        'statusHistory.changedBy',
      ],
      order: {
        statusHistory: {
          changed_at: 'ASC',
        },
      },
    });
    if (!serviceRequest?.id) {
      throw new HttpException(
        `Service request with id: ${id} not found`,
        HttpStatus.NOT_FOUND,
      );
    }

    await this.assertCanRead(serviceRequest, userId);
    return serviceRequest;
  }

  async getServiceRequestByTenant(id: string, status?: string) {
    const statuses = Array.isArray(status)
      ? status
      : status
        ? [status]
        : [
            ServiceRequestStatusEnum.NOT_APPROVED,
            ServiceRequestStatusEnum.APPROVED,
            ServiceRequestStatusEnum.RESOLVED,
            ServiceRequestStatusEnum.REOPENED,
          ];

    return this.serviceRequestRepository.find({
      where: {
        tenant_id: id,
        status: In(statuses),
      },
      relations: [
        'tenant',
        'tenant.user',
        'creator',
        'property',
        'statusHistory',
        'statusHistory.changedBy',
      ],
      order: {
        created_at: 'DESC',
        statusHistory: {
          changed_at: 'ASC',
        },
      },
    });
  }

  async updateServiceRequestById(
    id: string,
    data: UpdateServiceRequestResponseDto,
    userId: string,
  ) {
    const serviceRequest = await this.serviceRequestRepository.findOne({
      where: { id },
      relations: ['property'],
    });
    if (!serviceRequest) {
      throw new HttpException(
        'Service request not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const actorRole = await this.resolveActorRole(serviceRequest, userId);
    if (!actorRole) {
      throw new HttpException(
        'You do not have permission to update this service request',
        HttpStatus.FORBIDDEN,
      );
    }

    const previousStatus = serviceRequest.status;
    const targetStatus = data.status;

    // Validate status transition (if any) before mutating anything else. The
    // REOPENED→REOPENED self-loop is the race case (both FM and tenant try to
    // reopen) — it's allowed by the state machine but handled below as an
    // additional history-only entry, with no entity mutation.
    if (targetStatus !== undefined && targetStatus !== previousStatus) {
      this.assertValidStatusTransition(
        previousStatus,
        targetStatus,
        actorRole,
        serviceRequest.creator_type,
        data.reopen_message,
      );
    }
    const isReopenSelfLoop =
      targetStatus === ServiceRequestStatusEnum.REOPENED &&
      previousStatus === ServiceRequestStatusEnum.REOPENED;
    if (isReopenSelfLoop) {
      this.assertValidStatusTransition(
        previousStatus,
        targetStatus,
        actorRole,
        serviceRequest.creator_type,
        data.reopen_message,
      );
    }

    // is_urgent toggle is landlord-only.
    if (
      data.is_urgent !== undefined &&
      data.is_urgent !== serviceRequest.is_urgent &&
      actorRole !== 'landlord'
    ) {
      throw new HttpException(
        'Only the landlord can change the urgent flag',
        HttpStatus.FORBIDDEN,
      );
    }

    // Resolve transitions require a summary + category — those columns hold
    // the data the FM enters in the ResolutionModal.
    if (
      targetStatus === ServiceRequestStatusEnum.RESOLVED &&
      previousStatus !== ServiceRequestStatusEnum.RESOLVED
    ) {
      if (!data.resolution_summary || !data.resolution_summary.trim()) {
        throw new HttpException(
          'resolution_summary is required when marking a request as resolved',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (!data.resolution_category) {
        throw new HttpException(
          'resolution_category is required when marking a request as resolved',
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    // ── Race-case short-circuit ────────────────────────────────────────────
    // First-write-won. Don't mutate the entity; just append a history row
    // capturing this caller's reopen_message so both voices are preserved.
    if (isReopenSelfLoop) {
      await this.appendReopenNoteWithDedup(
        id,
        userId,
        actorRole,
        data.reopen_message ?? '',
      );
      const refreshed = await this.serviceRequestRepository.findOne({
        where: { id },
        relations: ['property'],
      });
      return { ...(refreshed as ServiceRequest), alreadyReopened: true };
    }

    const safeUpdate: Partial<ServiceRequest> = {};
    if (targetStatus !== undefined) safeUpdate.status = targetStatus;
    if (data.is_urgent !== undefined) safeUpdate.is_urgent = data.is_urgent;
    if (data.description !== undefined)
      safeUpdate.description = data.description;
    if (data.issue_category !== undefined)
      safeUpdate.issue_category = data.issue_category;
    if (data.date_reported !== undefined)
      safeUpdate.date_reported = data.date_reported;
    if (data.resolution_date !== undefined)
      safeUpdate.resolution_date = data.resolution_date;
    if (data.issue_images !== undefined)
      safeUpdate.issue_images = data.issue_images;

    if (targetStatus === ServiceRequestStatusEnum.RESOLVED) {
      safeUpdate.resolution_date = new Date();
      safeUpdate.resolvedAt = new Date();
      safeUpdate.resolution_summary = data.resolution_summary;
      safeUpdate.resolution_category = data.resolution_category;
      safeUpdate.resolution_cost_minor =
        data.resolution_cost_minor ?? null;
    }
    if (targetStatus === ServiceRequestStatusEnum.REOPENED) {
      safeUpdate.reopened_at = new Date();
    }

    if (Object.keys(safeUpdate).length > 0) {
      await this.serviceRequestRepository.update(id, safeUpdate);
    }

    const updatedServiceRequest = await this.serviceRequestRepository.findOne({
      where: { id },
      relations: ['property'],
    });

    if (targetStatus && targetStatus !== previousStatus) {
      const reasonParts: string[] = [
        `Status updated via API from ${previousStatus} to ${targetStatus}`,
      ];
      if (
        targetStatus === ServiceRequestStatusEnum.REOPENED &&
        data.reopen_message
      ) {
        reasonParts.push(`Reopen reason: ${data.reopen_message}`);
      }
      await this.createStatusHistoryEntry(
        id,
        previousStatus,
        targetStatus,
        userId,
        actorRole,
        reasonParts.join(' — '),
        data.reopen_message,
      );
    }

    if (
      updatedServiceRequest &&
      (targetStatus || data.description || data.is_urgent !== undefined)
    ) {
      this.eventEmitter.emit('service.updated', {
        request_id: updatedServiceRequest.id,
        status: updatedServiceRequest.status,
        previous_status: previousStatus,
        is_urgent: updatedServiceRequest.is_urgent,
        tenant_name: updatedServiceRequest.tenant_name,
        property_name: updatedServiceRequest.property_name,
        property_id: updatedServiceRequest.property_id,
        landlord_id: updatedServiceRequest.property?.owner_id,
        tenant_id: updatedServiceRequest.tenant_id,
        creator_type: updatedServiceRequest.creator_type,
        creator_user_id: updatedServiceRequest.creator_user_id,
        description: updatedServiceRequest.description,
        updated_at: new Date(),
        actor: { id: userId, role: actorRole },
      });
    }

    return updatedServiceRequest;
  }

  /**
   * Records a "reopen note" history row for a request that's already in the
   * REOPENED state. Skips the insert if the same user submitted the same
   * reopen_message within the last 2 seconds — defends against double-clicks
   * on the FE.
   */
  private async appendReopenNoteWithDedup(
    serviceRequestId: string,
    userId: string,
    actorRole: 'landlord' | 'tenant' | 'facility_manager',
    reopenMessage: string,
  ): Promise<void> {
    const recent = await this.statusHistoryRepository
      .createQueryBuilder('h')
      .where('h.service_request_id = :id', { id: serviceRequestId })
      .andWhere('h.changed_by_user_id = :userId', { userId })
      .andWhere('h.notes = :notes', { notes: reopenMessage })
      .andWhere(`h.changed_at > NOW() - INTERVAL '2 seconds'`)
      .getOne();
    if (recent) return;

    await this.createStatusHistoryEntry(
      serviceRequestId,
      ServiceRequestStatusEnum.REOPENED,
      ServiceRequestStatusEnum.REOPENED,
      userId,
      actorRole,
      'additional_reopen_note',
      reopenMessage,
    );
  }

  async deleteServiceRequestById(id: string, userId: string) {
    const serviceRequest = await this.serviceRequestRepository.findOne({
      where: { id },
      relations: ['property'],
    });
    if (!serviceRequest) {
      throw new HttpException(
        'Service request not found',
        HttpStatus.NOT_FOUND,
      );
    }
    if (
      serviceRequest.tenant_id !== userId &&
      serviceRequest.creator_user_id !== userId &&
      serviceRequest.property.owner_id !== userId
    ) {
      throw new HttpException(
        'You do not have permission to delete this service request',
        HttpStatus.FORBIDDEN,
      );
    }
    return this.serviceRequestRepository.softDelete(id);
  }

  async getPendingAndUrgentRequests(
    queryParams: ServiceRequestFilter,
    owner_id: string,
  ) {
    const page = queryParams?.page
      ? Number(queryParams?.page)
      : config.DEFAULT_PAGE_NO;
    const size = queryParams?.size
      ? Number(queryParams.size)
      : config.DEFAULT_PER_PAGE;
    const skip = (page - 1) * size;

    const query = await buildServiceRequestFilter(queryParams);

    // "Needs attention": still awaiting landlord approval OR flagged urgent
    // (regardless of where it sits in the lifecycle).
    const [serviceRequests, count] = await this.serviceRequestRepository
      .createQueryBuilder('sr')
      .leftJoinAndSelect('sr.tenant', 'tenant')
      .leftJoinAndSelect('tenant.user', 'tenantUser')
      .leftJoinAndSelect('sr.creator', 'creator')
      .leftJoinAndSelect('sr.property', 'property')
      .leftJoinAndSelect('sr.statusHistory', 'history')
      .leftJoinAndSelect('history.changedBy', 'changedBy')
      .where('property.owner_id = :owner_id', { owner_id })
      .andWhere('(sr.status = :notApproved OR sr.is_urgent = :urgent)', {
        notApproved: ServiceRequestStatusEnum.NOT_APPROVED,
        urgent: true,
      })
      .andWhere(query?.['status'] ? 'sr.status = :statusFilter' : '1=1', {
        statusFilter: query?.['status'],
      })
      .orderBy('sr.created_at', 'DESC')
      .skip(skip)
      .take(size)
      .getManyAndCount();

    const totalPages = Math.ceil(count / size);
    return {
      service_requests: serviceRequests,
      pagination: {
        totalRows: count,
        perPage: size,
        currentPage: page,
        totalPages,
        hasNextPage: page < totalPages,
      },
    };
  }

  async getServiceRequestsByTenant(
    tenant_id: string,
    queryParams: ServiceRequestFilter,
  ) {
    const page = queryParams?.page
      ? Number(queryParams?.page)
      : config.DEFAULT_PAGE_NO;
    const size = queryParams?.size
      ? Number(queryParams.size)
      : config.DEFAULT_PER_PAGE;
    const skip = (page - 1) * size;
    const [serviceRequests, count] =
      await this.serviceRequestRepository.findAndCount({
        where: {
          tenant_id,
        },
        relations: [
          'tenant',
          'tenant.user',
          'creator',
          'property',
          'statusHistory',
          'statusHistory.changedBy',
        ],
        skip,
        take: size,
        order: {
          created_at: 'DESC',
          statusHistory: {
            changed_at: 'ASC',
          },
        },
      });
    const totalPages = Math.ceil(count / size);
    return {
      service_requests: serviceRequests,
      pagination: {
        totalRows: count,
        perPage: size,
        currentPage: page,
        totalPages,
        hasNextPage: page < totalPages,
      },
    };
  }

  async getRequestById(id: string): Promise<ServiceRequest> {
    const request = await this.serviceRequestRepository.findOne({
      where: { id },
      relations: ['messages', 'statusHistory', 'statusHistory.changedBy'],
      order: {
        statusHistory: {
          changed_at: 'ASC',
        },
      },
    });

    if (!request) {
      throw new NotFoundException('Service request not found');
    }

    return request;
  }

  /**
   * Returns the audit trail for a request: who transitioned it, when, why.
   * Permission set matches getServiceRequestById — caller must be landlord,
   * tenant on the request, the creator, or the assigned FM.
   */
  async getStatusHistory(id: string, userId: string) {
    const serviceRequest = await this.serviceRequestRepository.findOne({
      where: { id },
      relations: ['property'],
    });
    if (!serviceRequest) {
      throw new HttpException(
        'Service request not found',
        HttpStatus.NOT_FOUND,
      );
    }
    await this.assertCanRead(serviceRequest, userId);

    return this.statusHistoryRepository.find({
      where: { service_request_id: id },
      relations: ['changedBy'],
      order: { changed_at: 'ASC' },
    });
  }

  /**
   * Activity feed for a facility manager: every status_history row across
   * every service request on properties the FM manages, ordered DESC by
   * changed_at. Includes the creation event (history rows with
   * previous_status IS NULL).
   *
   * Cursor pagination on (changed_at, id) — pass the last seen pair back as
   * `cursor` to fetch the next page. Defends against duplicate rows when new
   * activity is inserted while the user is paginating.
   */
  async getActivityFeedForFacilityManager(
    userId: string,
    options?: {
      cursor?: { changed_at: string; id: string };
      size?: number;
      landlordId?: string;
    },
  ) {
    const size = Math.min(Math.max(options?.size ?? 20, 1), 100);

    const teamMemberships = await this.teamMemberRepository.find({
      where: {
        account: { user: { id: userId } },
        role: RolesEnum.FACILITY_MANAGER,
      },
      relations: ['account', 'account.user'],
      select: { id: true },
    });
    const tmIds = teamMemberships.map((tm) => tm.id);
    if (tmIds.length === 0) {
      return { items: [], pagination: { nextCursor: null, hasNextPage: false } };
    }

    const qb = this.statusHistoryRepository
      .createQueryBuilder('h')
      .innerJoinAndSelect('h.serviceRequest', 'sr')
      .innerJoinAndSelect('sr.property', 'property')
      .leftJoinAndSelect('h.changedBy', 'actor')
      .leftJoinAndSelect('sr.tenant', 'tenant')
      .leftJoinAndSelect('tenant.user', 'tenantUser')
      .leftJoinAndSelect('sr.creator', 'creator')
      .where('property.facility_manager_id IN (:...tmIds)', { tmIds })
      .andWhere('sr.deleted_at IS NULL');

    if (options?.landlordId) {
      qb.andWhere('property.owner_id = :landlordId', {
        landlordId: options.landlordId,
      });
    }

    if (options?.cursor) {
      qb.andWhere(
        '(h.changed_at, h.id) < (:cursorChangedAt, :cursorId)',
        {
          cursorChangedAt: options.cursor.changed_at,
          cursorId: options.cursor.id,
        },
      );
    }

    const rows = await qb
      .orderBy('h.changed_at', 'DESC')
      .addOrderBy('h.id', 'DESC')
      .take(size + 1)
      .getMany();

    const hasNextPage = rows.length > size;
    const trimmed = hasNextPage ? rows.slice(0, size) : rows;
    const nextCursor = hasNextPage
      ? {
          changed_at: trimmed[trimmed.length - 1].changed_at.toISOString(),
          id: trimmed[trimmed.length - 1].id,
        }
      : null;

    const titleByEvent: Record<string, string> = {
      created: 'Issue reported',
      approved: 'Approved by landlord',
      resolved: 'Issue marked as resolved',
      reopened: 'Issue reopened',
      reopen_note: 'Additional reopen note',
      closed: 'Issue closed',
      not_approved: 'Issue reported',
    };
    const fullName = (f?: string | null, l?: string | null) =>
      [f, l].filter(Boolean).join(' ') || null;

    const items = trimmed.map((h) => {
      const sr = h.serviceRequest;
      const isCreation = h.previous_status === null;
      const isReopenNote =
        h.previous_status === ServiceRequestStatusEnum.REOPENED &&
        h.new_status === ServiceRequestStatusEnum.REOPENED;

      const event_type = isCreation
        ? 'created'
        : isReopenNote
          ? 'reopen_note'
          : (h.new_status as string);

      const title = titleByEvent[event_type] ?? `Status: ${h.new_status}`;
      const description = isCreation
        ? sr.description
        : h.notes || h.change_reason || '';

      const actor_name =
        fullName(h.changedBy?.first_name, h.changedBy?.last_name) ||
        fullName(sr.tenant?.user?.first_name, sr.tenant?.user?.last_name) ||
        fullName(sr.creator?.first_name, sr.creator?.last_name) ||
        sr.tenant_name ||
        '—';

      return {
        id: h.id,
        event_type,
        title,
        description,
        request_id: sr.id,
        request_ref: sr.request_id,
        property_id: sr.property?.id ?? null,
        property_name: sr.property?.name ?? null,
        landlord_id: sr.property?.owner_id ?? null,
        actor_name,
        actor_role: h.changed_by_role,
        scope: sr.scope,
        creator_type: sr.creator_type,
        current_status: sr.status,
        changed_at: h.changed_at,
      };
    });

    return {
      items,
      pagination: { nextCursor, hasNextPage },
    };
  }

  /**
   * Per-property counts of common-area requests for the Common Areas tab.
   * Returns one row per property the landlord owns that has at least one
   * scope='common_area' request (lifetime; not filtered by status — the UI
   * may want to show all).
   */
  async getCommonAreaCountsByProperty(landlordId: string) {
    const rows = await this.serviceRequestRepository
      .createQueryBuilder('sr')
      .innerJoin('sr.property', 'property')
      .select('sr.property_id', 'property_id')
      .addSelect('property.name', 'property_name')
      .addSelect('property.location', 'property_location')
      .addSelect(`COUNT(*)::int`, 'count')
      .addSelect(
        `COUNT(*) FILTER (WHERE sr.status = :openStatus)::int`,
        'open_count',
      )
      .where('property.owner_id = :landlordId', { landlordId })
      .andWhere('sr.scope = :scope', {
        scope: ServiceRequestScopeEnum.COMMON_AREA,
      })
      .andWhere('sr.deleted_at IS NULL')
      .setParameter('openStatus', ServiceRequestStatusEnum.NOT_APPROVED)
      .groupBy('sr.property_id')
      .addGroupBy('property.name')
      .addGroupBy('property.location')
      .orderBy('count', 'DESC')
      .getRawMany();

    return rows.map((r) => ({
      property_id: r.property_id,
      property_name: r.property_name,
      property_location: r.property_location,
      total_requests: Number(r.count) || 0,
      open_requests: Number(r.open_count) || 0,
    }));
  }

  /**
   * Resolves the requesting user's effective role for a given request, used
   * to gate transitions and writes. Returns null if the user has no claim.
   */
  private async resolveActorRole(
    serviceRequest: ServiceRequest,
    userId: string,
  ): Promise<'landlord' | 'tenant' | 'facility_manager' | null> {
    if (serviceRequest.property.owner_id === userId) return 'landlord';
    if (
      serviceRequest.tenant_id &&
      (await this.isTenantUser(serviceRequest, userId))
    ) {
      return 'tenant';
    }
    if (serviceRequest.creator_user_id === userId) {
      // Creator might be the FM who reported it; FM-as-creator gets the
      // facility_manager role for transitions on their own request.
      return serviceRequest.creator_type ===
        ServiceRequestCreatorTypeEnum.FACILITY_MANAGER
        ? 'facility_manager'
        : 'tenant';
    }
    const fm = await this.teamMemberRepository.findOne({
      where: {
        team: { creatorId: serviceRequest.property.owner_id },
        account: { user: { id: userId } },
        role: RolesEnum.FACILITY_MANAGER,
      },
      relations: ['team', 'account', 'account.user'],
    });
    return fm ? 'facility_manager' : null;
  }

  private async isTenantUser(
    serviceRequest: ServiceRequest,
    userId: string,
  ): Promise<boolean> {
    if (!serviceRequest.tenant_id) return false;
    // tenant_id holds Account.id; resolve to user via tenant relation.
    const sr = await this.serviceRequestRepository.findOne({
      where: { id: serviceRequest.id },
      relations: ['tenant', 'tenant.user'],
    });
    return sr?.tenant?.user?.id === userId;
  }

  private async assertCanRead(
    serviceRequest: ServiceRequest,
    userId: string,
  ): Promise<void> {
    const role = await this.resolveActorRole(serviceRequest, userId);
    if (!role) {
      throw new HttpException(
        'You do not have permission to view this service request',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  /**
   * Enforces the lifecycle: not_approved → approved → resolved →
   * (closed | reopened → resolved → ...). Role policy:
   *   - landlord ONLY approves (NOT_APPROVED → APPROVED). No other transitions.
   *   - FM-on-this-property handles approve→resolve, reopen→resolve, and
   *     resolve→reopen on any request on the property regardless of creator.
   *   - tenant can confirm-resolution (RESOLVED → CLOSED) and reject-resolution
   *     (RESOLVED → REOPENED) on requests they filed.
   *   - REOPENED → REOPENED is permitted as a self-loop carrying an additional
   *     reopen_message (race case where FM and tenant both reopen). The caller
   *     in updateServiceRequestById skips the entity mutation and only logs a
   *     history row in that case.
   */
  private assertValidStatusTransition(
    from: ServiceRequestStatusEnum,
    to: ServiceRequestStatusEnum,
    actorRole: 'landlord' | 'tenant' | 'facility_manager',
    creatorType: ServiceRequestCreatorTypeEnum,
    reopenMessage?: string,
  ): void {
    const transition = `${from}->${to}`;
    const tenantIsCreator =
      creatorType === ServiceRequestCreatorTypeEnum.TENANT;
    const fmIsCreator =
      creatorType === ServiceRequestCreatorTypeEnum.FACILITY_MANAGER;

    switch (transition) {
      case `${ServiceRequestStatusEnum.NOT_APPROVED}->${ServiceRequestStatusEnum.APPROVED}`:
        if (actorRole !== 'landlord') {
          throw new HttpException(
            'Only the landlord can approve a service request',
            HttpStatus.FORBIDDEN,
          );
        }
        return;

      case `${ServiceRequestStatusEnum.APPROVED}->${ServiceRequestStatusEnum.RESOLVED}`:
      case `${ServiceRequestStatusEnum.REOPENED}->${ServiceRequestStatusEnum.RESOLVED}`:
        if (actorRole !== 'facility_manager') {
          throw new HttpException(
            'Only the assigned facility manager can mark this request as resolved',
            HttpStatus.FORBIDDEN,
          );
        }
        return;

      case `${ServiceRequestStatusEnum.RESOLVED}->${ServiceRequestStatusEnum.CLOSED}`: {
        const allowed =
          (tenantIsCreator && actorRole === 'tenant') ||
          (fmIsCreator && actorRole === 'facility_manager');
        if (!allowed) {
          throw new HttpException(
            `Only the original ${tenantIsCreator ? 'tenant' : 'facility manager'} who filed this request can close it`,
            HttpStatus.FORBIDDEN,
          );
        }
        return;
      }

      case `${ServiceRequestStatusEnum.RESOLVED}->${ServiceRequestStatusEnum.REOPENED}`:
      case `${ServiceRequestStatusEnum.REOPENED}->${ServiceRequestStatusEnum.REOPENED}`: {
        const allowed =
          actorRole === 'facility_manager' ||
          (tenantIsCreator && actorRole === 'tenant');
        if (!allowed) {
          throw new HttpException(
            'Only the tenant who filed this request or the assigned facility manager can reopen it',
            HttpStatus.FORBIDDEN,
          );
        }
        if (!reopenMessage || !reopenMessage.trim()) {
          throw new HttpException(
            'A reopen_message is required when reopening a resolved request',
            HttpStatus.BAD_REQUEST,
          );
        }
        return;
      }

      default:
        throw new HttpException(
          `Invalid status transition: ${from} → ${to}`,
          HttpStatus.BAD_REQUEST,
        );
    }
  }

  async updateStatus(
    id: string,
    status: ServiceRequestStatusEnum,
    notes?: string,
    actor?: { id?: string; role?: string; name?: string },
  ) {
    const request = await this.serviceRequestRepository.findOne({
      where: { id },
      relations: ['tenant', 'property'],
    });
    if (!request) throw new NotFoundException('Request not found');

    const previousStatus = request.status;
    request.status = status;
    if (notes) request.notes = notes;
    if (status === ServiceRequestStatusEnum.RESOLVED)
      request.resolution_date = new Date();
    if (status === ServiceRequestStatusEnum.REOPENED)
      request.reopened_at = new Date();

    const savedRequest = await this.serviceRequestRepository.save(request);

    if (actor?.id) {
      await this.createStatusHistoryEntry(
        savedRequest.id,
        previousStatus,
        status,
        actor.id,
        actor.role || 'system',
        `Status changed from ${previousStatus} to ${status}`,
        notes,
      );
    } else {
      this.logger.warn(
        `Status history entry skipped for request ${savedRequest.id}: no actor.id provided (${previousStatus} → ${status})`,
      );
    }

    this.eventEmitter.emit('service.updated', {
      request_id: savedRequest.id,
      status: savedRequest.status,
      previous_status: previousStatus,
      is_urgent: savedRequest.is_urgent,
      tenant_name: request.tenant_name,
      property_name: request.property_name,
      property_id: request.property_id,
      landlord_id: request.property?.owner_id,
      tenant_id: request.tenant_id,
      creator_type: request.creator_type,
      creator_user_id: request.creator_user_id,
      description: request.description,
      updated_at: new Date(),
      actor,
    });

    return savedRequest;
  }

  private async createStatusHistoryEntry(
    serviceRequestId: string,
    previousStatus: ServiceRequestStatusEnum | null,
    newStatus: ServiceRequestStatusEnum,
    changedByUserId: string,
    changedByRole: string,
    changeReason?: string,
    notes?: string,
  ): Promise<ServiceRequestStatusHistory> {
    const historyEntry = this.statusHistoryRepository.create({
      service_request_id: serviceRequestId,
      previous_status: previousStatus,
      new_status: newStatus,
      changed_by_user_id: changedByUserId,
      changed_by_role: changedByRole,
      change_reason: changeReason,
      notes: notes,
      changed_at: new Date(),
    });

    return await this.statusHistoryRepository.save(historyEntry);
  }

  async findFacilityManagerForProperty(
    propertyId: string,
  ): Promise<TeamMember[]> {
    const fm = await this.teamMemberRepository
      .createQueryBuilder('tm')
      .leftJoinAndSelect('tm.account', 'account')
      .leftJoinAndSelect('account.user', 'user')
      .innerJoin(
        'properties',
        'property',
        'property.facility_manager_id = tm.id AND property.id = :propertyId',
        { propertyId },
      )
      .getOne();
    return fm ? [fm] : [];
  }
}
