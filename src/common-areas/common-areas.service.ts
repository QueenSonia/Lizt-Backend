import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CommonArea } from './entities/common-area.entity';
import { CreateCommonAreaDto } from './dto/create-common-area.dto';
import { UpdateCommonAreaDto } from './dto/update-common-area.dto';
import { MaintenanceRequest } from '../maintenance-requests/entities/maintenance-request.entity';
import {
  MaintenanceRequestScopeEnum,
  MaintenanceRequestStatusEnum,
} from '../maintenance-requests/dto/create-maintenance-request.dto';
import { TeamMember } from '../users/entities/team-member.entity';
import { Account } from '../users/entities/account.entity';
import { RolesEnum } from '../base.entity';
import { assertLandlordInScope } from '../common/scope/scope.util';
import { ManagementScopeService } from '../common/scope/management-scope.service';

export interface LandlordCommonAreaRow {
  id: string;
  name: string;
  address: string;
  created_at: Date;
  total_requests: number;
  open_requests: number;
}

export interface FmCommonAreaRow {
  id: string;
  name: string;
  address: string;
  owner_id: string;
  owner_name: string;
  created_at: Date;
  total_requests: number;
  open_requests: number;
}

@Injectable()
export class CommonAreasService {
  constructor(
    @InjectRepository(CommonArea)
    private readonly commonAreaRepository: Repository<CommonArea>,
    @InjectRepository(MaintenanceRequest)
    private readonly maintenanceRequestRepository: Repository<MaintenanceRequest>,
    @InjectRepository(TeamMember)
    private readonly teamMemberRepository: Repository<TeamMember>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    private readonly managementScopeService: ManagementScopeService,
  ) {}

  async create(
    dto: CreateCommonAreaDto,
    managedLandlordIds: string[],
  ): Promise<CommonArea> {
    // Act-on-behalf: created for the landlord named in the payload.
    assertLandlordInScope(managedLandlordIds, dto.landlord_id);
    const entity = this.commonAreaRepository.create({
      owner_id: dto.landlord_id,
      name: dto.name.trim(),
      address: dto.address.trim(),
    });
    return this.commonAreaRepository.save(entity);
  }

  async findAllForLandlord(
    ownerId: string | string[],
  ): Promise<LandlordCommonAreaRow[]> {
    const ownerIds = Array.isArray(ownerId) ? ownerId : [ownerId];
    if (!ownerIds.length) return [];
    const rows = await this.commonAreaRepository
      .createQueryBuilder('ca')
      .leftJoin(
        MaintenanceRequest,
        'sr',
        'sr.common_area_id = ca.id AND sr.deleted_at IS NULL',
      )
      .select('ca.id', 'id')
      .addSelect('ca.name', 'name')
      .addSelect('ca.address', 'address')
      .addSelect('ca.created_at', 'created_at')
      .addSelect('COUNT(sr.id)::int', 'total_requests')
      .addSelect(
        `COUNT(sr.id) FILTER (WHERE sr.status = :openStatus)::int`,
        'open_requests',
      )
      .where('ca.owner_id IN (:...ownerIds)', { ownerIds })
      .andWhere('ca.deleted_at IS NULL')
      .setParameter('openStatus', MaintenanceRequestStatusEnum.NOT_APPROVED)
      .groupBy('ca.id')
      .orderBy('ca.created_at', 'DESC')
      .getRawMany();

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      address: r.address,
      created_at: r.created_at,
      total_requests: Number(r.total_requests) || 0,
      open_requests: Number(r.open_requests) || 0,
    }));
  }

  async findAllForFm(fmAccountId: string): Promise<FmCommonAreaRow[]> {
    // Resolve the set of landlord (account) ids the FM is teamed with. After
    // the re-parent, team.creator is the managing ADMIN (not the landlord), so
    // we expand each team creator to the landlords it covers (admin → managed
    // landlords; legacy self-owned landlord team → the landlord itself).
    // common_areas.owner_id is the landlord's Account.id.
    const memberships = await this.teamMemberRepository
      .createQueryBuilder('tm')
      .innerJoin('tm.team', 'team')
      .select('team.creatorId', 'creatorId')
      .where('tm.accountId = :fmAccountId', { fmAccountId })
      .andWhere('tm.role = :role', { role: RolesEnum.FACILITY_MANAGER })
      .getRawMany<{ creatorId: string }>();

    const teamCreatorIds = Array.from(
      new Set(memberships.map((m) => m.creatorId).filter(Boolean)),
    );
    if (teamCreatorIds.length === 0) return [];

    const landlordAccountIds =
      await this.managementScopeService.resolveLandlordsForTeamCreators(
        teamCreatorIds,
      );
    if (landlordAccountIds.length === 0) return [];

    // Display names come from the actual landlord accounts, not the team owner
    // (which is the admin after the re-parent).
    const landlordAccounts = await this.accountRepository.find({
      where: { id: In(landlordAccountIds) },
      relations: ['user'],
    });
    const landlordAccountIdToName = new Map<string, string>();
    for (const acct of landlordAccounts) {
      const user = acct.user;
      const name =
        acct.profile_name?.trim() ||
        [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim() ||
        user?.email ||
        'Landlord';
      landlordAccountIdToName.set(acct.id, name);
    }

    const rows = await this.commonAreaRepository
      .createQueryBuilder('ca')
      .leftJoin(
        MaintenanceRequest,
        'sr',
        'sr.common_area_id = ca.id AND sr.deleted_at IS NULL',
      )
      .select('ca.id', 'id')
      .addSelect('ca.name', 'name')
      .addSelect('ca.address', 'address')
      .addSelect('ca.owner_id', 'owner_id')
      .addSelect('ca.created_at', 'created_at')
      .addSelect('COUNT(sr.id)::int', 'total_requests')
      .addSelect(
        `COUNT(sr.id) FILTER (WHERE sr.status = :openStatus)::int`,
        'open_requests',
      )
      .where('ca.owner_id IN (:...ownerIds)', { ownerIds: landlordAccountIds })
      .andWhere('ca.deleted_at IS NULL')
      .setParameter('openStatus', MaintenanceRequestStatusEnum.NOT_APPROVED)
      .groupBy('ca.id')
      .orderBy('ca.created_at', 'DESC')
      .getRawMany();

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      address: r.address,
      owner_id: r.owner_id,
      owner_name: landlordAccountIdToName.get(r.owner_id) ?? 'Landlord',
      created_at: r.created_at,
      total_requests: Number(r.total_requests) || 0,
      open_requests: Number(r.open_requests) || 0,
    }));
  }

  async findOne(
    id: string,
    managedLandlordIds: string[],
  ): Promise<CommonArea> {
    const area = await this.commonAreaRepository.findOne({
      where: { id },
      relations: ['owner'],
    });
    if (!area) {
      throw new NotFoundException(`Common area with id ${id} not found`);
    }
    assertLandlordInScope(managedLandlordIds, area.owner_id);
    return area;
  }

  async update(
    id: string,
    dto: UpdateCommonAreaDto,
    managedLandlordIds: string[],
  ): Promise<CommonArea> {
    const area = await this.commonAreaRepository.findOne({ where: { id } });
    if (!area) {
      throw new NotFoundException(`Common area with id ${id} not found`);
    }
    assertLandlordInScope(managedLandlordIds, area.owner_id);
    if (dto.name !== undefined) area.name = dto.name.trim();
    if (dto.address !== undefined) area.address = dto.address.trim();
    return this.commonAreaRepository.save(area);
  }

  async softDelete(
    id: string,
    managedLandlordIds: string[],
  ): Promise<{ deleted: true }> {
    const area = await this.commonAreaRepository.findOne({ where: { id } });
    if (!area) {
      throw new NotFoundException(`Common area with id ${id} not found`);
    }
    assertLandlordInScope(managedLandlordIds, area.owner_id);
    await this.commonAreaRepository.softDelete(id);
    return { deleted: true };
  }

  /**
   * Returns true when `fmAccountId` is a facility manager teamed with the
   * landlord account `ownerAccountId`. Used by the maintenance-requests create
   * flow to gate FM-on-common-area writes.
   */
  async isFmTeamedWithOwner(
    fmAccountId: string,
    ownerAccountId: string,
  ): Promise<boolean> {
    // Accept the landlord's own team (legacy) or the managing admin's team
    // (post-reparent) as the owning team — see resolveTeamOwnersForLandlord.
    const acceptableTeamOwners =
      await this.managementScopeService.resolveTeamOwnersForLandlord(
        ownerAccountId,
      );
    if (!acceptableTeamOwners.length) return false;
    const match = await this.teamMemberRepository
      .createQueryBuilder('tm')
      .innerJoin('tm.team', 'team')
      .where('tm.accountId = :fmAccountId', { fmAccountId })
      .andWhere('tm.role = :role', { role: RolesEnum.FACILITY_MANAGER })
      .andWhere('team.creatorId IN (:...teamOwnerIds)', {
        teamOwnerIds: acceptableTeamOwners,
      })
      .getOne();
    return !!match;
  }
}
