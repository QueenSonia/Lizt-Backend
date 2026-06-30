import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ArrayContains, In, Repository } from 'typeorm';
import { RolesEnum } from 'src/base.entity';
import { Account } from 'src/users/entities/account.entity';
import { TeamMember } from 'src/users/entities/team-member.entity';
import { Users } from 'src/users/entities/user.entity';
import { resolveBrandingUser } from '../branding/branding.util';

/**
 * Minimal shape of the authenticated user we need for scoping. This matches
 * what `JwtAuthGuard` puts on `req.user`: the full Account spread with the
 * active session `role` (a {@link RolesEnum} value) overlaid from the JWT.
 */
export interface ScopeRequester {
  id: string;
  role?: string | null;
}

/**
 * Resolves "which landlords does this requester manage / may act for".
 *
 * The property-manager model expresses the whole hierarchy with one column:
 * `accounts.creator_id = <admin account id>` for every landlord AND facility
 * manager the admin created. A landlord-scoped query therefore becomes
 * `owner_id IN resolveScopeLandlordIds(req.user)` instead of
 * `owner_id = req.user.id`.
 *
 * NOTE for callers: an empty array means "no landlords in scope". Do NOT feed
 * an empty array into `IN (:...ids)` — TypeORM emits `IN ()` which is invalid
 * SQL. Guard with `if (!ids.length) return []` (or equivalent) before the query.
 */
@Injectable()
export class ManagementScopeService {
  constructor(
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(TeamMember)
    private readonly teamMemberRepository: Repository<TeamMember>,
  ) {}

  /**
   * Account ids of the landlords created by (i.e. managed by) this admin.
   * Soft-deleted accounts are excluded automatically by TypeORM.
   */
  async resolveManagedLandlordIds(adminAccountId: string): Promise<string[]> {
    if (!adminAccountId) return [];
    const rows = await this.accountRepository.find({
      where: {
        creator_id: adminAccountId,
        roles: ArrayContains([RolesEnum.LANDLORD]),
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /**
   * The admin account id(s) a facility manager works under, derived from the
   * team(s) they are a member of (`team.creatorId` is the admin after the
   * re-parent migration). Usually exactly one.
   */
  async resolveAdminIdsForFacilityManager(
    fmAccountId: string,
  ): Promise<string[]> {
    if (!fmAccountId) return [];
    const memberships = await this.teamMemberRepository.find({
      where: { accountId: fmAccountId, role: RolesEnum.FACILITY_MANAGER },
      relations: { team: true },
    });
    const adminIds = memberships
      .map((m) => m.team?.creatorId)
      .filter((id): id is string => Boolean(id));
    return Array.from(new Set(adminIds));
  }

  /**
   * The account ids permitted to "own the team" that serves landlord
   * `landlordId`'s properties and common areas: the landlord themselves
   * (pre-reparent, when each landlord owned their own team) and the admin who
   * manages them (post-reparent, `accounts.creator_id`). Feed the result to an
   * `IN (:...ids)` filter on `team.creatorId`, or membership-test against it.
   * Surviving both topologies keeps FM authorization working across the
   * re-parent migration window.
   */
  async resolveTeamOwnersForLandlord(landlordId: string): Promise<string[]> {
    if (!landlordId) return [];
    const account = await this.accountRepository.findOne({
      where: { id: landlordId },
      select: { id: true, creator_id: true },
    });
    const ids = new Set<string>([landlordId]);
    if (account?.creator_id) ids.add(account.creator_id);
    return Array.from(ids);
  }

  /**
   * The user whose branding/logo a tenant-facing document should display for a
   * property owned by `ownerAccountId`: the managing admin's user (Property
   * Kraft) post-reparent, or the landlord's own as a fallback. Loads the owner
   * (+ its managing admin) here so callers needn't add branding relations to
   * their own queries — robust for views whose entity is loaded by many paths.
   */
  async resolveBrandingUserForOwner(
    ownerAccountId: string,
  ): Promise<Users | null> {
    if (!ownerAccountId) return null;
    const owner = await this.accountRepository.findOne({
      where: { id: ownerAccountId },
      relations: ['user', 'creator', 'creator.user'],
    });
    return resolveBrandingUser(owner);
  }

  /**
   * The admin account that manages `landlordId` (its `accounts.creator_id`), or
   * null when unset (pre-reparent / not yet backfilled). Used to attribute a
   * landlord-scoped artifact (e.g. KYC feedback) up to its managing admin.
   */
  async resolveManagingAdminId(landlordId: string): Promise<string | null> {
    if (!landlordId) return null;
    const account = await this.accountRepository.findOne({
      where: { id: landlordId },
      select: { id: true, creator_id: true },
    });
    return account?.creator_id ?? null;
  }

  /**
   * The reverse of {@link resolveTeamOwnersForLandlord}: given the creators of
   * the team(s) a facility manager sits on, the landlord account ids whose
   * properties / common areas that FM may see and act on. A creator that is an
   * admin expands to the landlords they manage; a creator that is itself a
   * landlord (pre-reparent, self-owned team) maps to itself. De-duplicated.
   */
  async resolveLandlordsForTeamCreators(
    creatorIds: string[],
  ): Promise<string[]> {
    const unique = Array.from(new Set((creatorIds ?? []).filter(Boolean)));
    if (!unique.length) return [];
    const creators = await this.accountRepository.find({
      where: { id: In(unique) },
      select: { id: true, roles: true },
    });
    const out = new Set<string>();
    for (const creator of creators) {
      if (creator.roles?.includes(RolesEnum.ADMIN)) {
        const managed = await this.resolveManagedLandlordIds(creator.id);
        managed.forEach((id) => out.add(id));
      } else if (creator.roles?.includes(RolesEnum.LANDLORD)) {
        out.add(creator.id);
      }
    }
    return Array.from(out);
  }

  /**
   * The set of landlord account ids in scope for the requester's ACTIVE role:
   *  - admin            -> landlords they created
   *  - facility_manager -> landlords under the admin(s) whose team(s) they sit on
   *  - anything else    -> [] (no dashboard scope)
   */
  async resolveScopeLandlordIds(requester: ScopeRequester): Promise<string[]> {
    if (!requester?.id) return [];

    if (requester.role === RolesEnum.ADMIN) {
      return this.resolveManagedLandlordIds(requester.id);
    }

    if (requester.role === RolesEnum.FACILITY_MANAGER) {
      const adminIds = await this.resolveAdminIdsForFacilityManager(
        requester.id,
      );
      if (!adminIds.length) return [];
      const perAdmin = await Promise.all(
        adminIds.map((adminId) => this.resolveManagedLandlordIds(adminId)),
      );
      return Array.from(new Set(perAdmin.flat()));
    }

    return [];
  }

  /**
   * Boolean form of {@link assertManagesLandlord}: true when `landlordId` is one
   * of the landlords this admin manages. Use where the caller needs to branch
   * (e.g. "actor is the owner OR an admin who manages the owner") rather than
   * throw — as the maintenance-request actor resolution does.
   */
  async managesLandlord(
    adminAccountId: string,
    landlordId: string,
  ): Promise<boolean> {
    if (!adminAccountId || !landlordId) return false;
    const managed = await this.resolveManagedLandlordIds(adminAccountId);
    return managed.includes(landlordId);
  }

  /**
   * Throws ForbiddenException unless `landlordId` is one of the landlords the
   * admin manages. Use at the top of every write that acts on behalf of a
   * landlord (create property/tenant/invoice/offer-letter/kyc-link, etc.).
   */
  async assertManagesLandlord(
    adminAccountId: string,
    landlordId: string,
  ): Promise<void> {
    if (!(await this.managesLandlord(adminAccountId, landlordId))) {
      throw new ForbiddenException(
        'You do not manage the specified landlord.',
      );
    }
  }
}
