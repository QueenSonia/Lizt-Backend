import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CreateMaintenanceRequestDto,
  MaintenanceRequestCreatorTypeEnum,
  MaintenanceRequestFilter,
  MaintenanceRequestScopeEnum,
  MaintenanceRequestStatusEnum,
} from './dto/create-maintenance-request.dto';
import { UpdateMaintenanceRequestResponseDto } from './dto/update-maintenance-request.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { MaintenanceRequest } from './entities/maintenance-request.entity';
import { MaintenanceRequestStatusHistory } from './entities/maintenance-request-status-history.entity';
import {
  MaintenanceResolutionAttempt,
  ResolutionAttemptOutcomeEnum,
} from './entities/maintenance-resolution-attempt.entity';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { buildMaintenanceRequestFilter } from 'src/filters/query-filter';
import { UtilService } from 'src/utils/utility-service';
import { config } from 'src/config';
import { TenantStatusEnum } from 'src/properties/dto/create-property.dto';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { Property } from 'src/properties/entities/property.entity';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TeamMember } from 'src/users/entities/team-member.entity';
import { RolesEnum } from 'src/base.entity';
import { CommonArea } from 'src/common-areas/entities/common-area.entity';
import { Account } from 'src/users/entities/account.entity';
import { Users } from 'src/users/entities/user.entity';
import { ArtisansService } from 'src/artisans/artisans.service';
import { ManagementScopeService } from 'src/common/scope/management-scope.service';

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
export class MaintenanceRequestsService {
  private readonly logger = new Logger(MaintenanceRequestsService.name);

  constructor(
    @InjectRepository(MaintenanceRequest)
    private readonly maintenanceRequestRepository: Repository<MaintenanceRequest>,
    @InjectRepository(MaintenanceRequestStatusHistory)
    private readonly statusHistoryRepository: Repository<MaintenanceRequestStatusHistory>,
    @InjectRepository(MaintenanceResolutionAttempt)
    private readonly resolutionAttemptRepository: Repository<MaintenanceResolutionAttempt>,
    @InjectRepository(PropertyTenant)
    private readonly propertyTenantRepository: Repository<PropertyTenant>,
    @InjectRepository(Property)
    private readonly propertyRepository: Repository<Property>,
    @InjectRepository(TeamMember)
    private readonly teamMemberRepository: Repository<TeamMember>,
    @InjectRepository(CommonArea)
    private readonly commonAreaRepository: Repository<CommonArea>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly utilService: UtilService,
    private readonly artisansService: ArtisansService,
    private readonly scopeService: ManagementScopeService,
  ) {}

  /**
   * JWT sessions carry `account.id` as `req.user.id`. The status-history table's
   * `changed_by_user_id` column is FK'd to `users.id`, not `accounts.id`, so
   * inserting account.id directly triggers a 23503 FK violation that the
   * exception filter surfaces as a 400 "Invalid reference". Every dashboard
   * write path must resolve account → user.id before writing history.
   *
   * WhatsApp flows already pass `tenant.user.id` / `account.user.id` directly
   * so they bypass this helper.
   */
  private formatTeamMemberLabel(tm: TeamMember | null | undefined): string {
    if (!tm) return 'unassigned';
    const u = tm.account?.user;
    const name = u ? `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() : '';
    return name || tm.email || 'Facility Manager';
  }

  private async resolveActorUserId(accountId: string): Promise<string> {
    const account = await this.accountRepository.findOne({
      where: { id: accountId },
      relations: ['user'],
    });
    if (!account?.user?.id) {
      throw new HttpException(
        'Could not resolve current user for audit log',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return account.user.id;
  }

  async createMaintenanceRequest(
    data: CreateMaintenanceRequestDto,
    actor?: RequestActor,
  ): Promise<any> {
    this.assertScopeIdsCoherent(data);
    if (actor?.role === RolesEnum.FACILITY_MANAGER) {
      return this.createMaintenanceRequestAsFacilityManager(data, actor);
    }
    // Admins (property managers) file on behalf of a landlord they manage —
    // same flow as the landlord path, whose per-target ownership checks accept
    // a managing admin. Without this branch an admin fell through to the
    // TENANT path and failed its tenancy lookup.
    if (
      actor?.role === RolesEnum.LANDLORD ||
      actor?.role === RolesEnum.ADMIN
    ) {
      return this.createMaintenanceRequestAsLandlord(data, actor);
    }
    return this.createMaintenanceRequestAsTenant(data, actor);
  }

  /**
   * scope='unit' requires property_id (no common_area_id).
   * scope='common_area' requires common_area_id (no property_id).
   * Default scope is 'unit' when not provided.
   */
  private assertScopeIdsCoherent(data: CreateMaintenanceRequestDto): void {
    const scope = data.scope ?? MaintenanceRequestScopeEnum.UNIT;
    if (scope === MaintenanceRequestScopeEnum.COMMON_AREA) {
      if (!data.common_area_id) {
        throw new HttpException(
          'common_area_id is required when scope is common_area',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (data.property_id) {
        throw new HttpException(
          'property_id must not be set when scope is common_area',
          HttpStatus.BAD_REQUEST,
        );
      }
      return;
    }
    // scope === UNIT
    if (!data.property_id) {
      throw new HttpException(
        'property_id is required when scope is unit',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (data.common_area_id) {
      throw new HttpException(
        'common_area_id must not be set when scope is unit',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private async createMaintenanceRequestAsTenant(
    data: CreateMaintenanceRequestDto,
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
      relations: ['tenant', 'tenant.user', 'property'],
    });

    if (!tenantExistInProperty?.id) {
      throw new HttpException(
        'You are not currently renting this property',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    // Fan out to every FM on the landlord's team — assignment now happens
    // per maintenance request, so all team FMs are kept in the loop until
    // the landlord picks one.
    const teamFms = await this.findTeamFmsForLandlord(
      tenantExistInProperty.property.owner_id,
    );
    const selected_managers = teamFms
      .filter((fm) => fm.account?.user?.phone_number)
      .map((fm) => ({
        phone_number: this.utilService.normalizePhoneNumber(
          fm.account.user.phone_number,
        ),
        name: this.utilService.toSentenceCase(
          fm.account.user.first_name ?? 'Facility Manager',
        ),
      }));

    const requestId = this.utilService.generateMaintenanceRequestId();
    const tenantName =
      `${tenantExistInProperty.tenant.user.first_name} ${tenantExistInProperty.tenant.user.last_name}`.trim();

    const request = this.maintenanceRequestRepository.create({
      request_id: requestId,
      tenant_id: tenantExistInProperty.tenant.id,
      property_id: tenantExistInProperty.property?.id,
      tenant_name: tenantName,
      property_name: tenantExistInProperty.property?.name,
      issue_category: 'service',
      issue_media: data.issue_media?.length
        ? data.issue_media.map((m) => ({ ...m, attempt: 1 }))
        : null,
      date_reported: new Date(),
      description: data.text,
      status: MaintenanceRequestStatusEnum.NOT_APPROVED,
      scope: data.scope ?? MaintenanceRequestScopeEnum.UNIT,
      is_urgent: data.is_urgent ?? false,
      creator_type: MaintenanceRequestCreatorTypeEnum.TENANT,
      creator_user_id: tenantExistInProperty.tenant.user.id,
    });

    const savedRequest = await this.maintenanceRequestRepository.save(request);

    await this.createStatusHistoryEntry(
      savedRequest.id,
      null,
      MaintenanceRequestStatusEnum.NOT_APPROVED,
      tenantExistInProperty.tenant.user.id,
      'tenant',
      'Maintenance request created',
    );

    try {
      this.eventEmitter.emit('maintenance.created', {
        user_id: tenantExistInProperty.tenant.id,
        property_id: tenantExistInProperty.property?.id,
        landlord_id: tenantExistInProperty.property?.owner_id,
        tenant_name: tenantName,
        property_name: tenantExistInProperty.property.name,
        maintenance_request_id: savedRequest.id,
        description: data.text,
        created_at: savedRequest.created_at,
        creator_type: MaintenanceRequestCreatorTypeEnum.TENANT,
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

  private async createMaintenanceRequestAsFacilityManager(
    data: CreateMaintenanceRequestDto,
    actor: RequestActor,
  ): Promise<any> {
    const scope = data.scope ?? MaintenanceRequestScopeEnum.UNIT;

    const fmTeamMembers = await this.teamMemberRepository.find({
      where: {
        account: { id: actor.id },
        role: RolesEnum.FACILITY_MANAGER,
      },
      relations: ['account', 'account.user', 'team'],
    });
    if (fmTeamMembers.length === 0) {
      throw new HttpException(
        'You are not registered as a facility manager',
        HttpStatus.FORBIDDEN,
      );
    }

    const fmUser = fmTeamMembers[0].account?.user;
    const fmName = fmUser
      ? `${fmUser.first_name ?? ''} ${fmUser.last_name ?? ''}`.trim() ||
        'Facility Manager'
      : 'Facility Manager';
    // creator_user_id is FK'd to users.id, not accounts.id. actor.id is the
    // Account.id from the JWT, so we must use the FM's User.id here.
    if (!fmUser?.id) {
      throw new HttpException(
        'Could not resolve facility manager user',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const fmUserId = fmUser.id;

    if (scope === MaintenanceRequestScopeEnum.COMMON_AREA) {
      return this.createCommonAreaRequestAsFacilityManager(
        data,
        actor,
        fmName,
        fmUserId,
      );
    }

    // scope === UNIT. FM is authorized iff they're on a team whose creator
    // owns — or, as the managing admin, manages the landlord that owns — the
    // property. An FM may sit on multiple teams; we check membership against
    // the property's acceptable team owners (the landlord and its admin) only
    // to validate authorization — we do NOT auto-assign to it anymore
    // (assignment happens later at landlord approval, after the tenant gate).
    const property = await this.propertyRepository.findOne({
      where: { id: data.property_id },
    });
    if (!property) {
      throw new HttpException('Property not found', HttpStatus.NOT_FOUND);
    }
    const acceptableTeamOwners =
      await this.scopeService.resolveTeamOwnersForLandlord(property.owner_id);
    const authorizingTm = fmTeamMembers.find(
      (tm) =>
        tm.team?.creatorId && acceptableTeamOwners.includes(tm.team.creatorId),
    );
    if (!authorizingTm) {
      throw new HttpException(
        'You are not authorized to file requests for this landlord',
        HttpStatus.FORBIDDEN,
      );
    }

    // Resolve the active tenancy for this property. The expected invariant
    // is one active tenant per property; we defend against bad data on
    // either side. Three branches:
    //   - exactly one  → gate the MR on tenant confirmation.
    //   - zero (vacant) → skip the gate and go straight to NOT_APPROVED so
    //                     the FM can still file (between-tenant repairs).
    //   - multiple     → 422; resolve the bad data before filing.
    const activeTenancies = await this.propertyTenantRepository.find({
      where: {
        property_id: property.id,
        status: TenantStatusEnum.ACTIVE,
      },
      relations: ['tenant', 'tenant.user'],
    });

    if (activeTenancies.length > 1) {
      throw new HttpException(
        'Multiple active tenancies on this property; resolve before filing',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const tenancy = activeTenancies[0] ?? null;
    const tenantUser = tenancy?.tenant?.user ?? null;
    const tenantAccountId = tenancy?.tenant?.id ?? null;
    const tenantDisplayName = tenantUser
      ? `${tenantUser.first_name ?? ''} ${tenantUser.last_name ?? ''}`.trim() ||
        null
      : null;

    const initialStatus = tenancy
      ? MaintenanceRequestStatusEnum.PENDING_TENANT_CONFIRMATION
      : MaintenanceRequestStatusEnum.NOT_APPROVED;

    const request = this.maintenanceRequestRepository.create({
      request_id: this.utilService.generateMaintenanceRequestId(),
      tenant_id: tenantAccountId,
      property_id: property.id,
      common_area_id: null,
      tenant_name: tenantDisplayName,
      property_name: property.name,
      issue_category: 'service',
      issue_media: data.issue_media?.length
        ? data.issue_media.map((m) => ({ ...m, attempt: 1 }))
        : null,
      date_reported: new Date(),
      description: data.text,
      status: initialStatus,
      scope,
      is_urgent: data.is_urgent ?? false,
      creator_type: MaintenanceRequestCreatorTypeEnum.FACILITY_MANAGER,
      creator_user_id: fmUserId,
      assigned_to: null,
    });

    const savedRequest = await this.maintenanceRequestRepository.save(request);

    await this.createStatusHistoryEntry(
      savedRequest.id,
      null,
      initialStatus,
      fmUserId,
      'facility_manager',
      `Maintenance request created by ${fmName}`,
    );

    const basePayload = {
      user_id: actor.id,
      property_id: property.id,
      landlord_id: property.owner_id,
      tenant_id: tenantAccountId,
      tenant_name: tenantDisplayName,
      tenant_phone_number: tenantUser?.phone_number ?? null,
      property_name: property.name,
      property_location: property.location,
      maintenance_request_id: savedRequest.id,
      request_id: savedRequest.request_id,
      description: data.text,
      created_at: savedRequest.created_at,
      creator_type: MaintenanceRequestCreatorTypeEnum.FACILITY_MANAGER,
      creator_name: fmName,
      scope: savedRequest.scope,
      is_urgent: savedRequest.is_urgent,
    };

    try {
      if (tenancy) {
        this.eventEmitter.emit(
          'maintenance.fm_filed_pending_tenant',
          basePayload,
        );
      } else {
        this.eventEmitter.emit('maintenance.created', basePayload);
      }
    } catch (error) {
      this.logger.error('Failed to emit FM-create event:', error);
    }

    return {
      ...savedRequest,
      property_name: property.name,
      property_location: property.location,
    };
  }

  /**
   * FM creates a request scoped to a specific common area. There's no property
   * involvement here — the FM just needs to be teamed with the common area's
   * landlord (owner_id). No auto-assignment; the landlord picks an assignee
   * at approval time.
   */
  private async createCommonAreaRequestAsFacilityManager(
    data: CreateMaintenanceRequestDto,
    actor: RequestActor,
    fmName: string,
    fmUserId: string,
  ): Promise<any> {
    const commonArea = await this.commonAreaRepository.findOne({
      where: { id: data.common_area_id },
    });
    if (!commonArea) {
      throw new HttpException(
        'Common area not found',
        HttpStatus.NOT_FOUND,
      );
    }

    // common_area.owner_id is the landlord's Account.id (matches
    // property.owner_id). Verify the acting FM is on the team serving that
    // landlord — either the landlord's own team (legacy) or the managing
    // admin's team (post-reparent), per resolveTeamOwnersForLandlord.
    const landlordAccountId = commonArea.owner_id;
    const acceptableTeamOwners =
      await this.scopeService.resolveTeamOwnersForLandlord(landlordAccountId);
    const teamMembership = await this.teamMemberRepository
      .createQueryBuilder('tm')
      .innerJoin('tm.team', 'team')
      .where('tm.accountId = :accountId', { accountId: actor.id })
      .andWhere('tm.role = :role', { role: RolesEnum.FACILITY_MANAGER })
      .andWhere('team.creatorId IN (:...teamOwnerIds)', {
        teamOwnerIds: acceptableTeamOwners,
      })
      .getOne();
    if (!teamMembership) {
      throw new HttpException(
        "You are not authorized to file requests for this landlord's common areas",
        HttpStatus.FORBIDDEN,
      );
    }

    const request = this.maintenanceRequestRepository.create({
      request_id: this.utilService.generateMaintenanceRequestId(),
      tenant_id: null,
      property_id: null,
      property_name: null,
      common_area_id: commonArea.id,
      tenant_name: null,
      issue_category: 'service',
      issue_media: data.issue_media?.length
        ? data.issue_media.map((m) => ({ ...m, attempt: 1 }))
        : null,
      date_reported: new Date(),
      description: data.text,
      status: MaintenanceRequestStatusEnum.NOT_APPROVED,
      scope: MaintenanceRequestScopeEnum.COMMON_AREA,
      is_urgent: data.is_urgent ?? false,
      creator_type: MaintenanceRequestCreatorTypeEnum.FACILITY_MANAGER,
      creator_user_id: fmUserId,
      assigned_to: null,
    });

    const savedRequest = await this.maintenanceRequestRepository.save(request);

    await this.createStatusHistoryEntry(
      savedRequest.id,
      null,
      MaintenanceRequestStatusEnum.NOT_APPROVED,
      fmUserId,
      'facility_manager',
      `Maintenance request created by ${fmName}`,
    );

    try {
      this.eventEmitter.emit('maintenance.created', {
        user_id: actor.id,
        property_id: null,
        landlord_id: landlordAccountId,
        common_area_id: commonArea.id,
        common_area_name: commonArea.name,
        tenant_id: null,
        tenant_name: null,
        property_name: null,
        maintenance_request_id: savedRequest.id,
        request_id: savedRequest.request_id,
        description: data.text,
        created_at: savedRequest.created_at,
        creator_type: MaintenanceRequestCreatorTypeEnum.FACILITY_MANAGER,
        creator_name: fmName,
        scope: savedRequest.scope,
        is_urgent: savedRequest.is_urgent,
      });
    } catch (error) {
      this.logger.error('Failed to emit service.created event:', error);
    }

    return {
      ...savedRequest,
      common_area: {
        id: commonArea.id,
        name: commonArea.name,
        address: commonArea.address,
        owner_id: commonArea.owner_id,
      },
    };
  }

  /**
   * Landlord files a maintenance request on their own property or common area.
   * Differs from the FM-filed path:
   *   - No approval step. Landlord-filed MRs never enter NOT_APPROVED. If
   *     there's an active tenant, they pass through PENDING_TENANT_CONFIRMATION
   *     and auto-flip to APPROVED on tenant confirm (see
   *     confirmTenantMaintenanceRequest). Vacant / common-area / sub-leasing
   *     cases go straight to APPROVED.
   *   - FM assignment is optional at submit time. With an FM picked, the request
   *     also fires maintenance.assigned right away (or post-confirm). Without
   *     one, the request lands in APPROVED + assigned_to=null and the landlord
   *     can pick an FM later via PATCH /:id/assignee.
   */
  private async createMaintenanceRequestAsLandlord(
    data: CreateMaintenanceRequestDto,
    actor: RequestActor,
  ): Promise<any> {
    const scope = data.scope ?? MaintenanceRequestScopeEnum.UNIT;
    const landlordUserId = await this.resolveActorUserId(actor.id);

    // Resolve the landlord's display name. accounts.profile_name is canonical
    // (may be a business name); first+last is the fallback. See
    // project_landlord_display_name memory.
    const landlordAccount = await this.accountRepository.findOne({
      where: { id: actor.id },
      relations: ['user'],
    });
    const landlordUser = landlordAccount?.user ?? null;
    const landlordName =
      landlordAccount?.profile_name?.trim() ||
      (landlordUser
        ? `${landlordUser.first_name ?? ''} ${landlordUser.last_name ?? ''}`.trim() ||
          'Landlord'
        : 'Landlord');

    // Validate optional assignee. Mirrors approveAndAssignMaintenanceRequest's
    // gate — must be on the landlord's own team AND have role FACILITY_MANAGER.
    let assigneeTm: TeamMember | null = null;
    if (data.assigned_to) {
      assigneeTm = await this.teamMemberRepository.findOne({
        where: { id: data.assigned_to },
        relations: ['team', 'account', 'account.user'],
      });
      if (!assigneeTm) {
        throw new HttpException(
          'Facility manager not found',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (assigneeTm.team?.creatorId !== actor.id) {
        throw new HttpException(
          'Assignee must be a facility manager on your team',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (assigneeTm.role !== RolesEnum.FACILITY_MANAGER) {
        throw new HttpException(
          'Assignee must be a facility manager',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
    }
    const assigneeFmName = assigneeTm
      ? this.formatTeamMemberLabel(assigneeTm)
      : null;

    if (scope === MaintenanceRequestScopeEnum.COMMON_AREA) {
      return this.createCommonAreaRequestAsLandlord(
        data,
        actor,
        landlordUserId,
        landlordName,
        assigneeTm,
        assigneeFmName,
      );
    }

    // scope === UNIT — landlord must own the property
    const property = await this.propertyRepository.findOne({
      where: { id: data.property_id },
    });
    if (!property) {
      throw new HttpException('Property not found', HttpStatus.NOT_FOUND);
    }
    if (property.owner_id !== actor.id) {
      throw new HttpException(
        'You do not own this property',
        HttpStatus.FORBIDDEN,
      );
    }

    // Resolve active tenancy. Same three-branch defence as the FM path.
    const activeTenancies = await this.propertyTenantRepository.find({
      where: {
        property_id: property.id,
        status: TenantStatusEnum.ACTIVE,
      },
      relations: ['tenant', 'tenant.user'],
    });
    if (activeTenancies.length > 1) {
      throw new HttpException(
        'Multiple active tenancies on this property; resolve before filing',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const tenancy = activeTenancies[0] ?? null;
    const tenantUser = tenancy?.tenant?.user ?? null;
    const tenantAccountId = tenancy?.tenant?.id ?? null;
    const tenantDisplayName = tenantUser
      ? `${tenantUser.first_name ?? ''} ${tenantUser.last_name ?? ''}`.trim() ||
        null
      : null;

    // Sub-leasing edge: landlord is also the active tenant on their own unit.
    // No third party to confirm with — skip the tenant gate and auto-approve.
    const tenantIsLandlord = tenantUser?.id === landlordUserId;
    const gateOnTenant = !!tenancy && !tenantIsLandlord;

    const initialStatus = gateOnTenant
      ? MaintenanceRequestStatusEnum.PENDING_TENANT_CONFIRMATION
      : MaintenanceRequestStatusEnum.APPROVED;

    const request = this.maintenanceRequestRepository.create({
      request_id: this.utilService.generateMaintenanceRequestId(),
      tenant_id: tenantAccountId,
      property_id: property.id,
      common_area_id: null,
      tenant_name: tenantDisplayName,
      property_name: property.name,
      issue_category: 'service',
      issue_media: data.issue_media?.length
        ? data.issue_media.map((m) => ({ ...m, attempt: 1 }))
        : null,
      date_reported: new Date(),
      description: data.text,
      status: initialStatus,
      scope,
      is_urgent: data.is_urgent ?? false,
      is_priority: data.is_priority ?? false,
      creator_type: MaintenanceRequestCreatorTypeEnum.LANDLORD,
      creator_user_id: landlordUserId,
      assigned_to: (assigneeTm?.id as any) ?? null,
      approved_at:
        initialStatus === MaintenanceRequestStatusEnum.APPROVED
          ? new Date()
          : null,
    });

    const savedRequest = await this.maintenanceRequestRepository.save(request);

    await this.createStatusHistoryEntry(
      savedRequest.id,
      null,
      initialStatus,
      landlordUserId,
      'landlord',
      `Maintenance request created by ${landlordName}`,
    );

    const basePayload = {
      user_id: actor.id,
      property_id: property.id,
      landlord_id: property.owner_id,
      tenant_id: tenantAccountId,
      tenant_name: tenantDisplayName,
      tenant_phone_number: tenantUser?.phone_number ?? null,
      property_name: property.name,
      property_location: property.location,
      maintenance_request_id: savedRequest.id,
      request_id: savedRequest.request_id,
      description: data.text,
      created_at: savedRequest.created_at,
      creator_type: MaintenanceRequestCreatorTypeEnum.LANDLORD,
      creator_name: landlordName,
      scope: savedRequest.scope,
      is_urgent: savedRequest.is_urgent,
    };

    try {
      if (gateOnTenant) {
        this.eventEmitter.emit(
          'maintenance.landlord_filed_pending_tenant',
          basePayload,
        );
      } else {
        this.eventEmitter.emit('maintenance.created', basePayload);
        if (assigneeTm) {
          this.eventEmitter.emit('maintenance.assigned', {
            maintenance_request_id: savedRequest.id,
            request_id: savedRequest.request_id,
            previous_assignee: null,
            previous_assignee_name: 'unassigned',
            new_assignee: assigneeTm.id,
            new_assignee_name: assigneeFmName,
            landlord_id: property.owner_id,
            property_id: property.id,
            common_area_id: null,
            description: data.text,
            tenant_id: tenantAccountId,
            created_at: new Date(),
          });
        }
      }
    } catch (error) {
      this.logger.error('Failed to emit landlord-create event:', error);
    }

    return {
      ...savedRequest,
      property_name: property.name,
      property_location: property.location,
    };
  }

  /**
   * Landlord files a request scoped to a specific common area they own.
   * Always lands in APPROVED (no tenant on a common area, no approval step).
   */
  private async createCommonAreaRequestAsLandlord(
    data: CreateMaintenanceRequestDto,
    actor: RequestActor,
    landlordUserId: string,
    landlordName: string,
    assigneeTm: TeamMember | null,
    assigneeFmName: string | null,
  ): Promise<any> {
    const commonArea = await this.commonAreaRepository.findOne({
      where: { id: data.common_area_id },
    });
    if (!commonArea) {
      throw new HttpException('Common area not found', HttpStatus.NOT_FOUND);
    }
    // common_area.owner_id is the landlord's Account.id. The filer must BE
    // that landlord, or be an admin (property manager) who manages them.
    if (
      commonArea.owner_id !== actor.id &&
      !(await this.scopeService.managesLandlord(actor.id, commonArea.owner_id))
    ) {
      throw new HttpException(
        'You do not own this common area',
        HttpStatus.FORBIDDEN,
      );
    }

    const initialStatus = MaintenanceRequestStatusEnum.APPROVED;

    const request = this.maintenanceRequestRepository.create({
      request_id: this.utilService.generateMaintenanceRequestId(),
      tenant_id: null,
      property_id: null,
      property_name: null,
      common_area_id: commonArea.id,
      tenant_name: null,
      issue_category: 'service',
      issue_media: data.issue_media?.length
        ? data.issue_media.map((m) => ({ ...m, attempt: 1 }))
        : null,
      date_reported: new Date(),
      description: data.text,
      status: initialStatus,
      scope: MaintenanceRequestScopeEnum.COMMON_AREA,
      is_urgent: data.is_urgent ?? false,
      is_priority: data.is_priority ?? false,
      creator_type: MaintenanceRequestCreatorTypeEnum.LANDLORD,
      creator_user_id: landlordUserId,
      assigned_to: (assigneeTm?.id as any) ?? null,
      approved_at: new Date(),
    });

    const savedRequest = await this.maintenanceRequestRepository.save(request);

    await this.createStatusHistoryEntry(
      savedRequest.id,
      null,
      initialStatus,
      landlordUserId,
      'landlord',
      `Maintenance request created by ${landlordName}`,
    );

    // landlord_id must be the OWNING landlord's Account.id — which is
    // commonArea.owner_id, not actor.id: with the admin/PM act-on-behalf path
    // the filer may be a managing admin, and livefeed/notification attribution
    // must stay anchored on the landlord. user_id stays the filer, mirroring
    // the FM common-area path.
    try {
      this.eventEmitter.emit('maintenance.created', {
        user_id: actor.id,
        property_id: null,
        landlord_id: commonArea.owner_id,
        common_area_id: commonArea.id,
        common_area_name: commonArea.name,
        tenant_id: null,
        tenant_name: null,
        property_name: null,
        maintenance_request_id: savedRequest.id,
        request_id: savedRequest.request_id,
        description: data.text,
        created_at: savedRequest.created_at,
        creator_type: MaintenanceRequestCreatorTypeEnum.LANDLORD,
        creator_name: landlordName,
        scope: savedRequest.scope,
        is_urgent: savedRequest.is_urgent,
      });
      if (assigneeTm) {
        this.eventEmitter.emit('maintenance.assigned', {
          maintenance_request_id: savedRequest.id,
          request_id: savedRequest.request_id,
          previous_assignee: null,
          previous_assignee_name: 'unassigned',
          new_assignee: assigneeTm.id,
          new_assignee_name: assigneeFmName,
          landlord_id: commonArea.owner_id,
          property_id: null,
          common_area_id: commonArea.id,
          description: data.text,
          tenant_id: null,
          created_at: new Date(),
        });
      }
    } catch (error) {
      this.logger.error(
        'Failed to emit landlord common-area create event:',
        error,
      );
    }

    return {
      ...savedRequest,
      common_area: {
        id: commonArea.id,
        name: commonArea.name,
        address: commonArea.address,
        owner_id: commonArea.owner_id,
      },
    };
  }

  /**
   * Resolves the display name for a request's creator. For landlord/FM-filed
   * requests the canonical name is the matching account's `profile_name` (often
   * a business name), NOT the personal first+last on the users row — see the
   * project_landlord_display_name memory. Falls back to first+last, then null.
   * `creator` must be loaded with its `accounts` relation.
   */
  private resolveCreatorDisplayName(
    creator: Users | null | undefined,
    creatorType: MaintenanceRequestCreatorTypeEnum,
  ): string | null {
    if (!creator) return null;
    const roleForType =
      creatorType === MaintenanceRequestCreatorTypeEnum.LANDLORD
        ? RolesEnum.LANDLORD
        : creatorType === MaintenanceRequestCreatorTypeEnum.FACILITY_MANAGER
          ? RolesEnum.FACILITY_MANAGER
          : null;
    const matchingAccount = roleForType
      ? (creator.accounts ?? []).find((a) => a.roles?.includes(roleForType))
      : null;
    const profileName = matchingAccount?.profile_name?.trim() || null;
    const fullName =
      `${creator.first_name ?? ''} ${creator.last_name ?? ''}`.trim() || null;
    return profileName || fullName;
  }

  async getAllMaintenanceRequests(
    user_id: string,
    queryParams: MaintenanceRequestFilter,
    role?: string,
    managedLandlordIds: string[] = [],
  ) {
    const page = queryParams?.page
      ? Number(queryParams?.page)
      : config.DEFAULT_PAGE_NO;
    const size = queryParams?.size
      ? Number(queryParams.size)
      : config.DEFAULT_PER_PAGE;
    const skip = (page - 1) * size;

    const qb = this.maintenanceRequestRepository
      .createQueryBuilder('sr')
      .leftJoinAndSelect('sr.tenant', 'tenant')
      .leftJoinAndSelect('tenant.user', 'tenantUser')
      .leftJoinAndSelect('sr.creator', 'creator')
      // Load the creator's accounts so we can surface the landlord/FM
      // profile_name (business name) instead of their personal first+last.
      .leftJoinAndSelect('creator.accounts', 'creatorAccounts')
      .leftJoinAndSelect('sr.property', 'property')
      .leftJoinAndSelect('sr.common_area', 'common_area')
      .leftJoinAndSelect('common_area.owner', 'commonAreaOwner')
      .leftJoinAndSelect('sr.facilityManager', 'facilityManager')
      .leftJoinAndSelect('facilityManager.account', 'facilityManagerAccount')
      .leftJoinAndSelect('sr.statusHistory', 'statusHistory')
      .leftJoinAndSelect('statusHistory.changedBy', 'changedBy')
      .where('sr.deleted_at IS NULL');

    if (role === RolesEnum.FACILITY_MANAGER) {
      const myTeamMemberships = await this.teamMemberRepository.find({
        where: {
          account: { id: user_id },
          role: RolesEnum.FACILITY_MANAGER,
        },
        relations: ['account', 'account.user', 'team', 'team.creator', 'team.creator.user'],
      });
      if (myTeamMemberships.length === 0) {
        return {
          maintenance_requests: [],
          pagination: {
            totalRows: 0,
            perPage: size,
            currentPage: page,
            totalPages: 0,
            hasNextPage: false,
          },
        };
      }
      const teamCreatorIds = Array.from(
        new Set(
          myTeamMemberships
            .map((m) => m.team?.creator?.id)
            .filter((v): v is string => !!v),
        ),
      );
      // Team creators are the managing admins after the re-parent (or the
      // landlord itself on a legacy self-owned team); expand to the landlord
      // set whose properties / common areas this FM may see.
      const landlordAccountIds =
        await this.scopeService.resolveLandlordsForTeamCreators(teamCreatorIds);

      // Visible to FM: every unit-scoped request on a property owned by a
      // landlord they're teamed with, OR every common-area request whose
      // common area belongs to such a landlord. Both owner columns are
      // Account.ids, so one id set covers both scopes. FMs are no longer
      // pinned to specific properties.
      qb.andWhere(
        '(property.owner_id IN (:...landlordAccountIds) OR common_area.owner_id IN (:...landlordAccountIds))',
        {
          landlordAccountIds:
            landlordAccountIds.length > 0 ? landlordAccountIds : ['__none__'],
        },
      );

      // Narrow to "assigned to me" when the caller asks for it. Use the
      // FM's TeamMember ids across all the landlord teams they sit on.
      if (queryParams?.assigned_to === 'me') {
        const tmIds = myTeamMemberships.map((m) => m.id);
        qb.andWhere('sr.assigned_to IN (:...assignedTmIds)', {
          assignedTmIds: tmIds.length > 0 ? tmIds : ['__none__'],
        });
      }
    } else if (role === RolesEnum.ADMIN) {
      // Property-manager view: requests on any property OR common area owned by
      // one of the admin's managed landlords. Empty scope => nothing.
      qb.andWhere(
        '(property.owner_id IN (:...managedLandlordIds) OR common_area.owner_id IN (:...managedLandlordIds))',
        {
          managedLandlordIds:
            managedLandlordIds.length > 0 ? managedLandlordIds : ['__none__'],
        },
      );
    } else {
      // Landlord view: own properties OR own common areas. Both owner columns
      // hold the landlord's Account.id (user_id here is the caller's
      // Account.id — see project_req_user_id_is_account_id memory).
      qb.andWhere(
        '(property.owner_id = :ownerAccountId OR common_area.owner_id = :ownerAccountId)',
        { ownerAccountId: user_id },
      );
    }

    // Explicit assignee UUID filter (any role). Useful for landlord views
    // that want to filter their SRs by which FM is handling them.
    if (
      queryParams?.assigned_to &&
      queryParams.assigned_to !== 'me'
    ) {
      qb.andWhere('sr.assigned_to = :assignedToId', {
        assignedToId: queryParams.assigned_to,
      });
    }

    if (queryParams?.status) {
      qb.andWhere('sr.status = :status', { status: queryParams.status });
    }
    if (queryParams?.scope) {
      qb.andWhere('sr.scope = :scope', { scope: queryParams.scope });
    }
    if (queryParams?.creator_type) {
      qb.andWhere('sr.creator_type = :creator_type', {
        creator_type: queryParams.creator_type,
      });
    }
    if (queryParams?.is_urgent !== undefined) {
      qb.andWhere('sr.is_urgent = :is_urgent', {
        is_urgent: queryParams.is_urgent,
      });
    }
    if (queryParams?.tenant_id) {
      qb.andWhere('sr.tenant_id = :tenant_id', {
        tenant_id: queryParams.tenant_id,
      });
    }
    if (queryParams?.property_id) {
      qb.andWhere('sr.property_id = :property_id', {
        property_id: queryParams.property_id,
      });
    }
    if (queryParams?.common_area_id) {
      qb.andWhere('sr.common_area_id = :common_area_id', {
        common_area_id: queryParams.common_area_id,
      });
    }
    if (queryParams?.start_date) {
      qb.andWhere('sr.date_reported >= :start_date', {
        start_date: queryParams.start_date,
      });
    }
    if (queryParams?.end_date) {
      qb.andWhere('sr.date_reported <= :end_date', {
        end_date: queryParams.end_date,
      });
    }

    // Queue order — mirrors sortMaintenanceRequestsForQueue on the frontend so
    // the FM/landlord lists render in backend order without re-sorting (and so
    // progressively-fetched pages append instead of reshuffling):
    //   1. Priority first (is_priority true above false).
    //   2. Status rank (pending approval → reopened/denied → approved →
    //      resolved/awaiting-confirmation → closed/rejected; unknown sinks).
    //   3. "Actionable since" — approved_at asc, never-approved last (NULLS LAST).
    //   4. Oldest reported first — created_at asc.
    //   5. id asc as a stable tiebreak so paging never shifts rows.
    // Every key is on `sr`; ordering by a joined one-to-many column would force
    // LIMIT onto the join-multiplied row set and truncate pages.
    // The status rank is a computed expression, so it goes through addSelect
    // with a plain alias. Ordering by the alias (no dot) lets TypeORM's
    // paginate-with-collection-join path resolve it from the select list — a
    // raw `CASE …` directly in addOrderBy is parsed as `alias.column` and fails.
    qb.addSelect(
      `CASE sr.status
          WHEN 'not_approved' THEN 1
          WHEN 'reopened' THEN 2
          WHEN 'denied_by_tenant' THEN 2
          WHEN 'approved' THEN 3
          WHEN 'resolved' THEN 4
          WHEN 'pending_tenant_confirmation' THEN 4
          WHEN 'closed' THEN 5
          WHEN 'rejected' THEN 5
          ELSE 99
        END`,
      'sr_status_rank',
    )
      .orderBy('sr.is_priority', 'DESC')
      .addOrderBy('sr_status_rank', 'ASC')
      .addOrderBy('sr.approved_at', 'ASC', 'NULLS LAST')
      .addOrderBy('sr.created_at', 'ASC')
      .addOrderBy('sr.id', 'ASC')
      .skip(skip)
      .take(size);

    const [maintenanceRequests, count] = await qb.getManyAndCount();

    // Attach the resolved creator display name (profile_name for landlord/FM)
    // so the FM/landlord lists don't have to fall back to the personal name.
    const requestsWithCreatorName = maintenanceRequests.map((sr) => ({
      ...sr,
      creator_name: this.resolveCreatorDisplayName(sr.creator, sr.creator_type),
    }));

    const totalPages = Math.ceil(count / size);
    return {
      maintenance_requests: requestsWithCreatorName,
      pagination: {
        totalRows: count,
        perPage: size,
        currentPage: page,
        totalPages,
        hasNextPage: page < totalPages,
      },
    };
  }

  async getMaintenanceRequestById(id: string, userId: string): Promise<any> {
    const maintenanceRequest = await this.maintenanceRequestRepository.findOne({
      where: { id },
      relations: [
        'tenant',
        'tenant.user',
        'creator',
        // Creator's accounts → landlord/FM profile_name for the reporter line.
        'creator.accounts',
        'property',
        'common_area',
        'common_area.owner',
        'statusHistory',
        'statusHistory.changedBy',
        // Pull accounts so the activity log can render account.profile_name
        // instead of falling back to user.first_name + last_name.
        'statusHistory.changedBy.accounts',
        // Assignee — needed so the FM detail UI can show "Assigned to <name>"
        // and gate the resolve button to the assignee only.
        'facilityManager',
        'facilityManager.account',
      ],
      order: {
        statusHistory: {
          changed_at: 'ASC',
        },
      },
    });
    if (!maintenanceRequest?.id) {
      throw new HttpException(
        `Maintenance request with id: ${id} not found`,
        HttpStatus.NOT_FOUND,
      );
    }

    await this.assertCanRead(maintenanceRequest, userId);
    return {
      ...maintenanceRequest,
      creator_name: this.resolveCreatorDisplayName(
        maintenanceRequest.creator,
        maintenanceRequest.creator_type,
      ),
    };
  }

  async getMaintenanceRequestByTenant(id: string, status?: string) {
    const statuses = Array.isArray(status)
      ? status
      : status
        ? [status]
        : [
            MaintenanceRequestStatusEnum.PENDING_TENANT_CONFIRMATION,
            MaintenanceRequestStatusEnum.NOT_APPROVED,
            MaintenanceRequestStatusEnum.APPROVED,
            MaintenanceRequestStatusEnum.RESOLVED,
            MaintenanceRequestStatusEnum.REOPENED,
          ];

    return this.maintenanceRequestRepository.find({
      where: {
        tenant_id: id,
        status: In(statuses),
      },
      relations: [
        'tenant',
        'tenant.user',
        'creator',
        'property',
        'common_area',
        'common_area.owner',
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

  async updateMaintenanceRequestById(
    id: string,
    data: UpdateMaintenanceRequestResponseDto,
    userId: string,
  ) {
    const maintenanceRequest = await this.maintenanceRequestRepository.findOne({
      where: { id },
      relations: ['property', 'common_area'],
    });
    if (!maintenanceRequest) {
      throw new HttpException(
        'Maintenance request not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const actorRole = await this.resolveActorRole(maintenanceRequest, userId);
    if (!actorRole) {
      throw new HttpException(
        'You do not have permission to update this maintenance request',
        HttpStatus.FORBIDDEN,
      );
    }

    const previousStatus = maintenanceRequest.status;
    const targetStatus = data.status;

    // For assignee-only transitions (resolve), we need the actor's
    // TeamMember.id to compare against `assigned_to`. Resolve once up-front.
    const actorTeamMemberId =
      actorRole === 'facility_manager'
        ? await this.resolveActorTeamMemberId(maintenanceRequest, userId)
        : null;

    // Validate status transition (if any) before mutating anything else. The
    // REOPENED→REOPENED self-loop is the race case (both FM and tenant try to
    // reopen) — it's allowed by the state machine but handled below as an
    // additional history-only entry, with no entity mutation.
    if (targetStatus !== undefined && targetStatus !== previousStatus) {
      this.assertValidStatusTransition(
        previousStatus,
        targetStatus,
        actorRole,
        maintenanceRequest.creator_type,
        data.reopen_message,
        maintenanceRequest.assigned_to,
        actorTeamMemberId,
      );
    }
    const isReopenSelfLoop =
      targetStatus === MaintenanceRequestStatusEnum.REOPENED &&
      previousStatus === MaintenanceRequestStatusEnum.REOPENED;
    if (isReopenSelfLoop) {
      this.assertValidStatusTransition(
        previousStatus,
        targetStatus,
        actorRole,
        maintenanceRequest.creator_type,
        data.reopen_message,
        maintenanceRequest.assigned_to,
        actorTeamMemberId,
      );
    }

    // Resolve transitions require a summary + category — those columns hold
    // the data the FM enters in the ResolutionModal.
    if (
      targetStatus === MaintenanceRequestStatusEnum.RESOLVED &&
      previousStatus !== MaintenanceRequestStatusEnum.RESOLVED
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
      if (!data.artisan_name || !data.artisan_name.trim()) {
        throw new HttpException(
          'artisan_name is required when marking a request as resolved',
          HttpStatus.BAD_REQUEST,
        );
      }
      if (!data.artisan_phone || !data.artisan_phone.trim()) {
        throw new HttpException(
          'artisan_phone is required when marking a request as resolved',
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
      const refreshed = await this.maintenanceRequestRepository.findOne({
        where: { id },
        relations: ['property'],
      });
      return { ...(refreshed as MaintenanceRequest), alreadyReopened: true };
    }

    const safeUpdate: Partial<MaintenanceRequest> = {};
    if (targetStatus !== undefined) safeUpdate.status = targetStatus;
    if (data.description !== undefined)
      safeUpdate.description = data.description;
    if (data.issue_category !== undefined)
      safeUpdate.issue_category = data.issue_category;
    if (data.date_reported !== undefined)
      safeUpdate.date_reported = data.date_reported;
    if (data.resolution_date !== undefined)
      safeUpdate.resolution_date = data.resolution_date;
    // New uploads are stamped with the cycle they're added in. If this same
    // call is also reopening the request, they belong to the incremented
    // attempt (see the REOPENED branch below).
    const mediaAttempt =
      targetStatus === MaintenanceRequestStatusEnum.REOPENED
        ? (maintenanceRequest.current_attempt ?? 1) + 1
        : (maintenanceRequest.current_attempt ?? 1);
    if (data.issue_media !== undefined) {
      const incoming = (data.issue_media ?? []).map((m) => ({
        ...m,
        attempt: mediaAttempt,
      }));
      safeUpdate.issue_media = [
        ...(maintenanceRequest.issue_media ?? []),
        ...incoming,
      ];
    }

    if (targetStatus === MaintenanceRequestStatusEnum.RESOLVED) {
      safeUpdate.resolution_date = new Date();
      safeUpdate.resolvedAt = new Date();
      safeUpdate.resolution_summary = data.resolution_summary;
      safeUpdate.resolution_category = data.resolution_category;
      safeUpdate.resolution_cost_minor =
        data.resolution_cost_minor ?? null;

      // Artisan upsert. Outside the status+history transaction below because
      // the (team_id, phone) unique constraint makes findOrCreate idempotent
      // — safe to re-run on retry. We use the caller's Account to find their
      // team (FM via team_member; landlord via team.creatorId).
      const callerAccount = await this.accountRepository.findOne({
        where: { id: userId },
      });
      if (!callerAccount) {
        throw new HttpException(
          'Unable to resolve caller account for artisan attribution',
          HttpStatus.BAD_REQUEST,
        );
      }
      const teamId =
        await this.artisansService.resolveCallerTeamId(callerAccount);
      const artisan = await this.artisansService.findOrCreateForResolution({
        teamId,
        name: data.artisan_name!,
        phone: data.artisan_phone!,
        createdByAccountId: userId,
        renameIfExists: data.rename_artisan_if_conflict === true,
      });
      safeUpdate.artisan_id = artisan.id;
      safeUpdate.artisan_name_snapshot = data.artisan_name!.trim();
      // Use the canonical phone (post-normalization) so snapshots and
      // artisans.phone always agree, regardless of what the FM typed.
      safeUpdate.artisan_phone_snapshot = artisan.phone;
    }
    if (targetStatus === MaintenanceRequestStatusEnum.REOPENED) {
      safeUpdate.reopened_at = new Date();
      // Advance the media-grouping cycle so evidence added after this reopen
      // is separable from the original report.
      safeUpdate.current_attempt = (maintenanceRequest.current_attempt ?? 1) + 1;
    }

    // Priority is only valid while a request is actionable (approved /
    // reopened). If this update transitions the request out of an actionable
    // state, clear the flag in the same write so the invariant
    // "is_priority ⇒ status ∈ {approved, reopened}" holds.
    if (
      targetStatus !== undefined &&
      targetStatus !== MaintenanceRequestStatusEnum.APPROVED &&
      targetStatus !== MaintenanceRequestStatusEnum.REOPENED &&
      maintenanceRequest.is_priority
    ) {
      safeUpdate.is_priority = false;
    }

    // Resolve user.id + display name once up-front (read-only, fine to do
    // outside the txn). The status-history row's changed_by_user_id FK
    // points at users.id, but `userId` here is the JWT's account.id — see
    // resolveActorUserId. The resolved name is snapshotted onto the new
    // resolution-attempt row so the card keeps rendering "Resolved by X"
    // after any future rename/delete of the account.
    const isStatusChange = !!(targetStatus && targetStatus !== previousStatus);
    let actorUserId: string | null = null;
    let actorDisplayName: string | null = null;
    if (isStatusChange) {
      const actorAccount = await this.accountRepository.findOne({
        where: { id: userId },
        relations: ['user'],
      });
      if (!actorAccount?.user?.id) {
        throw new HttpException(
          'Could not resolve current user for audit log',
          HttpStatus.UNAUTHORIZED,
        );
      }
      actorUserId = actorAccount.user.id;
      const rawName =
        `${actorAccount.user.first_name ?? ''} ${actorAccount.user.last_name ?? ''}`.trim();
      actorDisplayName =
        actorAccount.profile_name?.trim() || rawName || null;
    }

    // Status update + history insert + (when resolving) attempt-snapshot
    // insert must all be atomic — a failed history or attempt insert leaves
    // the entity flipped without its audit trail / history card.
    await this.dataSource.transaction(async (manager) => {
      if (Object.keys(safeUpdate).length > 0) {
        await manager.update(MaintenanceRequest, id, safeUpdate);
      }
      if (isStatusChange) {
        const reasonParts: string[] = [
          `Status updated via Dashboard from ${previousStatus} to ${targetStatus}`,
        ];
        if (
          targetStatus === MaintenanceRequestStatusEnum.REOPENED &&
          data.reopen_message
        ) {
          reasonParts.push(`Reopen reason: ${data.reopen_message}`);
        }
        await this.createStatusHistoryEntry(
          id,
          previousStatus,
          targetStatus as MaintenanceRequestStatusEnum,
          actorUserId as string,
          actorRole,
          reasonParts.join(' — '),
          data.reopen_message,
          manager,
        );

        if (targetStatus === MaintenanceRequestStatusEnum.RESOLVED) {
          await this.insertResolutionAttemptSnapshot(manager, {
            maintenanceRequestId: id,
            resolutionDate: safeUpdate.resolution_date as Date,
            resolutionCategory: safeUpdate.resolution_category as string,
            resolutionSummary: safeUpdate.resolution_summary as string,
            resolutionCostMinor:
              safeUpdate.resolution_cost_minor ?? null,
            artisanId: safeUpdate.artisan_id ?? null,
            artisanName: safeUpdate.artisan_name_snapshot ?? null,
            artisanPhone: safeUpdate.artisan_phone_snapshot ?? null,
            resolvedByUserId: actorUserId,
            resolvedByName: actorDisplayName,
          });

          // Common-area requests have no tenant to confirm the fix, so close
          // them out in the same transaction instead of leaving them parked
          // in RESOLVED. No-op for unit-scoped requests.
          await this.autoCloseResolvedCommonArea(
            id,
            maintenanceRequest.scope,
            { userId: actorUserId, role: actorRole },
            manager,
          );
        }

        if (targetStatus === MaintenanceRequestStatusEnum.REOPENED) {
          // Same rule as the WhatsApp updateStatus path: only the tenant's
          // reopen message lands on the attempt row. FM/landlord reopen
          // notes stay in status_history under their original column.
          const denialReason =
            actorRole === 'tenant' && data.reopen_message
              ? data.reopen_message
              : undefined;
          await this.patchLatestAttemptOutcome(
            id,
            ResolutionAttemptOutcomeEnum.REOPENED,
            { denialReason, manager },
          );
        }
      }
    });

    const updatedMaintenanceRequest = await this.maintenanceRequestRepository.findOne({
      where: { id },
      relations: ['property', 'common_area'],
    });

    if (
      updatedMaintenanceRequest &&
      (targetStatus || data.description)
    ) {
      this.eventEmitter.emit('maintenance.updated', {
        request_id: updatedMaintenanceRequest.id,
        status: updatedMaintenanceRequest.status,
        previous_status: previousStatus,
        tenant_name: updatedMaintenanceRequest.tenant_name,
        property_name: updatedMaintenanceRequest.property_name,
        property_id: updatedMaintenanceRequest.property_id,
        common_area_id: updatedMaintenanceRequest.common_area_id,
        common_area_name: updatedMaintenanceRequest.common_area?.name ?? null,
        landlord_id:
          updatedMaintenanceRequest.property?.owner_id ??
          updatedMaintenanceRequest.common_area?.owner_id ??
          null,
        tenant_id: updatedMaintenanceRequest.tenant_id,
        creator_type: updatedMaintenanceRequest.creator_type,
        creator_user_id: updatedMaintenanceRequest.creator_user_id,
        description: updatedMaintenanceRequest.description,
        // Per-event subtitle inputs for the live feed: FM's note on resolve,
        // actor's reason on reopen. Only set on the transition that
        // produced them so the listener can pick the right one.
        resolution_summary:
          targetStatus === MaintenanceRequestStatusEnum.RESOLVED
            ? data.resolution_summary ?? null
            : null,
        reopen_message:
          targetStatus === MaintenanceRequestStatusEnum.REOPENED
            ? data.reopen_message ?? null
            : null,
        updated_at: new Date(),
        actor: { id: userId, role: actorRole },
      });
    }

    return updatedMaintenanceRequest;
  }

  /**
   * Inserts a maintenance_resolution_attempts row capturing the FM's
   * resolve snapshot. Caller passes the EntityManager so this runs inside
   * the same transaction as the MR status flip + status_history insert —
   * either all three land or none do. attempt_number = MAX+1 for this MR;
   * the unique constraint on (mr_id, attempt_number) plus the txn-level
   * lock on the MR row (taken by the preceding manager.update) keep
   * concurrent resolves from colliding on the same number.
   */
  private async insertResolutionAttemptSnapshot(
    manager: EntityManager,
    params: {
      maintenanceRequestId: string;
      resolutionDate: Date;
      resolutionCategory: string;
      resolutionSummary: string;
      resolutionCostMinor: number | null;
      artisanId: string | null;
      artisanName: string | null;
      artisanPhone: string | null;
      resolvedByUserId: string | null;
      resolvedByName: string | null;
    },
  ): Promise<void> {
    const repo = manager.getRepository(MaintenanceResolutionAttempt);
    const maxRow = await repo
      .createQueryBuilder('a')
      .select('COALESCE(MAX(a.attempt_number), 0)', 'max')
      .where('a.maintenance_request_id = :id', {
        id: params.maintenanceRequestId,
      })
      .getRawOne<{ max: string }>();
    const nextNumber = Number(maxRow?.max ?? 0) + 1;

    await repo.insert({
      maintenance_request_id: params.maintenanceRequestId,
      attempt_number: nextNumber,
      resolution_date: params.resolutionDate,
      resolution_category: params.resolutionCategory as never,
      resolution_summary: params.resolutionSummary,
      resolution_cost_minor: params.resolutionCostMinor,
      artisan_id: params.artisanId,
      artisan_name_snapshot: params.artisanName,
      artisan_phone_snapshot: params.artisanPhone,
      resolved_by_user_id: params.resolvedByUserId,
      resolved_by_name_snapshot: params.resolvedByName,
      outcome: ResolutionAttemptOutcomeEnum.PENDING,
    });
  }

  /**
   * Patches the latest (highest attempt_number) attempt row for this MR with
   * the given outcome. No-op when no attempt rows exist — that's the case
   * for MRs that have never been resolved (or were resolved before the
   * 1820000000000 migration and skipped backfill, e.g. were rejected and
   * never had a resolution_date). Idempotent: re-applying the same outcome
   * just refreshes outcome_decided_at.
   */
  private async patchLatestAttemptOutcome(
    maintenanceRequestId: string,
    outcome: ResolutionAttemptOutcomeEnum,
    opts?: {
      denialReason?: string | null;
      manager?: EntityManager;
    },
  ): Promise<void> {
    const repo = opts?.manager
      ? opts.manager.getRepository(MaintenanceResolutionAttempt)
      : this.resolutionAttemptRepository;
    const latest = await repo.findOne({
      where: { maintenance_request_id: maintenanceRequestId },
      order: { attempt_number: 'DESC' },
    });
    if (!latest) return;

    latest.outcome = outcome;
    latest.outcome_decided_at = new Date();
    if (opts?.denialReason !== undefined) {
      latest.tenant_denial_reason = opts.denialReason;
    }
    await repo.save(latest);
  }

  /**
   * Common-area maintenance requests have no tenant to confirm a resolution,
   * so an FM marking one resolved should land it straight in CLOSED rather
   * than parking it in RESOLVED awaiting a confirmation that can never come.
   * Call immediately after a request has been transitioned to RESOLVED.
   *
   * No-op for unit-scoped requests — those still go through the tenant
   * confirmation gate (RESOLVED → CLOSED | REOPENED). Writes the
   * RESOLVED → CLOSED status-history row and marks the latest resolution
   * attempt CONFIRMED (the attempt patch is itself a no-op when no attempt
   * row exists, e.g. the lighter WhatsApp resolve path). Returns true when it
   * closed the request so callers can reflect the final status.
   */
  private async autoCloseResolvedCommonArea(
    requestId: string,
    scope: MaintenanceRequestScopeEnum,
    actor: { userId: string | null; role: string },
    manager?: EntityManager,
  ): Promise<boolean> {
    if (scope !== MaintenanceRequestScopeEnum.COMMON_AREA) return false;

    const repo = manager
      ? manager.getRepository(MaintenanceRequest)
      : this.maintenanceRequestRepository;
    await repo.update(requestId, {
      status: MaintenanceRequestStatusEnum.CLOSED,
    });

    // changed_by_user_id is a non-null FK to users.id; the WhatsApp paths can
    // fall back to a 'system' sentinel, so skip the audit row in that case
    // rather than violate the constraint. The status flip + attempt outcome
    // still land — the history row is best-effort.
    if (actor.userId && actor.userId !== 'system') {
      await this.createStatusHistoryEntry(
        requestId,
        MaintenanceRequestStatusEnum.RESOLVED,
        MaintenanceRequestStatusEnum.CLOSED,
        actor.userId,
        actor.role,
        'Common-area request auto-closed on resolution — no tenant to confirm.',
        undefined,
        manager,
      );
    }

    await this.patchLatestAttemptOutcome(
      requestId,
      ResolutionAttemptOutcomeEnum.CONFIRMED,
      { manager },
    );
    return true;
  }

  /**
   * Patches just the tenant_denial_reason on the latest attempt row — used
   * by the optional WhatsApp follow-up after a tenant deny / reopen. Does
   * NOT change outcome (the deny / reopen already set it). Verifies the
   * caller is the tenant on this MR before writing — symmetric with
   * updateTenantDenialReason; without this check anyone with a request id
   * could patch any MR's denial reason.
   */
  async patchLatestAttemptDenialReason(
    maintenanceRequestId: string,
    tenantAccountId: string,
    denialReason: string,
  ): Promise<void> {
    const mr = await this.maintenanceRequestRepository.findOne({
      where: { id: maintenanceRequestId },
    });
    if (!mr) {
      throw new NotFoundException('Maintenance request not found');
    }
    if (mr.tenant_id !== tenantAccountId) {
      throw new HttpException(
        'You cannot act on this request',
        HttpStatus.FORBIDDEN,
      );
    }

    const latest = await this.resolutionAttemptRepository.findOne({
      where: { maintenance_request_id: maintenanceRequestId },
      order: { attempt_number: 'DESC' },
    });
    if (!latest) return;
    latest.tenant_denial_reason = denialReason;
    await this.resolutionAttemptRepository.save(latest);
  }

  /**
   * Records a "reopen note" history row for a request that's already in the
   * REOPENED state. Skips the insert if the same user submitted the same
   * reopen_message within the last 2 seconds — defends against double-clicks
   * on the FE.
   */
  async appendReopenNoteWithDedup(
    maintenanceRequestId: string,
    userId: string,
    actorRole: 'landlord' | 'tenant' | 'facility_manager',
    reopenMessage: string,
  ): Promise<void> {
    const recent = await this.statusHistoryRepository
      .createQueryBuilder('h')
      .where('h.maintenance_request_id = :id', { id: maintenanceRequestId })
      .andWhere('h.changed_by_user_id = :userId', { userId })
      .andWhere('h.notes = :notes', { notes: reopenMessage })
      .andWhere(`h.changed_at > NOW() - INTERVAL '2 seconds'`)
      .getOne();
    if (recent) return;

    await this.createStatusHistoryEntry(
      maintenanceRequestId,
      MaintenanceRequestStatusEnum.REOPENED,
      MaintenanceRequestStatusEnum.REOPENED,
      userId,
      actorRole,
      'additional_reopen_note',
      reopenMessage,
    );
  }

  async deleteMaintenanceRequestById(id: string, userId: string) {
    const maintenanceRequest = await this.maintenanceRequestRepository.findOne({
      where: { id },
      relations: ['property', 'common_area'],
    });
    if (!maintenanceRequest) {
      throw new HttpException(
        'Maintenance request not found',
        HttpStatus.NOT_FOUND,
      );
    }
    const ownerAccountId =
      maintenanceRequest.property?.owner_id ??
      maintenanceRequest.common_area?.owner_id ??
      null;
    // Allow the tenant, the original creator, the owning landlord, or an admin
    // who manages that landlord (acting on their behalf from the dashboard).
    const isManagingAdmin = ownerAccountId
      ? await this.scopeService.managesLandlord(userId, ownerAccountId)
      : false;
    if (
      maintenanceRequest.tenant_id !== userId &&
      maintenanceRequest.creator_user_id !== userId &&
      ownerAccountId !== userId &&
      !isManagingAdmin
    ) {
      throw new HttpException(
        'You do not have permission to delete this maintenance request',
        HttpStatus.FORBIDDEN,
      );
    }
    return this.maintenanceRequestRepository.softDelete(id);
  }

  async getPendingAndUrgentRequests(
    queryParams: MaintenanceRequestFilter,
    owner_id: string | string[],
  ) {
    const ownerIds = Array.isArray(owner_id) ? owner_id : [owner_id];
    const page = queryParams?.page
      ? Number(queryParams?.page)
      : config.DEFAULT_PAGE_NO;
    const size = queryParams?.size
      ? Number(queryParams.size)
      : config.DEFAULT_PER_PAGE;
    const skip = (page - 1) * size;

    if (!ownerIds.length) {
      return {
        maintenance_requests: [],
        pagination: {
          totalRows: 0,
          perPage: size,
          currentPage: page,
          totalPages: 0,
          hasNextPage: false,
        },
      };
    }

    const query = await buildMaintenanceRequestFilter(queryParams);

    // "Needs attention": still awaiting landlord approval OR flagged urgent
    // (regardless of where it sits in the lifecycle). Owned via property OR
    // via common_area — both owner columns hold the landlord's Account.id
    // (owner_id here is the caller's Account.id).
    const [maintenanceRequests, count] = await this.maintenanceRequestRepository
      .createQueryBuilder('sr')
      .leftJoinAndSelect('sr.tenant', 'tenant')
      .leftJoinAndSelect('tenant.user', 'tenantUser')
      .leftJoinAndSelect('sr.creator', 'creator')
      .leftJoinAndSelect('sr.property', 'property')
      .leftJoinAndSelect('sr.common_area', 'common_area')
      .leftJoinAndSelect('common_area.owner', 'commonAreaOwner')
      .leftJoinAndSelect('sr.statusHistory', 'history')
      .leftJoinAndSelect('history.changedBy', 'changedBy')
      .where(
        '(property.owner_id IN (:...ownerAccountIds) OR common_area.owner_id IN (:...ownerAccountIds))',
        { ownerAccountIds: ownerIds },
      )
      .andWhere('(sr.status = :notApproved OR sr.is_urgent = :urgent)', {
        notApproved: MaintenanceRequestStatusEnum.NOT_APPROVED,
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
      maintenance_requests: maintenanceRequests,
      pagination: {
        totalRows: count,
        perPage: size,
        currentPage: page,
        totalPages,
        hasNextPage: page < totalPages,
      },
    };
  }

  async getMaintenanceRequestsByTenant(
    tenant_id: string,
    queryParams: MaintenanceRequestFilter,
  ) {
    const page = queryParams?.page
      ? Number(queryParams?.page)
      : config.DEFAULT_PAGE_NO;
    const size = queryParams?.size
      ? Number(queryParams.size)
      : config.DEFAULT_PER_PAGE;
    const skip = (page - 1) * size;
    const [maintenanceRequests, count] =
      await this.maintenanceRequestRepository.findAndCount({
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
      maintenance_requests: maintenanceRequests,
      pagination: {
        totalRows: count,
        perPage: size,
        currentPage: page,
        totalPages,
        hasNextPage: page < totalPages,
      },
    };
  }

  async getRequestById(id: string): Promise<MaintenanceRequest> {
    const request = await this.maintenanceRequestRepository.findOne({
      where: { id },
      relations: ['messages', 'statusHistory', 'statusHistory.changedBy'],
      order: {
        statusHistory: {
          changed_at: 'ASC',
        },
      },
    });

    if (!request) {
      throw new NotFoundException('Maintenance request not found');
    }

    return request;
  }

  /**
   * Returns the per-resolve history for a request, newest attempt first.
   * Restricted to landlord + facility_manager actors on the MR — tenants
   * see the latest resolution via the regular MR fetch, not the historical
   * list (deliberately: their UI shows confirm/deny prompts, not an audit).
   */
  async getResolutionAttempts(id: string, userId: string) {
    const maintenanceRequest = await this.maintenanceRequestRepository.findOne({
      where: { id },
      relations: ['property', 'common_area'],
    });
    if (!maintenanceRequest) {
      throw new HttpException(
        'Maintenance request not found',
        HttpStatus.NOT_FOUND,
      );
    }
    const role = await this.resolveActorRole(maintenanceRequest, userId);
    if (role !== 'landlord' && role !== 'facility_manager') {
      throw new HttpException(
        'You do not have permission to view resolution history for this request',
        HttpStatus.FORBIDDEN,
      );
    }

    return this.resolutionAttemptRepository.find({
      where: { maintenance_request_id: id },
      order: { attempt_number: 'DESC' },
    });
  }

  /**
   * Returns the audit trail for a request: who transitioned it, when, why.
   * Permission set matches getMaintenanceRequestById — caller must be landlord,
   * tenant on the request, the creator, or the assigned FM.
   */
  async getStatusHistory(id: string, userId: string) {
    const maintenanceRequest = await this.maintenanceRequestRepository.findOne({
      where: { id },
      relations: ['property', 'common_area'],
    });
    if (!maintenanceRequest) {
      throw new HttpException(
        'Maintenance request not found',
        HttpStatus.NOT_FOUND,
      );
    }
    await this.assertCanRead(maintenanceRequest, userId);

    return this.statusHistoryRepository.find({
      where: { maintenance_request_id: id },
      relations: ['changedBy'],
      order: { changed_at: 'ASC' },
    });
  }

  /**
   * Activity feed for a facility manager: every status_history row across
   * every maintenance request on properties the FM manages, ordered DESC by
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
        account: { id: userId },
        role: RolesEnum.FACILITY_MANAGER,
      },
      relations: [
        'account',
        'account.user',
        'team',
        'team.creator',
        'team.creator.user',
      ],
    });
    if (teamMemberships.length === 0) {
      return { items: [], pagination: { nextCursor: null, hasNextPage: false } };
    }
    const teamCreatorIds = Array.from(
      new Set(
        teamMemberships
          .map((tm) => tm.team?.creator?.id)
          .filter((v): v is string => !!v),
      ),
    );
    // Team creators are the managing admins after the re-parent (or the
    // landlord on a legacy self-owned team); expand to the FM's landlord set.
    const landlordAccountIds =
      await this.scopeService.resolveLandlordsForTeamCreators(teamCreatorIds);

    const qb = this.statusHistoryRepository
      .createQueryBuilder('h')
      .innerJoinAndSelect('h.maintenanceRequest', 'sr')
      .leftJoinAndSelect('sr.property', 'property')
      .leftJoinAndSelect('sr.common_area', 'common_area')
      .leftJoinAndSelect('common_area.owner', 'commonAreaOwner')
      .leftJoinAndSelect('h.changedBy', 'actor')
      .leftJoinAndSelect('sr.tenant', 'tenant')
      .leftJoinAndSelect('tenant.user', 'tenantUser')
      .leftJoinAndSelect('sr.creator', 'creator')
      .leftJoinAndSelect('sr.facilityManager', 'assignedFm')
      .leftJoinAndSelect('assignedFm.account', 'assignedFmAccount')
      .leftJoinAndSelect('assignedFmAccount.user', 'assignedFmUser')
      .where(
        '(property.owner_id IN (:...landlordAccountIds) OR common_area.owner_id IN (:...landlordAccountIds))',
        {
          landlordAccountIds:
            landlordAccountIds.length > 0 ? landlordAccountIds : ['__none__'],
        },
      )
      .andWhere('sr.deleted_at IS NULL');

    if (options?.landlordId) {
      // `landlordId` is the landlord's Account.id, which both owner columns
      // store — compare each scope against the same id.
      qb.andWhere(
        '(property.owner_id = :landlordAccountId OR common_area.owner_id = :landlordAccountId)',
        { landlordAccountId: options.landlordId },
      );
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
      pending_tenant_confirmation: 'Issue reported — awaiting tenant confirmation',
      tenant_confirmed: 'Tenant confirmed the issue',
      tenant_confirmed_auto_approved:
        'Tenant confirmed the issue — auto-approved',
      tenant_denied: 'Tenant denied the report',
      denied_by_tenant: 'Tenant denied the report',
      landlord_force_confirmed: 'Landlord confirmed on tenant’s behalf',
      landlord_force_confirmed_auto_approved:
        'Landlord confirmed on tenant’s behalf — auto-approved',
      rejected: 'Rejected by landlord',
    };
    const fullName = (f?: string | null, l?: string | null) =>
      [f, l].filter(Boolean).join(' ') || null;

    const items = trimmed.map((h) => {
      const sr = h.maintenanceRequest;
      const isCreation = h.previous_status === null;
      const isReopenNote =
        h.previous_status === MaintenanceRequestStatusEnum.REOPENED &&
        h.new_status === MaintenanceRequestStatusEnum.REOPENED;
      const isTenantConfirm =
        h.previous_status ===
          MaintenanceRequestStatusEnum.PENDING_TENANT_CONFIRMATION &&
        h.new_status === MaintenanceRequestStatusEnum.NOT_APPROVED;
      // Landlord-filed MRs auto-approve straight from the tenant-confirmation
      // gate (no NOT_APPROVED interstitial). Surface as a distinct event so
      // the activity feed says "tenant confirmed — auto-approved" rather than
      // a generic "Approved by landlord".
      const isTenantConfirmAutoApproved =
        h.previous_status ===
          MaintenanceRequestStatusEnum.PENDING_TENANT_CONFIRMATION &&
        h.new_status === MaintenanceRequestStatusEnum.APPROVED;
      const isTenantDeny =
        h.previous_status ===
          MaintenanceRequestStatusEnum.PENDING_TENANT_CONFIRMATION &&
        h.new_status === MaintenanceRequestStatusEnum.DENIED_BY_TENANT;

      const event_type = isCreation
        ? 'created'
        : isReopenNote
          ? 'reopen_note'
          : isTenantConfirm
            ? h.changed_by_role === 'landlord'
              ? 'landlord_force_confirmed'
              : 'tenant_confirmed'
            : isTenantConfirmAutoApproved
              ? h.changed_by_role === 'landlord'
                ? 'landlord_force_confirmed_auto_approved'
                : 'tenant_confirmed_auto_approved'
              : isTenantDeny
                ? 'tenant_denied'
                : (h.new_status as string);

      const title = titleByEvent[event_type] ?? `Status: ${h.new_status}`;
      const eventNote = h.notes || h.change_reason || '';
      const issueDesc = sr.description?.trim() || '';
      const description = isCreation
        ? sr.description
        : issueDesc && eventNote
          ? `${issueDesc} - ${eventNote}`
          : issueDesc || eventNote;

      const actor_name =
        fullName(h.changedBy?.first_name, h.changedBy?.last_name) ||
        fullName(sr.tenant?.user?.first_name, sr.tenant?.user?.last_name) ||
        fullName(sr.creator?.first_name, sr.creator?.last_name) ||
        sr.tenant_name ||
        '—';

      const assignedFmAccount = sr.facilityManager?.account;
      const assigned_fm_name =
        fullName(
          assignedFmAccount?.user?.first_name,
          assignedFmAccount?.user?.last_name,
        ) ||
        assignedFmAccount?.profile_name ||
        null;

      return {
        id: h.id,
        event_type,
        title,
        description,
        request_id: sr.id,
        request_ref: sr.request_id,
        property_id: sr.property?.id ?? null,
        property_name: sr.property?.name ?? null,
        common_area_id: sr.common_area?.id ?? null,
        common_area_name: sr.common_area?.name ?? null,
        landlord_id:
          sr.property?.owner_id ?? sr.common_area?.owner_id ?? null,
        actor_name,
        actor_role: h.changed_by_role,
        assigned_fm_name,
        assigned_fm_team_member_id: sr.facilityManager?.id ?? null,
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
   * Resolves the requesting user's effective role for a given request, used
   * to gate transitions and writes. Returns null if the user has no claim.
   */
  private async resolveActorRole(
    maintenanceRequest: MaintenanceRequest,
    userId: string,
  ): Promise<'landlord' | 'tenant' | 'facility_manager' | null> {
    // `userId` is the requester's Account.id (set by JwtAuthGuard, which
    // resolves the JWT payload to the full Account entity). Both owner columns
    // hold the landlord's Account.id, so the same id compares against either.
    const ownerAccountId =
      maintenanceRequest.property?.owner_id ??
      maintenanceRequest.common_area?.owner_id ??
      null;

    if (ownerAccountId && ownerAccountId === userId) {
      return 'landlord';
    }
    // Admin (PM) managing the owner acts with landlord authority on their
    // behalf — same transitions; audit is attributed to the admin's own user.
    if (
      ownerAccountId &&
      (await this.scopeService.managesLandlord(userId, ownerAccountId))
    ) {
      return 'landlord';
    }
    if (
      maintenanceRequest.tenant_id &&
      (await this.isTenantUser(maintenanceRequest, userId))
    ) {
      return 'tenant';
    }
    if (maintenanceRequest.creator_user_id === userId) {
      // Creator might be the FM who reported it; FM-as-creator gets the
      // facility_manager role for transitions on their own request.
      return maintenanceRequest.creator_type ===
        MaintenanceRequestCreatorTypeEnum.FACILITY_MANAGER
        ? 'facility_manager'
        : 'tenant';
    }
    if (!ownerAccountId) return null;

    // FM teamed with the landlord that owns the property or common area.
    // Match the requester by Account.id; accept either the landlord's own team
    // or the managing admin's team as the owning team (post-reparent the FM
    // sits on the admin's team) — see resolveTeamOwnersForLandlord.
    const acceptableTeamOwners =
      await this.scopeService.resolveTeamOwnersForLandlord(ownerAccountId);
    const fm = await this.teamMemberRepository
      .createQueryBuilder('tm')
      .innerJoin('tm.team', 'team')
      .where('tm.accountId = :userId', { userId })
      .andWhere('tm.role = :role', { role: RolesEnum.FACILITY_MANAGER })
      .andWhere('team.creatorId IN (:...teamOwnerIds)', {
        teamOwnerIds: acceptableTeamOwners,
      })
      .getOne();
    return fm ? 'facility_manager' : null;
  }

  /**
   * Resolves the acting FM's TeamMember.id for the landlord that owns this
   * request's property or common area. Returns null when the actor is not on
   * a matching team. Used to gate assignee-only actions (e.g. resolve), where
   * `maintenance_requests.assigned_to` stores a TeamMember.id.
   */
  private async resolveActorTeamMemberId(
    maintenanceRequest: MaintenanceRequest,
    accountId: string,
  ): Promise<string | null> {
    const ownerAccountId =
      maintenanceRequest.property?.owner_id ??
      maintenanceRequest.common_area?.owner_id ??
      null;
    if (!ownerAccountId) return null;

    // Accept either the landlord's own team or the managing admin's team as the
    // owning team (post-reparent the FM sits on the admin's team).
    const acceptableTeamOwners =
      await this.scopeService.resolveTeamOwnersForLandlord(ownerAccountId);
    const tm = await this.teamMemberRepository
      .createQueryBuilder('tm')
      .innerJoin('tm.team', 'team')
      .where('tm.accountId = :accountId', { accountId })
      .andWhere('tm.role = :role', { role: RolesEnum.FACILITY_MANAGER })
      .andWhere('team.creatorId IN (:...teamOwnerIds)', {
        teamOwnerIds: acceptableTeamOwners,
      })
      .getOne();
    return tm?.id ?? null;
  }

  private async isTenantUser(
    maintenanceRequest: MaintenanceRequest,
    userId: string,
  ): Promise<boolean> {
    if (!maintenanceRequest.tenant_id) return false;
    // tenant_id holds Account.id; resolve to user via tenant relation.
    const sr = await this.maintenanceRequestRepository.findOne({
      where: { id: maintenanceRequest.id },
      relations: ['tenant', 'tenant.user'],
    });
    return sr?.tenant?.user?.id === userId;
  }

  private async assertCanRead(
    maintenanceRequest: MaintenanceRequest,
    userId: string,
  ): Promise<void> {
    const role = await this.resolveActorRole(maintenanceRequest, userId);
    if (!role) {
      throw new HttpException(
        'You do not have permission to view this maintenance request',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  /**
   * Enforces the lifecycle:
   *
   *   FM-filed unit (with active tenant):
   *     pending_tenant_confirmation
   *       ├── (tenant confirms)        → not_approved → approved → resolved → ...
   *       └── (tenant denies)          → denied_by_tenant (terminal)
   *
   *   Tenant-filed, or FM-filed common-area / vacant unit:
   *     not_approved → approved → resolved → (closed | reopened → resolved → ...)
   *
   *   Landlord rejection (WhatsApp only):
   *     not_approved → rejected (terminal)
   *
   * Role policy:
   *   - landlord approves (NOT_APPROVED → APPROVED) and rejects via the
   *     dedicated reject path. Landlord can also force-confirm
   *     (PENDING_TENANT_CONFIRMATION → NOT_APPROVED) when the tenant is
   *     unresponsive — same destination as a tenant-confirm but recorded as
   *     a landlord-actor in status_history.
   *   - tenant on the request confirms or denies the FM-filed gate
   *     (PENDING_TENANT_CONFIRMATION → NOT_APPROVED | DENIED_BY_TENANT) and
   *     can confirm-resolution (RESOLVED → CLOSED) or reject-resolution
   *     (RESOLVED → REOPENED) on requests they filed.
   *   - The assigned FM (the one whose TeamMember.id equals
   *     `assigned_to`) is the only actor allowed to mark approve→resolve
   *     and reopen→resolve. Any other FM on the landlord's team can still
   *     reopen (resolve→reopen) — that gate is intentionally wider so a
   *     teammate can flag bad resolutions.
   *   - REOPENED → REOPENED is permitted as a self-loop carrying an additional
   *     reopen_message (race case where FM and tenant both reopen). The caller
   *     in updateMaintenanceRequestById skips the entity mutation and only logs a
   *     history row in that case.
   *
   * Terminal states: closed, rejected, denied_by_tenant.
   */
  private assertValidStatusTransition(
    from: MaintenanceRequestStatusEnum,
    to: MaintenanceRequestStatusEnum,
    actorRole: 'landlord' | 'tenant' | 'facility_manager',
    creatorType: MaintenanceRequestCreatorTypeEnum,
    reopenMessage?: string,
    assignedTo?: string | null,
    actorTeamMemberId?: string | null,
  ): void {
    const transition = `${from}->${to}`;
    const tenantIsCreator =
      creatorType === MaintenanceRequestCreatorTypeEnum.TENANT;
    const fmIsCreator =
      creatorType === MaintenanceRequestCreatorTypeEnum.FACILITY_MANAGER;

    switch (transition) {
      case `${MaintenanceRequestStatusEnum.NOT_APPROVED}->${MaintenanceRequestStatusEnum.APPROVED}`:
        if (actorRole !== 'landlord') {
          throw new HttpException(
            'Only the landlord can approve a maintenance request',
            HttpStatus.FORBIDDEN,
          );
        }
        if (!assignedTo) {
          throw new HttpException(
            'Assign a facility manager before approving',
            HttpStatus.BAD_REQUEST,
          );
        }
        return;

      case `${MaintenanceRequestStatusEnum.APPROVED}->${MaintenanceRequestStatusEnum.RESOLVED}`:
      case `${MaintenanceRequestStatusEnum.REOPENED}->${MaintenanceRequestStatusEnum.RESOLVED}`:
        if (
          actorRole !== 'facility_manager' ||
          !assignedTo ||
          !actorTeamMemberId ||
          actorTeamMemberId !== assignedTo
        ) {
          throw new HttpException(
            'Only the assigned facility manager can mark this request as resolved',
            HttpStatus.FORBIDDEN,
          );
        }
        return;

      case `${MaintenanceRequestStatusEnum.RESOLVED}->${MaintenanceRequestStatusEnum.CLOSED}`: {
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

      case `${MaintenanceRequestStatusEnum.RESOLVED}->${MaintenanceRequestStatusEnum.REOPENED}`:
      case `${MaintenanceRequestStatusEnum.REOPENED}->${MaintenanceRequestStatusEnum.REOPENED}`: {
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

      // FM-filed unit-scoped MRs sit in PENDING_TENANT_CONFIRMATION until the
      // tenant responds. The dedicated endpoints (`/tenant-confirm`,
      // `/tenant-deny`, `/landlord-force-confirm`) are the primary path —
      // these cases let the generic PUT also reach the same transitions.
      case `${MaintenanceRequestStatusEnum.PENDING_TENANT_CONFIRMATION}->${MaintenanceRequestStatusEnum.NOT_APPROVED}`:
        if (actorRole !== 'tenant' && actorRole !== 'landlord') {
          throw new HttpException(
            'Only the tenant on this request (or the landlord, force-confirming) can confirm it',
            HttpStatus.FORBIDDEN,
          );
        }
        // FM-filed and tenant-filed land in NOT_APPROVED on confirm. Landlord-
        // filed MRs skip NOT_APPROVED (see the ->APPROVED case below).
        if (creatorType === MaintenanceRequestCreatorTypeEnum.LANDLORD) {
          throw new HttpException(
            'Landlord-filed requests auto-approve on tenant confirmation; transition to APPROVED instead',
            HttpStatus.CONFLICT,
          );
        }
        return;

      // Landlord-filed MRs auto-approve on tenant confirmation (no separate
      // landlord-approval step). Only the tenant (confirm) or the landlord
      // (force-confirm) can drive this.
      case `${MaintenanceRequestStatusEnum.PENDING_TENANT_CONFIRMATION}->${MaintenanceRequestStatusEnum.APPROVED}`:
        if (creatorType !== MaintenanceRequestCreatorTypeEnum.LANDLORD) {
          throw new HttpException(
            'Only landlord-filed requests can transition straight from pending tenant confirmation to approved',
            HttpStatus.CONFLICT,
          );
        }
        if (actorRole !== 'tenant' && actorRole !== 'landlord') {
          throw new HttpException(
            'Only the tenant on this request (or the landlord, force-confirming) can confirm it',
            HttpStatus.FORBIDDEN,
          );
        }
        return;

      case `${MaintenanceRequestStatusEnum.PENDING_TENANT_CONFIRMATION}->${MaintenanceRequestStatusEnum.DENIED_BY_TENANT}`:
        if (actorRole !== 'tenant') {
          throw new HttpException(
            'Only the tenant on this request can deny it',
            HttpStatus.FORBIDDEN,
          );
        }
        return;

      default:
        throw new HttpException(
          `Invalid status transition: ${from} → ${to}`,
          HttpStatus.BAD_REQUEST,
        );
    }
  }

  async updateStatus(
    id: string,
    status: MaintenanceRequestStatusEnum,
    notes?: string,
    actor?: { id?: string; role?: string; name?: string },
  ) {
    const request = await this.maintenanceRequestRepository.findOne({
      where: { id },
      relations: ['tenant', 'property', 'common_area'],
    });
    if (!request) throw new NotFoundException('Request not found');

    const previousStatus = request.status;
    request.status = status;
    if (notes) request.notes = notes;
    if (status === MaintenanceRequestStatusEnum.RESOLVED)
      request.resolution_date = new Date();
    if (status === MaintenanceRequestStatusEnum.REOPENED) {
      request.reopened_at = new Date();
      // Advance the media-grouping cycle on a genuine reopen transition
      // (guard against double-bump if REOPENED → REOPENED is re-sent).
      if (previousStatus !== MaintenanceRequestStatusEnum.REOPENED) {
        request.current_attempt = (request.current_attempt ?? 1) + 1;
      }
    }
    if (
      status === MaintenanceRequestStatusEnum.APPROVED ||
      status === MaintenanceRequestStatusEnum.REOPENED
    ) {
      request.approved_at = new Date();
    }

    const savedRequest = await this.maintenanceRequestRepository.save(request);

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
    }

    // Mirror the dashboard update() path: keep the latest resolution-attempt
    // row's outcome in sync. The transitions that actually correspond to
    // resolution outcomes are RESOLVED → CLOSED (tenant confirmed via
    // WhatsApp "Yes it's fixed") and RESOLVED → REOPENED (tenant tapped
    // "No, not yet", or FM/landlord reopened from dashboard). The
    // creation-gate transitions (PENDING_TENANT_CONFIRMATION → NOT_APPROVED
    // and PENDING_TENANT_CONFIRMATION → DENIED_BY_TENANT) are NOT resolution
    // outcomes — they predate any FM resolve.
    if (status === MaintenanceRequestStatusEnum.REOPENED) {
      // Only stash the message on the attempt row when the tenant is the
      // one rejecting. FM / landlord reopen notes belong in status_history
      // (the tenant_denial_reason column name would be misleading).
      const denialReason =
        actor?.role === 'tenant' && notes ? notes : undefined;
      await this.patchLatestAttemptOutcome(
        savedRequest.id,
        ResolutionAttemptOutcomeEnum.REOPENED,
        { denialReason },
      );
    } else if (status === MaintenanceRequestStatusEnum.CLOSED) {
      await this.patchLatestAttemptOutcome(
        savedRequest.id,
        ResolutionAttemptOutcomeEnum.CONFIRMED,
      );
    }

    // Common-area resolves have no tenant to confirm — auto-close so the
    // request doesn't sit in RESOLVED forever. Funnels every WhatsApp FM
    // resolve path through one place; the emit below then reflects CLOSED.
    if (status === MaintenanceRequestStatusEnum.RESOLVED) {
      const autoClosed = await this.autoCloseResolvedCommonArea(
        savedRequest.id,
        request.scope,
        { userId: actor?.id ?? null, role: actor?.role ?? 'facility_manager' },
      );
      if (autoClosed) {
        savedRequest.status = MaintenanceRequestStatusEnum.CLOSED;
      }
    }

    if (!actor?.id) {
      this.logger.warn(
        `Status history entry skipped for request ${savedRequest.id}: no actor.id provided (${previousStatus} → ${status})`,
      );
    }

    this.eventEmitter.emit('maintenance.updated', {
      request_id: savedRequest.id,
      status: savedRequest.status,
      previous_status: previousStatus,
      tenant_name: request.tenant_name,
      property_name: request.property_name,
      property_id: request.property_id,
      common_area_id: request.common_area_id,
      common_area_name: request.common_area?.name ?? null,
      landlord_id:
        request.property?.owner_id ?? request.common_area?.owner_id ?? null,
      tenant_id: request.tenant_id,
      creator_type: request.creator_type,
      creator_user_id: request.creator_user_id,
      description: request.description,
      // For updateStatus the `notes` parameter carries the actor's note
      // (FM's resolution summary OR tenant/FM reopen reason, depending on
      // the transition). The WhatsApp tenant "No, not yet" path passes a
      // canned phrase here; if the tenant later texts a follow-up reason,
      // it patches the attempt row directly and the live-feed entry stays
      // as-was (the resolution-history card surfaces the real text).
      resolution_summary:
        status === MaintenanceRequestStatusEnum.RESOLVED ? notes ?? null : null,
      reopen_message:
        status === MaintenanceRequestStatusEnum.REOPENED ? notes ?? null : null,
      updated_at: new Date(),
      actor,
    });

    return savedRequest;
  }

  private async createStatusHistoryEntry(
    maintenanceRequestId: string,
    previousStatus: MaintenanceRequestStatusEnum | null,
    newStatus: MaintenanceRequestStatusEnum,
    changedByUserId: string,
    changedByRole: string,
    changeReason?: string,
    notes?: string,
    manager?: EntityManager,
  ): Promise<MaintenanceRequestStatusHistory> {
    const repo = manager
      ? manager.getRepository(MaintenanceRequestStatusHistory)
      : this.statusHistoryRepository;
    const historyEntry = repo.create({
      maintenance_request_id: maintenanceRequestId,
      previous_status: previousStatus,
      new_status: newStatus,
      changed_by_user_id: changedByUserId,
      changed_by_role: changedByRole,
      change_reason: changeReason,
      notes: notes,
      changed_at: new Date(),
    });

    return await repo.save(historyEntry);
  }

  /**
   * Verifies the caller (by Account.id) owns the request's property or
   * common area. Both owner columns hold the landlord's Account.id, so a
   * direct compare covers both scopes. Throws 403 otherwise.
   */
  private async assertLandlordOwnsRequest(
    sr: MaintenanceRequest,
    actorAccountId: string,
  ): Promise<void> {
    const ownerAccountId =
      sr.property?.owner_id ?? sr.common_area?.owner_id ?? null;
    // The actor may be the owning landlord themselves (WhatsApp flow) OR an
    // admin acting on their behalf (dashboard). Either is allowed; anyone else
    // is rejected.
    if (ownerAccountId && ownerAccountId === actorAccountId) {
      return;
    }
    if (
      ownerAccountId &&
      (await this.scopeService.managesLandlord(actorAccountId, ownerAccountId))
    ) {
      return;
    }
    throw new HttpException('You do not own this request', HttpStatus.FORBIDDEN);
  }

  /**
   * Landlord assigns / reassigns / unassigns the FM handling a request.
   * The assignee (if any) must be a FACILITY_MANAGER team_member on the
   * caller's own team. Writes a status-history row capturing the change.
   * No-ops when the new assignee equals the current one.
   */
  async setAssignee(
    requestId: string,
    teamMemberId: string | null,
    landlordAccountId: string,
  ): Promise<MaintenanceRequest> {
    const sr = await this.maintenanceRequestRepository.findOne({
      where: { id: requestId },
      relations: ['property', 'common_area'],
    });
    if (!sr) {
      throw new NotFoundException('Maintenance request not found');
    }

    await this.assertLandlordOwnsRequest(sr, landlordAccountId);

    // Block reassignment on terminal and pre-approval-tenant-confirmation
    // requests. The endpoint would otherwise mutate `assigned_to` and fire a
    // WhatsApp notification for work that's already done (or not yet eligible
    // for assignment) — see the frontend gate in
    // MaintenanceRequestDetailModal. Pairing both sides closes the devtools /
    // direct-API bypass.
    const ASSIGNMENT_LOCKED_STATUSES: MaintenanceRequestStatusEnum[] = [
      MaintenanceRequestStatusEnum.CLOSED,
      MaintenanceRequestStatusEnum.REJECTED,
      MaintenanceRequestStatusEnum.DENIED_BY_TENANT,
      MaintenanceRequestStatusEnum.PENDING_TENANT_CONFIRMATION,
    ];
    if (ASSIGNMENT_LOCKED_STATUSES.includes(sr.status)) {
      throw new HttpException(
        `Cannot reassign a request in status "${sr.status}"`,
        HttpStatus.CONFLICT,
      );
    }

    let newAssigneeTm: TeamMember | null = null;
    if (teamMemberId) {
      newAssigneeTm = await this.teamMemberRepository.findOne({
        where: { id: teamMemberId },
        relations: ['team', 'account', 'account.user'],
      });
      if (!newAssigneeTm) {
        throw new HttpException(
          'Facility manager not found',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (newAssigneeTm.team?.creatorId !== landlordAccountId) {
        throw new HttpException(
          'Assignee must be a facility manager on your team',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (newAssigneeTm.role !== RolesEnum.FACILITY_MANAGER) {
        throw new HttpException(
          'Assignee must be a facility manager',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
    }

    const previousAssignee = sr.assigned_to ?? null;
    if (previousAssignee === teamMemberId) {
      return sr;
    }

    const previousAssigneeTm = previousAssignee
      ? await this.teamMemberRepository.findOne({
          where: { id: previousAssignee },
          relations: ['account', 'account.user'],
        })
      : null;

    await this.maintenanceRequestRepository.update(requestId, {
      assigned_to: teamMemberId as any,
    });

    // Record the change in status-history. This is not a status transition —
    // we keep prev_status === new_status and lean on `change_reason` for the
    // audit-trail rendering. Names beat raw UUIDs so the activity log stays
    // human-readable.
    const landlordUserId = await this.resolveActorUserId(landlordAccountId);
    await this.createStatusHistoryEntry(
      requestId,
      sr.status,
      sr.status,
      landlordUserId,
      'landlord',
      `assignee_changed: ${this.formatTeamMemberLabel(previousAssigneeTm)} → ${this.formatTeamMemberLabel(newAssigneeTm)}`,
    );

    try {
      this.eventEmitter.emit('maintenance.assigned', {
        maintenance_request_id: requestId,
        request_id: sr.request_id,
        previous_assignee: previousAssignee,
        previous_assignee_name: this.formatTeamMemberLabel(previousAssigneeTm),
        new_assignee: teamMemberId,
        new_assignee_name: this.formatTeamMemberLabel(newAssigneeTm),
        landlord_id: landlordAccountId,
        property_id: sr.property_id,
        common_area_id: sr.common_area_id,
        description: sr.description,
        tenant_id: sr.tenant_id,
        created_at: new Date(),
      });
    } catch (error) {
      this.logger.error('Failed to emit service.assigned event:', error);
    }

    return this.maintenanceRequestRepository.findOne({
      where: { id: requestId },
      relations: ['property', 'common_area', 'facilityManager'],
    }) as Promise<MaintenanceRequest>;
  }

  /**
   * Landlord toggles the priority flag on one of their maintenance requests.
   * No status_history row — priority is metadata, not a transition.
   */
  async setPriority(
    requestId: string,
    isPriority: boolean,
    landlordAccountId: string,
  ): Promise<MaintenanceRequest> {
    const sr = await this.maintenanceRequestRepository.findOne({
      where: { id: requestId },
      relations: ['property', 'common_area'],
    });
    if (!sr) {
      throw new NotFoundException('Maintenance request not found');
    }

    await this.assertLandlordOwnsRequest(sr, landlordAccountId);

    // Priority is meaningful only while the request is actionable. Setting
    // priority on a not-yet-approved or already-finished request would be
    // a no-op signal, so reject. Clearing is always allowed so a landlord
    // can fix a stale flag from any state.
    if (
      isPriority &&
      sr.status !== MaintenanceRequestStatusEnum.APPROVED &&
      sr.status !== MaintenanceRequestStatusEnum.REOPENED
    ) {
      throw new HttpException(
        'Priority can only be set on approved or reopened requests',
        HttpStatus.CONFLICT,
      );
    }

    if (sr.is_priority === isPriority) {
      return sr;
    }

    await this.maintenanceRequestRepository.update(requestId, {
      is_priority: isPriority,
    });

    // Push to open clients so the Priority pill appears/disappears live.
    // We use a dedicated event (not `maintenance.updated`) because priority
    // is metadata — we don't want the notifications listener to write a
    // status-change notification row, or the history listener to write a
    // misleading property_history entry. Only the websocket bridge listens
    // to this event.
    this.eventEmitter.emit('maintenance.priority_changed', {
      request_id: requestId,
      is_priority: isPriority,
      property_id: sr.property_id,
      common_area_id: sr.common_area_id,
      landlord_id:
        sr.property?.owner_id ?? sr.common_area?.owner_id ?? null,
      tenant_name: sr.tenant_name,
      property_name: sr.property_name,
      description: sr.description,
      status: sr.status,
    });

    return this.maintenanceRequestRepository.findOne({
      where: { id: requestId },
      relations: [
        'property',
        'common_area',
        'facilityManager',
        'facilityManager.account',
        'facilityManager.account.user',
      ],
    }) as Promise<MaintenanceRequest>;
  }

  /**
   * Tenant confirms an FM-filed maintenance request via dashboard or WhatsApp.
   * Auth: caller's Account.id must match sr.tenant_id. Status must be
   * PENDING_TENANT_CONFIRMATION — anything else 409s so a stale-tap from
   * WhatsApp can render `staleTapReply`-style copy.
   *
   * Transitions PENDING_TENANT_CONFIRMATION → NOT_APPROVED so the existing
   * landlord approve/reject + FM-picker flow takes over.
   */
  async confirmTenantMaintenanceRequest(
    requestId: string,
    tenantAccountId: string,
    source: 'dashboard' | 'whatsapp' = 'dashboard',
  ): Promise<MaintenanceRequest> {
    const sr = await this.maintenanceRequestRepository.findOne({
      where: { id: requestId },
      relations: ['property', 'common_area', 'tenant', 'tenant.user'],
    });
    if (!sr) {
      throw new NotFoundException('Maintenance request not found');
    }
    if (sr.tenant_id !== tenantAccountId) {
      throw new HttpException(
        'You cannot act on this request',
        HttpStatus.FORBIDDEN,
      );
    }
    if (sr.status !== MaintenanceRequestStatusEnum.PENDING_TENANT_CONFIRMATION) {
      throw new HttpException(
        `Request is no longer awaiting your confirmation (current status: ${sr.status})`,
        HttpStatus.CONFLICT,
      );
    }

    const previousStatus = sr.status;
    const tenantUserId = sr.tenant?.user?.id;
    if (!tenantUserId) {
      throw new HttpException(
        'Could not resolve tenant user for audit log',
        HttpStatus.UNAUTHORIZED,
      );
    }

    // Landlord-filed MRs skip the NOT_APPROVED interstitial because there's
    // no separate approval step — the landlord is the creator. Tenant-confirm
    // auto-approves and (if an FM was picked at create time) fires the
    // assignment notification right now.
    const isLandlordFiled =
      sr.creator_type === MaintenanceRequestCreatorTypeEnum.LANDLORD;
    const newStatus = isLandlordFiled
      ? MaintenanceRequestStatusEnum.APPROVED
      : MaintenanceRequestStatusEnum.NOT_APPROVED;

    await this.dataSource.transaction(async (manager) => {
      await manager.update(MaintenanceRequest, requestId, {
        status: newStatus,
        ...(isLandlordFiled ? { approved_at: new Date() } : {}),
      });
      await this.createStatusHistoryEntry(
        requestId,
        previousStatus,
        newStatus,
        tenantUserId,
        'tenant',
        `Tenant confirmed via ${source === 'whatsapp' ? 'WhatsApp' : 'Dashboard'}`,
        undefined,
        manager,
      );
      // Intentionally no attempt-row patch here: this transition confirms
      // the FM-filed *creation* gate, not a resolution. Resolution-attempt
      // rows don't exist until the FM actually resolves the request.
    });

    const updated = await this.maintenanceRequestRepository.findOne({
      where: { id: requestId },
      relations: [
        'property',
        'common_area',
        'tenant',
        'tenant.user',
        'facilityManager',
        'facilityManager.account',
        'facilityManager.account.user',
      ],
    });

    if (updated) {
      try {
        this.eventEmitter.emit('maintenance.tenant_confirmed', {
          request_id: updated.id,
          maintenance_request_id: updated.id,
          status: updated.status,
          previous_status: previousStatus,
          tenant_id: updated.tenant_id,
          tenant_name: updated.tenant_name,
          property_id: updated.property_id,
          property_name: updated.property_name,
          common_area_id: updated.common_area_id,
          landlord_id:
            updated.property?.owner_id ?? updated.common_area?.owner_id ?? null,
          creator_type: updated.creator_type,
          creator_user_id: updated.creator_user_id,
          description: updated.description,
          updated_at: new Date(),
          forced_by_landlord: false,
        });
      } catch (error) {
        this.logger.error(
          'Failed to emit maintenance.tenant_confirmed:',
          error,
        );
      }

      // Mirror the maintenance.updated emit on every status-change path so
      // downstream listeners (WS bridge → live-feed cache invalidation, etc.)
      // refresh in lockstep with the in-app notification created by the
      // tenant_confirmed listener above. The `skip_in_app_notification` flag
      // prevents handleUpdate from writing a duplicate notification row —
      // the tenant_confirmed listener already wrote the specific one.
      try {
        this.eventEmitter.emit('maintenance.updated', {
          request_id: updated.id,
          status: updated.status,
          previous_status: previousStatus,
          tenant_name: updated.tenant_name,
          property_name: updated.property_name,
          property_id: updated.property_id,
          common_area_id: updated.common_area_id,
          common_area_name: updated.common_area?.name ?? null,
          landlord_id:
            updated.property?.owner_id ?? updated.common_area?.owner_id ?? null,
          tenant_id: updated.tenant_id,
          creator_type: updated.creator_type,
          creator_user_id: updated.creator_user_id,
          description: updated.description,
          updated_at: new Date(),
          actor: { id: tenantUserId, role: 'tenant' },
          skip_in_app_notification: true,
        });
      } catch (error) {
        this.logger.error(
          'Failed to emit maintenance.updated after tenant confirm:',
          error,
        );
      }

      // Landlord-filed branch: if an FM was pre-assigned at creation, fan
      // out the assignment ping now (the FM was kept silent during the
      // tenant-confirmation gate to avoid pinging them about work that
      // might get denied).
      if (isLandlordFiled && updated.assigned_to && updated.facilityManager) {
        const fmTm = updated.facilityManager;
        const fmName = this.formatTeamMemberLabel(fmTm);
        try {
          this.eventEmitter.emit('maintenance.assigned', {
            maintenance_request_id: updated.id,
            request_id: updated.request_id,
            previous_assignee: null,
            previous_assignee_name: 'unassigned',
            new_assignee: updated.assigned_to,
            new_assignee_name: fmName,
            landlord_id:
              updated.property?.owner_id ??
              updated.common_area?.owner_id ??
              null,
            property_id: updated.property_id,
            common_area_id: updated.common_area_id,
            description: updated.description,
            tenant_id: updated.tenant_id,
            created_at: new Date(),
          });
        } catch (error) {
          this.logger.error(
            'Failed to emit maintenance.assigned after tenant confirmation:',
            error,
          );
        }
      }
    }

    return updated as MaintenanceRequest;
  }

  /**
   * Tenant denies an FM-filed maintenance request. Optional reason is
   * captured in the existing `rejection_reason` column (re-used). Terminal:
   * the request lands in DENIED_BY_TENANT and stays there for audit.
   */
  async denyTenantMaintenanceRequest(
    requestId: string,
    tenantAccountId: string,
    reason: string | null,
    source: 'dashboard' | 'whatsapp' = 'dashboard',
  ): Promise<MaintenanceRequest> {
    const sr = await this.maintenanceRequestRepository.findOne({
      where: { id: requestId },
      relations: ['property', 'common_area', 'tenant', 'tenant.user'],
    });
    if (!sr) {
      throw new NotFoundException('Maintenance request not found');
    }
    if (sr.tenant_id !== tenantAccountId) {
      throw new HttpException(
        'You cannot act on this request',
        HttpStatus.FORBIDDEN,
      );
    }
    if (sr.status !== MaintenanceRequestStatusEnum.PENDING_TENANT_CONFIRMATION) {
      throw new HttpException(
        `Request is no longer awaiting your confirmation (current status: ${sr.status})`,
        HttpStatus.CONFLICT,
      );
    }

    const previousStatus = sr.status;
    const tenantUserId = sr.tenant?.user?.id;
    if (!tenantUserId) {
      throw new HttpException(
        'Could not resolve tenant user for audit log',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const trimmedReason = reason?.trim() || null;

    await this.dataSource.transaction(async (manager) => {
      await manager.update(MaintenanceRequest, requestId, {
        status: MaintenanceRequestStatusEnum.DENIED_BY_TENANT,
        rejection_reason: trimmedReason,
      });
      await this.createStatusHistoryEntry(
        requestId,
        previousStatus,
        MaintenanceRequestStatusEnum.DENIED_BY_TENANT,
        tenantUserId,
        'tenant',
        `Tenant denied via ${source === 'whatsapp' ? 'WhatsApp' : 'Dashboard'}`,
        trimmedReason ?? undefined,
        manager,
      );
      // No attempt-row patch: this denies the FM-filed creation gate, not
      // a resolution. No attempt rows exist yet.
    });

    const updated = await this.maintenanceRequestRepository.findOne({
      where: { id: requestId },
      relations: ['property', 'common_area', 'tenant', 'tenant.user'],
    });

    if (updated) {
      try {
        this.eventEmitter.emit('maintenance.tenant_denied', {
          request_id: updated.id,
          maintenance_request_id: updated.id,
          status: updated.status,
          previous_status: previousStatus,
          tenant_id: updated.tenant_id,
          tenant_name: updated.tenant_name,
          property_id: updated.property_id,
          property_name: updated.property_name,
          common_area_id: updated.common_area_id,
          landlord_id:
            updated.property?.owner_id ?? updated.common_area?.owner_id ?? null,
          creator_type: updated.creator_type,
          creator_user_id: updated.creator_user_id,
          description: updated.description,
          denial_reason: trimmedReason,
          updated_at: new Date(),
        });
      } catch (error) {
        this.logger.error('Failed to emit maintenance.tenant_denied:', error);
      }
    }

    return updated as MaintenanceRequest;
  }

  /**
   * Patch the rejection_reason on an already-denied MR. Used by the tenant
   * WhatsApp flow: the deny *tap* commits the denial immediately (no reason);
   * if the tenant follows up with a reason within the 5-min window, this
   * method just amends the existing row. Does NOT re-emit a landlord WA ping —
   * the landlord already got the denial notification on the original deny;
   * the reason surfaces in the dashboard activity feed.
   */
  async updateTenantDenialReason(
    requestId: string,
    tenantAccountId: string,
    reason: string,
  ): Promise<MaintenanceRequest> {
    const trimmed = reason.trim();
    if (!trimmed) {
      // Treat empty as a no-op rather than wiping a real reason in case
      // multiple replies race.
      const sr = await this.maintenanceRequestRepository.findOne({
        where: { id: requestId },
      });
      if (!sr) throw new NotFoundException('Maintenance request not found');
      return sr;
    }

    const sr = await this.maintenanceRequestRepository.findOne({
      where: { id: requestId },
    });
    if (!sr) {
      throw new NotFoundException('Maintenance request not found');
    }
    if (sr.tenant_id !== tenantAccountId) {
      throw new HttpException(
        'You cannot act on this request',
        HttpStatus.FORBIDDEN,
      );
    }
    if (sr.status !== MaintenanceRequestStatusEnum.DENIED_BY_TENANT) {
      throw new HttpException(
        `Reason can only be added to a denied request (current status: ${sr.status})`,
        HttpStatus.CONFLICT,
      );
    }

    await this.maintenanceRequestRepository.update(requestId, {
      rejection_reason: trimmed,
    });

    await this.patchLatestAttemptDenialReason(
      requestId,
      tenantAccountId,
      trimmed,
    );

    return (await this.maintenanceRequestRepository.findOne({
      where: { id: requestId },
    })) as MaintenanceRequest;
  }

  /**
   * Landlord force-advances an MR stuck in PENDING_TENANT_CONFIRMATION
   * because the tenant has no phone / isn't responding. Same destination as
   * a tenant confirm (NOT_APPROVED), but the audit trail records that the
   * landlord made the call, and the listener skips re-pinging the landlord
   * via WhatsApp (they're already the one acting).
   */
  async landlordForceConfirmMaintenanceRequest(
    requestId: string,
    landlordAccountId: string,
  ): Promise<MaintenanceRequest> {
    const sr = await this.maintenanceRequestRepository.findOne({
      where: { id: requestId },
      relations: ['property', 'common_area'],
    });
    if (!sr) {
      throw new NotFoundException('Maintenance request not found');
    }

    // Common-area MRs never enter PENDING_TENANT_CONFIRMATION, so we only need
    // the property-owner branch here. The actor may be the owning landlord
    // (WhatsApp) or an admin managing them (dashboard).
    const ownerAccountId = sr.property?.owner_id ?? null;
    if (!ownerAccountId) {
      throw new HttpException(
        'You do not own this request',
        HttpStatus.FORBIDDEN,
      );
    }
    if (
      ownerAccountId !== landlordAccountId &&
      !(await this.scopeService.managesLandlord(
        landlordAccountId,
        ownerAccountId,
      ))
    ) {
      throw new HttpException(
        'You do not own this request',
        HttpStatus.FORBIDDEN,
      );
    }

    if (sr.status !== MaintenanceRequestStatusEnum.PENDING_TENANT_CONFIRMATION) {
      throw new HttpException(
        `Request is no longer awaiting tenant confirmation (current status: ${sr.status})`,
        HttpStatus.CONFLICT,
      );
    }

    const previousStatus = sr.status;
    const landlordUserId = await this.resolveActorUserId(landlordAccountId);

    // Same auto-approve rule as confirmTenantMaintenanceRequest: landlord-filed
    // MRs skip NOT_APPROVED entirely.
    const isLandlordFiled =
      sr.creator_type === MaintenanceRequestCreatorTypeEnum.LANDLORD;
    const newStatus = isLandlordFiled
      ? MaintenanceRequestStatusEnum.APPROVED
      : MaintenanceRequestStatusEnum.NOT_APPROVED;

    await this.dataSource.transaction(async (manager) => {
      await manager.update(MaintenanceRequest, requestId, {
        status: newStatus,
        ...(isLandlordFiled ? { approved_at: new Date() } : {}),
      });
      await this.createStatusHistoryEntry(
        requestId,
        previousStatus,
        newStatus,
        landlordUserId,
        'landlord',
        'Landlord force-confirmed (tenant unresponsive)',
        undefined,
        manager,
      );
      // Creation-gate force-confirm; no resolution attempt exists yet.
    });

    const updated = await this.maintenanceRequestRepository.findOne({
      where: { id: requestId },
      relations: [
        'property',
        'common_area',
        'tenant',
        'tenant.user',
        'facilityManager',
        'facilityManager.account',
        'facilityManager.account.user',
      ],
    });

    if (updated) {
      try {
        this.eventEmitter.emit('maintenance.tenant_confirmed', {
          request_id: updated.id,
          maintenance_request_id: updated.id,
          status: updated.status,
          previous_status: previousStatus,
          tenant_id: updated.tenant_id,
          tenant_name: updated.tenant_name,
          property_id: updated.property_id,
          property_name: updated.property_name,
          common_area_id: updated.common_area_id,
          landlord_id: landlordAccountId,
          creator_type: updated.creator_type,
          creator_user_id: updated.creator_user_id,
          description: updated.description,
          updated_at: new Date(),
          forced_by_landlord: true,
        });
      } catch (error) {
        this.logger.error(
          'Failed to emit maintenance.tenant_confirmed (force):',
          error,
        );
      }

      if (isLandlordFiled && updated.assigned_to && updated.facilityManager) {
        const fmTm = updated.facilityManager;
        const fmName = this.formatTeamMemberLabel(fmTm);
        try {
          this.eventEmitter.emit('maintenance.assigned', {
            maintenance_request_id: updated.id,
            request_id: updated.request_id,
            previous_assignee: null,
            previous_assignee_name: 'unassigned',
            new_assignee: updated.assigned_to,
            new_assignee_name: fmName,
            landlord_id: landlordAccountId,
            property_id: updated.property_id,
            common_area_id: updated.common_area_id,
            description: updated.description,
            tenant_id: updated.tenant_id,
            created_at: new Date(),
          });
        } catch (error) {
          this.logger.error(
            'Failed to emit maintenance.assigned after force-confirm:',
            error,
          );
        }
      }
    }

    return updated as MaintenanceRequest;
  }

  /**
   * Landlord rejects a maintenance request from WhatsApp. Only allowed from
   * NOT_APPROVED — anything already approved/assigned/closed has to take the
   * web-app path. Writes a status-history row and emits maintenance.updated
   * so the in-app notification listener fires.
   */
  async rejectMaintenanceRequest(
    requestId: string,
    landlordAccountId: string,
    reason?: string | null,
    source: 'dashboard' | 'whatsapp' = 'whatsapp',
  ): Promise<MaintenanceRequest> {
    const sr = await this.maintenanceRequestRepository.findOne({
      where: { id: requestId },
      relations: ['property', 'common_area'],
    });
    if (!sr) {
      throw new NotFoundException('Maintenance request not found');
    }

    await this.assertLandlordOwnsRequest(sr, landlordAccountId);

    if (sr.status !== MaintenanceRequestStatusEnum.NOT_APPROVED) {
      throw new HttpException(
        `Request is no longer pending approval (current status: ${sr.status})`,
        HttpStatus.CONFLICT,
      );
    }

    const previousStatus = sr.status;
    const landlordUserId = await this.resolveActorUserId(landlordAccountId);
    const trimmedReason = reason?.trim() || null;

    await this.dataSource.transaction(async (manager) => {
      await manager.update(MaintenanceRequest, requestId, {
        status: MaintenanceRequestStatusEnum.REJECTED,
        rejection_reason: trimmedReason,
      });
      await this.createStatusHistoryEntry(
        requestId,
        previousStatus,
        MaintenanceRequestStatusEnum.REJECTED,
        landlordUserId,
        'landlord',
        `Landlord rejected via ${source === 'whatsapp' ? 'WhatsApp' : 'Dashboard'}`,
        trimmedReason ?? undefined,
        manager,
      );
    });

    const updated = await this.maintenanceRequestRepository.findOne({
      where: { id: requestId },
      relations: ['property', 'common_area'],
    });

    if (updated) {
      try {
        this.eventEmitter.emit('maintenance.updated', {
          request_id: updated.id,
          status: updated.status,
          previous_status: previousStatus,
          tenant_name: updated.tenant_name,
          property_name: updated.property_name,
          property_id: updated.property_id,
          common_area_id: updated.common_area_id,
          common_area_name: updated.common_area?.name ?? null,
          landlord_id:
            updated.property?.owner_id ?? updated.common_area?.owner_id ?? null,
          tenant_id: updated.tenant_id,
          creator_type: updated.creator_type,
          creator_user_id: updated.creator_user_id,
          description: updated.description,
          updated_at: new Date(),
          actor: { id: landlordUserId, role: 'landlord' },
        });
      } catch (error) {
        this.logger.error(
          'Failed to emit maintenance.updated after reject:',
          error,
        );
      }
    }

    return updated as MaintenanceRequest;
  }

  /**
   * Landlord approves a maintenance request AND assigns an FM in a single
   * transaction — the WhatsApp Approve flow couples the two because the
   * FM "View all requests" surface hides NOT_APPROVED, so an assign
   * without an approve would silently strand the request.
   *
   * Source status must be NOT_APPROVED (409 otherwise). Emits both
   * `maintenance.updated` (status flip) and `maintenance.assigned`
   * (assignee change → fans out fm_assignment_notification to the whole
   * team). Sets `skip_approval_ping: true` on the updated event so the
   * listener doesn't ALSO send fm_maintenance_request_approved to the
   * assignee — the assignment notification already covers them.
   */
  async approveAndAssignMaintenanceRequest(
    requestId: string,
    teamMemberId: string,
    landlordAccountId: string,
    source: 'dashboard' | 'whatsapp' = 'dashboard',
  ): Promise<MaintenanceRequest> {
    const sr = await this.maintenanceRequestRepository.findOne({
      where: { id: requestId },
      relations: ['property', 'common_area'],
    });
    if (!sr) {
      throw new NotFoundException('Maintenance request not found');
    }

    await this.assertLandlordOwnsRequest(sr, landlordAccountId);

    if (sr.status !== MaintenanceRequestStatusEnum.NOT_APPROVED) {
      throw new HttpException(
        `Request is no longer pending approval (current status: ${sr.status})`,
        HttpStatus.CONFLICT,
      );
    }

    const tm = await this.teamMemberRepository.findOne({
      where: { id: teamMemberId },
      relations: ['team', 'account', 'account.user'],
    });
    if (!tm) {
      throw new HttpException(
        'Facility manager not found',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (tm.team?.creatorId !== landlordAccountId) {
      throw new HttpException(
        'Assignee must be a facility manager on your team',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (tm.role !== RolesEnum.FACILITY_MANAGER) {
      throw new HttpException(
        'Assignee must be a facility manager',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const fmUser = tm.account?.user;
    const fmName = fmUser
      ? `${fmUser.first_name ?? ''} ${fmUser.last_name ?? ''}`.trim() ||
        tm.email ||
        'Facility Manager'
      : tm.email || 'Facility Manager';

    const previousStatus = sr.status;
    const previousAssignee = sr.assigned_to ?? null;
    const previousAssigneeTm = previousAssignee
      ? await this.teamMemberRepository.findOne({
          where: { id: previousAssignee },
          relations: ['account', 'account.user'],
        })
      : null;
    const landlordUserId = await this.resolveActorUserId(landlordAccountId);

    await this.dataSource.transaction(async (manager) => {
      await manager.update(MaintenanceRequest, requestId, {
        status: MaintenanceRequestStatusEnum.APPROVED,
        assigned_to: teamMemberId as any,
        approved_at: new Date(),
      });
      await this.createStatusHistoryEntry(
        requestId,
        previousStatus,
        MaintenanceRequestStatusEnum.APPROVED,
        landlordUserId,
        'landlord',
        `Landlord approved & assigned to ${fmName} via ${source === 'whatsapp' ? 'WhatsApp' : 'dashboard'}`,
        undefined,
        manager,
      );
    });

    const updated = await this.maintenanceRequestRepository.findOne({
      where: { id: requestId },
      relations: [
        'property',
        'common_area',
        'facilityManager',
        'facilityManager.account',
        'facilityManager.account.user',
      ],
    });

    if (updated) {
      try {
        this.eventEmitter.emit('maintenance.updated', {
          request_id: updated.id,
          status: updated.status,
          previous_status: previousStatus,
          tenant_name: updated.tenant_name,
          property_name: updated.property_name,
          property_id: updated.property_id,
          common_area_id: updated.common_area_id,
          common_area_name: updated.common_area?.name ?? null,
          landlord_id: landlordAccountId,
          tenant_id: updated.tenant_id,
          creator_type: updated.creator_type,
          creator_user_id: updated.creator_user_id,
          description: updated.description,
          assigned_to_name: fmName,
          updated_at: new Date(),
          actor: { id: landlordUserId, role: 'landlord' },
          // Suppress the FM "request approved" template — the assignment
          // fan-out below already covers the assignee.
          skip_approval_ping: true,
        });
      } catch (error) {
        this.logger.error(
          'Failed to emit maintenance.updated after approve+assign:',
          error,
        );
      }

      try {
        this.eventEmitter.emit('maintenance.assigned', {
          maintenance_request_id: requestId,
          request_id: updated.request_id,
          previous_assignee: previousAssignee,
          previous_assignee_name:
            this.formatTeamMemberLabel(previousAssigneeTm),
          new_assignee: teamMemberId,
          new_assignee_name: fmName,
          landlord_id: landlordAccountId,
          property_id: updated.property_id,
          common_area_id: updated.common_area_id,
          description: updated.description,
          tenant_id: updated.tenant_id,
          created_at: new Date(),
        });
      } catch (error) {
        this.logger.error(
          'Failed to emit maintenance.assigned after approve+assign:',
          error,
        );
      }
    }

    return updated as MaintenanceRequest;
  }

  /**
   * Append extra detail a tenant added shortly after filing (e.g. "it's getting
   * worse" / "forgot to mention the upstairs one") to the SAME request, rather
   * than creating a duplicate. Used by the WhatsApp tenant AI when it judges a
   * follow-up message to be elaboration on the just-filed request.
   *
   * Guards: the request must have been created by this tenant, and must still be
   * actionable — appending to a resolved/closed/rejected request is refused
   * (returns null). No re-notification: the FM/landlord see the fuller text when
   * they next open the request; the status-history row records the addition.
   */
  async appendTenantRequestDetail(
    requestId: string,
    tenantUserId: string,
    addition: string,
  ): Promise<MaintenanceRequest | null> {
    const extra = (addition || '').trim();
    if (!extra) return null;

    const sr = await this.maintenanceRequestRepository.findOne({
      where: { id: requestId },
    });
    if (!sr) return null;

    // Ownership: only the tenant who filed it can append (creator_user_id is the
    // tenant's Users.id, which is what the AI flow passes as tenantUserId).
    if (sr.creator_user_id !== tenantUserId) {
      this.logger.warn(
        `appendTenantRequestDetail: ${tenantUserId} is not the creator of ${requestId}`,
      );
      return null;
    }

    // Only append while the request is still actionable.
    const APPENDABLE_STATUSES: ReadonlyArray<MaintenanceRequestStatusEnum> = [
      MaintenanceRequestStatusEnum.NOT_APPROVED,
      MaintenanceRequestStatusEnum.APPROVED,
      MaintenanceRequestStatusEnum.REOPENED,
      MaintenanceRequestStatusEnum.PENDING_TENANT_CONFIRMATION,
    ];
    if (!APPENDABLE_STATUSES.includes(sr.status)) {
      return null;
    }

    sr.description = `${sr.description}\n\n— Tenant added: ${extra}`;
    await this.maintenanceRequestRepository.save(sr);

    await this.createStatusHistoryEntry(
      requestId,
      sr.status,
      sr.status,
      tenantUserId,
      'tenant',
      'Tenant added detail via WhatsApp',
    );

    return sr;
  }

  /**
   * Reopen a tenant's RESOLVED request when they say it isn't actually fixed —
   * the AI-driven equivalent of tapping "No" on the resolution-confirmation
   * prompt. Reuses updateStatus(REOPENED) (which bumps current_attempt, stamps
   * reopened_at, records the resolution-attempt outcome, and pings landlord +
   * FMs) and stores the tenant's explanation via appendReopenNoteWithDedup.
   *
   * Guards: must be the tenant's own request, and must currently be RESOLVED
   * (awaiting their confirmation). A CLOSED request is NOT reopenable here —
   * callers file a new request for a recurrence. Returns the new attempt number
   * (so fresh media can be tagged to it), or null if it couldn't be reopened.
   */
  async reopenTenantRequest(
    requestId: string,
    tenantUserId: string,
    reason: string,
  ): Promise<{ attempt: number } | null> {
    const sr = await this.maintenanceRequestRepository.findOne({
      where: { id: requestId },
      relations: ['tenant', 'tenant.user'],
    });
    if (!sr) return null;
    if (sr.tenant?.user?.id !== tenantUserId) {
      this.logger.warn(
        `reopenTenantRequest: ${tenantUserId} is not the tenant of ${requestId}`,
      );
      return null;
    }
    if (sr.status !== MaintenanceRequestStatusEnum.RESOLVED) return null;

    const trimmed = (reason || '').trim();
    const note =
      trimmed || 'Tenant reported the issue is not fully resolved via WhatsApp';
    const name =
      `${sr.tenant.user.first_name ?? ''} ${sr.tenant.user.last_name ?? ''}`.trim() ||
      'Tenant';

    await this.updateStatus(
      requestId,
      MaintenanceRequestStatusEnum.REOPENED,
      note,
      { id: tenantUserId, role: 'tenant', name },
    );
    if (trimmed) {
      await this.appendReopenNoteWithDedup(
        requestId,
        tenantUserId,
        'tenant',
        trimmed,
      );
    }

    const reopened = await this.maintenanceRequestRepository.findOne({
      where: { id: requestId },
    });
    return { attempt: reopened?.current_attempt ?? 2 };
  }

  /**
   * Close a tenant's RESOLVED request when they confirm it's actually fixed —
   * the AI-driven equivalent of tapping "Yes, it's fixed" on the
   * resolution-confirmation prompt. Reuses updateStatus(CLOSED) (which records
   * the resolution-attempt outcome as CONFIRMED and emits maintenance.updated).
   * Guards: must be the tenant's own request and currently RESOLVED. Returns
   * true if it closed, false otherwise. The caller sends the closed WhatsApp
   * notification to stakeholders (mirrors the existing button handler).
   */
  async confirmTenantRequestResolved(
    requestId: string,
    tenantUserId: string,
  ): Promise<boolean> {
    const sr = await this.maintenanceRequestRepository.findOne({
      where: { id: requestId },
      relations: ['tenant', 'tenant.user'],
    });
    if (!sr) return false;
    if (sr.tenant?.user?.id !== tenantUserId) {
      this.logger.warn(
        `confirmTenantRequestResolved: ${tenantUserId} is not the tenant of ${requestId}`,
      );
      return false;
    }
    if (sr.status !== MaintenanceRequestStatusEnum.RESOLVED) return false;

    const name =
      `${sr.tenant.user.first_name ?? ''} ${sr.tenant.user.last_name ?? ''}`.trim() ||
      'Tenant';
    await this.updateStatus(
      requestId,
      MaintenanceRequestStatusEnum.CLOSED,
      'Tenant confirmed issue is fully resolved via WhatsApp',
      { id: tenantUserId, role: 'tenant', name },
    );
    return true;
  }

  /**
   * Every FM on the landlord's team. Used for stakeholder fan-out when a
   * maintenance request is filed (or any other property-level event that
   * should notify the whole team rather than a single per-property FM).
   */
  async findTeamFmsForLandlord(
    landlordAccountId: string,
  ): Promise<TeamMember[]> {
    // Post-reparent the FMs sit on the managing admin's team, not the
    // landlord's own; accept either as the team owner (see
    // resolveTeamOwnersForLandlord) so fan-out still reaches the whole team.
    const acceptableTeamOwners =
      await this.scopeService.resolveTeamOwnersForLandlord(landlordAccountId);
    if (!acceptableTeamOwners.length) return [];
    return this.teamMemberRepository
      .createQueryBuilder('tm')
      .leftJoinAndSelect('tm.account', 'account')
      .leftJoinAndSelect('account.user', 'user')
      .innerJoin('tm.team', 'team')
      .where('team.creatorId IN (:...teamOwnerIds)', {
        teamOwnerIds: acceptableTeamOwners,
      })
      .andWhere('tm.role = :role', { role: RolesEnum.FACILITY_MANAGER })
      .getMany();
  }
}
