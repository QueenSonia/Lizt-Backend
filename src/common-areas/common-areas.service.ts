import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CommonArea } from './entities/common-area.entity';
import { CreateCommonAreaDto } from './dto/create-common-area.dto';
import { UpdateCommonAreaDto } from './dto/update-common-area.dto';
import { MaintenanceRequest } from '../maintenance-requests/entities/maintenance-request.entity';
import {
  MaintenanceRequestScopeEnum,
  MaintenanceRequestStatusEnum,
} from '../maintenance-requests/dto/create-maintenance-request.dto';
import { TeamMember } from '../users/entities/team-member.entity';
import { RolesEnum } from '../base.entity';

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
  ) {}

  async create(
    ownerId: string,
    dto: CreateCommonAreaDto,
  ): Promise<CommonArea> {
    const entity = this.commonAreaRepository.create({
      owner_id: ownerId,
      name: dto.name.trim(),
      address: dto.address.trim(),
    });
    return this.commonAreaRepository.save(entity);
  }

  async findAllForLandlord(
    ownerId: string,
  ): Promise<LandlordCommonAreaRow[]> {
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
      .where('ca.owner_id = :ownerId', { ownerId })
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
    // Resolve the set of landlord (account) ids the FM is teamed with.
    // common_areas.owner_id is the landlord's Account.id, so we key everything
    // off team.creator (the landlord's Account) directly.
    const teamMemberships = await this.teamMemberRepository
      .createQueryBuilder('tm')
      .innerJoinAndSelect('tm.team', 'team')
      .innerJoinAndSelect('team.creator', 'creatorAccount')
      .leftJoinAndSelect('creatorAccount.user', 'landlordUser')
      .where('tm.accountId = :fmAccountId', { fmAccountId })
      .andWhere('tm.role = :role', { role: RolesEnum.FACILITY_MANAGER })
      .getMany();

    if (teamMemberships.length === 0) return [];

    const landlordAccountIdToName = new Map<string, string>();
    for (const tm of teamMemberships) {
      const creatorAccount = tm.team?.creator;
      if (creatorAccount?.id) {
        const user = creatorAccount.user;
        const name =
          creatorAccount.profile_name?.trim() ||
          [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim() ||
          user?.email ||
          'Landlord';
        landlordAccountIdToName.set(creatorAccount.id, name);
      }
    }
    const landlordAccountIds = Array.from(landlordAccountIdToName.keys());
    if (landlordAccountIds.length === 0) return [];

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

  async findOne(id: string, requesterAccountId: string): Promise<CommonArea> {
    const area = await this.commonAreaRepository.findOne({
      where: { id },
      relations: ['owner'],
    });
    if (!area) {
      throw new NotFoundException(`Common area with id ${id} not found`);
    }
    await this.assertCanAccess(area, requesterAccountId);
    return area;
  }

  async update(
    id: string,
    ownerId: string,
    dto: UpdateCommonAreaDto,
  ): Promise<CommonArea> {
    const area = await this.commonAreaRepository.findOne({ where: { id } });
    if (!area) {
      throw new NotFoundException(`Common area with id ${id} not found`);
    }
    if (area.owner_id !== ownerId) {
      throw new HttpException(
        'You do not have permission to update this common area',
        HttpStatus.FORBIDDEN,
      );
    }
    if (dto.name !== undefined) area.name = dto.name.trim();
    if (dto.address !== undefined) area.address = dto.address.trim();
    return this.commonAreaRepository.save(area);
  }

  async softDelete(id: string, ownerId: string): Promise<{ deleted: true }> {
    const area = await this.commonAreaRepository.findOne({ where: { id } });
    if (!area) {
      throw new NotFoundException(`Common area with id ${id} not found`);
    }
    if (area.owner_id !== ownerId) {
      throw new HttpException(
        'You do not have permission to delete this common area',
        HttpStatus.FORBIDDEN,
      );
    }
    await this.commonAreaRepository.softDelete(id);
    return { deleted: true };
  }

  /**
   * Checks that `accountId` is either the owner of `area` (owner_id is the
   * landlord's Account.id) or a facility manager teamed with that owner.
   * Throws 403 otherwise.
   */
  private async assertCanAccess(
    area: CommonArea,
    accountId: string,
  ): Promise<void> {
    if (area.owner_id === accountId) return;
    const isTeamedWithOwner = await this.teamMemberRepository
      .createQueryBuilder('tm')
      .innerJoin('tm.team', 'team')
      .innerJoin('team.creator', 'creatorAccount')
      .where('tm.accountId = :accountId', { accountId })
      .andWhere('tm.role = :role', { role: RolesEnum.FACILITY_MANAGER })
      .andWhere('creatorAccount.id = :ownerId', { ownerId: area.owner_id })
      .getOne();
    if (!isTeamedWithOwner) {
      throw new HttpException(
        'You do not have permission to view this common area',
        HttpStatus.FORBIDDEN,
      );
    }
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
    const match = await this.teamMemberRepository
      .createQueryBuilder('tm')
      .innerJoin('tm.team', 'team')
      .innerJoin('team.creator', 'creatorAccount')
      .where('tm.accountId = :fmAccountId', { fmAccountId })
      .andWhere('tm.role = :role', { role: RolesEnum.FACILITY_MANAGER })
      .andWhere('creatorAccount.id = :ownerId', { ownerId: ownerAccountId })
      .getOne();
    return !!match;
  }
}
