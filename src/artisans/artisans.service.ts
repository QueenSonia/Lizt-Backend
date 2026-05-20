import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Artisan } from './entities/artisan.entity';
import { Team } from '../users/entities/team.entity';
import { TeamMember } from '../users/entities/team-member.entity';
import { Account } from '../users/entities/account.entity';
import { UtilService } from '../utils/utility-service';

interface FindOrCreateForResolutionArgs {
  teamId: string;
  name: string;
  phone: string;
  createdByAccountId: string;
  // true → if a row matches by phone with a different stored name, rename it.
  // false/undefined → leave stored name alone (typed name still goes into the
  // maintenance_request's artisan_name_snapshot column).
  renameIfExists?: boolean;
}

@Injectable()
export class ArtisansService {
  private readonly logger = new Logger(ArtisansService.name);

  constructor(
    @InjectRepository(Artisan)
    private readonly artisanRepo: Repository<Artisan>,
    @InjectRepository(Team)
    private readonly teamRepo: Repository<Team>,
    @InjectRepository(TeamMember)
    private readonly teamMemberRepo: Repository<TeamMember>,
    private readonly utilService: UtilService,
  ) {}

  // Resolve the team_id an FM or landlord caller belongs to.
  //  - FM: TeamMember row keyed by their account id.
  //  - Landlord: their own Team where creatorId = account.id.
  // Auto-creates the landlord's team if none exists yet (matches the lazy
  // creation pattern in TeamService.getTeamMembers — landlords resolving a task
  // before any FM is invited shouldn't be blocked).
  async resolveCallerTeamId(account: Account): Promise<string> {
    const member = await this.teamMemberRepo.findOne({
      where: { accountId: account.id },
    });
    if (member) return member.teamId;

    const existing = await this.teamRepo.findOne({
      where: { creatorId: account.id },
    });
    if (existing) return existing.id;

    const name =
      account.profile_name && account.profile_name.trim().length > 0
        ? `${account.profile_name} Team`
        : 'My Team';
    const created = await this.teamRepo.save(
      this.teamRepo.create({ name, creatorId: account.id }),
    );
    return created.id;
  }

  async suggest(teamId: string, q: string, limit = 8): Promise<Artisan[]> {
    const trimmed = q.trim();
    if (!trimmed) return [];

    // Phone-form search: digits-only fragment matched against the canonical
    // form. Name-form search: case-insensitive substring.
    const digits = trimmed.replace(/\D/g, '');
    const nameLike = `%${trimmed.toLowerCase()}%`;

    const qb = this.artisanRepo
      .createQueryBuilder('a')
      .where('a.team_id = :teamId', { teamId })
      .andWhere(
        digits.length >= 3
          ? '(LOWER(a.name) LIKE :nameLike OR a.phone LIKE :phoneLike)'
          : 'LOWER(a.name) LIKE :nameLike',
        { nameLike, phoneLike: `%${digits}%` },
      )
      // Most-recently-used artisans first. Falls back to created_at so
      // freshly-added rows with no resolutions yet aren't buried.
      .leftJoin(
        'maintenance_requests',
        'mr',
        'mr.artisan_id = a.id AND mr.resolvedAt IS NOT NULL',
      )
      .addSelect('MAX(mr."resolvedAt")', 'last_used_at')
      .groupBy('a.id')
      .orderBy('MAX(mr."resolvedAt")', 'DESC', 'NULLS LAST')
      .addOrderBy('a.created_at', 'DESC')
      .limit(limit);

    return qb.getMany();
  }

  async lookupByPhone(
    teamId: string,
    phoneRaw: string,
  ): Promise<Artisan | null> {
    const normalized = this.utilService.normalizePhoneNumber(phoneRaw);
    if (!normalized) return null;
    return this.artisanRepo.findOne({
      where: { team_id: teamId, phone: normalized },
    });
  }

  async findOrCreateForResolution(
    args: FindOrCreateForResolutionArgs,
  ): Promise<Artisan> {
    const phone = this.utilService.normalizePhoneNumber(args.phone);
    const name = args.name.trim();

    if (!name) {
      throw new HttpException(
        'artisan name is required',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!/^234[0-9]{10}$/.test(phone)) {
      throw new HttpException(
        'artisan phone is not a valid Nigerian number',
        HttpStatus.BAD_REQUEST,
      );
    }

    const existing = await this.artisanRepo.findOne({
      where: { team_id: args.teamId, phone },
    });

    if (!existing) {
      try {
        const created = this.artisanRepo.create({
          team_id: args.teamId,
          name,
          phone,
          created_by_account_id: args.createdByAccountId,
        });
        return await this.artisanRepo.save(created);
      } catch (err) {
        // Race: another resolve in the same team raced us with the same phone.
        // Re-read and return.
        const after = await this.artisanRepo.findOne({
          where: { team_id: args.teamId, phone },
        });
        if (after) return after;
        throw err;
      }
    }

    const namesMatch = existing.name.trim().toLowerCase() === name.toLowerCase();
    if (!namesMatch && args.renameIfExists) {
      existing.name = name;
      return this.artisanRepo.save(existing);
    }
    return existing;
  }
}
