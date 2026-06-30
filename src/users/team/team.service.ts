import {
  ConflictException,
  ForbiddenException,
  forwardRef,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { RolesEnum } from 'src/base.entity';
import { Account } from '../entities/account.entity';
import { Team } from '../entities/team.entity';
import { TeamMember } from '../entities/team-member.entity';
import { Users } from '../entities/user.entity';
import { PasswordResetToken } from '../entities/password-reset-token.entity';
import { TeamMemberDto } from '../dto/team-member.dto';
import { UtilService } from 'src/utils/utility-service';
import { WhatsappBotService } from 'src/whatsapp-bot/whatsapp-bot.service';
import { AccountCacheService } from 'src/auth/account-cache.service';
import { isPlaceholderEmail } from 'src/utils/placeholder-email';
import { ManagementScopeService } from 'src/common/scope/management-scope.service';

/**
 * Input type for creating a new team member
 */
export interface TeamMemberInput {
  email: string;
  permissions: string[];
  role: RolesEnum;
  first_name: string;
  last_name: string;
  phone_number: string;
}

/**
 * Input type for updating a team member
 */
export interface UpdateTeamMemberInput {
  name: string;
  phone: string;
}

/**
 * TeamService handles all team and collaborator management operations.
 * Extracted from UsersService to follow Single Responsibility Principle.
 */
@Injectable()
export class TeamService {
  constructor(
    @InjectRepository(Team)
    private readonly teamRepository: Repository<Team>,
    @InjectRepository(TeamMember)
    private readonly teamMemberRepository: Repository<TeamMember>,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(Users)
    private readonly usersRepository: Repository<Users>,
    private readonly dataSource: DataSource,
    private readonly utilService: UtilService,
    @Inject(forwardRef(() => WhatsappBotService))
    private readonly whatsappBotService: WhatsappBotService,
    private readonly accountCacheService: AccountCacheService,
    private readonly managementScopeService: ManagementScopeService,
  ) {}

  /**
   * Validates that the requester may manage the property-manager team. After
   * the property-manager transition the single team belongs to the ADMIN
   * (Property Kraft) — `team.creatorId` is the admin's account id — so team
   * management is an admin capability. Landlords no longer own teams or reach
   * these endpoints (the login gate blocks them).
   * @param requester The account making the request
   */
  private validateTeamManagerRole(requester: Account): void {
    if (!requester.roles?.includes(RolesEnum.ADMIN)) {
      throw new ForbiddenException('Only administrators can manage teams');
    }
  }

  /**
   * Assigns a collaborator to a landlord's team.
   * Creates the team if it doesn't exist.
   * @param userId The landlord's account ID
   * @param teamMember The team member details to add
   * @returns The created TeamMember entity
   */
  async assignCollaboratorToTeam(
    userId: string,
    teamMember: TeamMemberInput,
  ): Promise<TeamMember> {
    return await this.dataSource.transaction(async (manager) => {
      try {
        // Only an ADMIN (property manager) may add to a team. After the
        // property-manager transition the single team belongs to the admin
        // (Property Kraft) — `team.creatorId` is the admin's account id — and
        // landlords no longer manage teams. Check roles[] (the sole role truth)
        // rather than the singular session role, which carries the active role.
        const account = await manager
          .getRepository(Account)
          .findOne({ where: { id: userId } });

        if (!account || !account.roles?.includes(RolesEnum.ADMIN)) {
          throw new HttpException(
            'Only administrators can add to team',
            HttpStatus.FORBIDDEN,
          );
        }

        // 1. Get or create team
        let team = await manager.getRepository(Team).findOne({
          where: { creatorId: userId },
        });

        if (!team) {
          team = manager.getRepository(Team).create({
            name: `${account.profile_name} Team`,
            creatorId: account.id,
          });

          await manager.getRepository(Team).save(team);
        }

        // 2. Ensure user really owns this team
        if (team.creatorId !== userId) {
          throw new HttpException(
            'Not authorized to add members to this team',
            HttpStatus.FORBIDDEN,
          );
        }

        // 3. (deferred) — duplicate-membership check moved below, after we
        //    resolve the canonical Account by email-or-phone. Checking by
        //    email at this stage misses dupes added via the legacy fake-email
        //    forms, where every add gets a unique synthetic email.

        // 4. Normalize phone number
        let normalizedPhoneNumber = teamMember.phone_number.replace(/\D/g, '');
        if (!normalizedPhoneNumber.startsWith('234')) {
          normalizedPhoneNumber =
            '234' + normalizedPhoneNumber.replace(/^0+/, '');
        }

        // 5. Get or create user - check by phone number first to avoid duplicates
        let user = await manager.getRepository(Users).findOne({
          where: { phone_number: normalizedPhoneNumber },
        });

        if (!user) {
          user = await manager.getRepository(Users).save({
            phone_number: normalizedPhoneNumber,
            first_name: teamMember.first_name,
            last_name: teamMember.last_name,
            role: teamMember.role,
            is_verified: true,
            email: teamMember.email,
          });
        }

        // 6. Find any account for this person — by email first, falling back
        //    to phone via the linked user. The phone fallback exists because
        //    two legacy FE forms (LandlordFacilityManagers, LandlordFacility)
        //    submit a synthesised `fm_<ts>@temp.facility` instead of a real
        //    email, so an email-only lookup would miss real overlaps with
        //    landlord/tenant accounts that share the same phone.
        let userAccount = await manager.getRepository(Account).findOne({
          where: { email: teamMember.email },
          relations: ['user'],
        });

        if (!userAccount) {
          userAccount = await manager.getRepository(Account).findOne({
            where: { user: { phone_number: normalizedPhoneNumber } },
            relations: ['user'],
          });
        }

        // Email reconciliation when we hit by phone:
        //   - existing placeholder + incoming real → upgrade existing email
        //   - existing real + incoming placeholder → keep existing
        //   - both real but different → conflict (real data inconsistency)
        let emailWasRewritten = false;
        if (userAccount && userAccount.email !== teamMember.email) {
          const existingIsPlaceholder = isPlaceholderEmail(userAccount.email);
          const incomingIsPlaceholder = isPlaceholderEmail(teamMember.email);
          if (existingIsPlaceholder && !incomingIsPlaceholder) {
            // self-heal: rewrite placeholder → real email
            userAccount.email = teamMember.email;
            emailWasRewritten = true;
          } else if (!existingIsPlaceholder && incomingIsPlaceholder) {
            // keep existing real email — nothing to do
          } else if (!existingIsPlaceholder && !incomingIsPlaceholder) {
            throw new ConflictException(
              `Phone ${normalizedPhoneNumber} is already linked to an account with a different email (${userAccount.email}).`,
            );
          }
          // both placeholder: leave existing email alone
        }

        // Decide whether to issue a password-set Flow.
        //
        // YES if:
        //   - we're creating a brand-new account, OR
        //   - the existing account has no usable login credentials (no LANDLORD
        //     role and no FM role yet — e.g. a tenant being elevated to FM).
        //
        // NO if:
        //   - the existing account is a landlord (their password is user-set;
        //     leave it alone — they sign in with the same creds for both
        //     roles), OR
        //   - already an FM in another team (existing creds still work).
        //
        // Note: we no longer auto-generate a password server-side. Meta rejects
        // templates that carry credentials in non-Authentication categories, so
        // the FM picks their own password via a WhatsApp Flow form. The
        // PasswordResetToken minted here is the flow_token we pass to Meta.
        const hasLandlordRole = !!userAccount?.roles?.includes(
          RolesEnum.LANDLORD,
        );
        const alreadyHasFmRole = !!userAccount?.roles?.includes(
          RolesEnum.FACILITY_MANAGER,
        );

        let flowTokenToSend: string | null = null;
        const FM_TOKEN_TTL_HOURS = 24 * 7; // 7 days — matches "expires in 7 days" wording in the facility_manager_set_password template body

        const mintFlowToken = async (accountId: string): Promise<string> => {
          const token = uuidv4();
          const expiresAt = new Date();
          expiresAt.setHours(expiresAt.getHours() + FM_TOKEN_TTL_HOURS);
          await manager.save(PasswordResetToken, {
            id: uuidv4(),
            user_id: accountId,
            token,
            expires_at: expiresAt,
          });
          return token;
        };

        if (!userAccount) {
          // Brand new identity → create account WITHOUT a password; FM sets
          // their own via the Flow. The account is unusable until they do.
          userAccount = manager.getRepository(Account).create({
            user,
            email: teamMember.email,
            roles: [teamMember.role],
            profile_name: `${teamMember.first_name} ${teamMember.last_name}`,
            is_verified: true,
          });
          await manager.getRepository(Account).save(userAccount);
          flowTokenToSend = await mintFlowToken(userAccount.id);
        } else if (!alreadyHasFmRole) {
          // Existing account being elevated into FM. Always append the role.
          // Issue a Flow only when the account has no other usable sign-in
          // surface (i.e. no LANDLORD role). For tenant→FM elevations we now
          // preserve the existing password so the tenant role keeps working
          // until the FM completes the Flow (which then rewrites the hash for
          // both roles).
          userAccount.roles = [
            ...(userAccount.roles ?? []),
            teamMember.role,
          ];
          userAccount.is_verified = true;
          await manager.getRepository(Account).save(userAccount);
          await this.accountCacheService.invalidate(userAccount.id);
          if (!hasLandlordRole) {
            flowTokenToSend = await mintFlowToken(userAccount.id);
          }
        } else if (emailWasRewritten) {
          // Already FM in another team but we self-healed their placeholder
          // email — persist the rewrite so future logins by email work.
          await manager.getRepository(Account).save(userAccount);
          await this.accountCacheService.invalidate(userAccount.id);
        }
        // else: already an FM (in another team), no email change — keep
        // their existing password and row.

        // 7. Now that we know the canonical account, check whether this person
        //    is already in this team (by accountId, not by email — emails can
        //    differ across legacy forms even for the same person).
        const existingMember = await manager.getRepository(TeamMember).findOne({
          where: { accountId: userAccount.id, teamId: team.id },
        });
        if (existingMember) {
          throw new ConflictException('Collaborator already in team');
        }

        // 8. Add collaborator to team
        const newTeamMember = manager.getRepository(TeamMember).create({
          email: teamMember.email,
          permissions: teamMember.permissions,
          teamId: team.id,
          accountId: userAccount.id,
          role: teamMember.role,
        });

        await manager.getRepository(TeamMember).save(newTeamMember);

        // 9. Send WhatsApp notification to the new team member.
        // The FM templates' `team` variable is the team owner's display name —
        // the admin (Property Kraft) post-transition — resolved from
        // accounts.profile_name with a first/last-name fallback, NOT
        // `team.name`, which already carries a " Team" suffix (see step 1) and
        // would render as "X Team team" in the body.
        const teamOwnerForNotice = await manager
          .getRepository(Account)
          .findOne({
            where: { id: team.creatorId },
            relations: ['user'],
          });
        const teamOwnerDisplayName =
          teamOwnerForNotice?.profile_name?.trim() ||
          `${teamOwnerForNotice?.user?.first_name ?? ''} ${teamOwnerForNotice?.user?.last_name ?? ''}`.trim() ||
          'Your property manager';

        // When a Flow token was minted (new account or tenant→FM elevation),
        // send the Flow-based password-setup template. Otherwise (landlord
        // being elevated, or FM joining an additional team), the no-password
        // template suffices — their existing creds still work.
        if (flowTokenToSend) {
          await this.whatsappBotService.sendToFacilityManagerSetPasswordFlow({
            phone_number: normalizedPhoneNumber,
            name: this.utilService.toSentenceCase(teamMember.first_name),
            team: teamOwnerDisplayName,
            role: 'Facility Manager',
            flow_token: flowTokenToSend,
          });
        } else {
          await this.whatsappBotService.sendToFacilityManagerWithTemplate({
            phone_number: normalizedPhoneNumber,
            name: this.utilService.toSentenceCase(teamMember.first_name),
            team: teamOwnerDisplayName,
            role: 'Facility Manager',
            temporary_password: undefined,
          });
        }

        return newTeamMember;
      } catch (error) {
        console.error('Error assigning collaborator to team:', error);
        if (error instanceof HttpException) throw error;
        throw new HttpException(
          error.message || 'Could not assign collaborator',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    });
  }

  /**
   * Landlords the requesting facility manager is teamed with. One row per
   * unique landlord, with the count of open maintenance requests currently
   * assigned to the requester on that landlord's properties / common areas.
   *
   * Returns an empty array if the requester is not an FM or sits on no teams.
   */
  async getMyLandlords(
    requesterUserId: string,
  ): Promise<
    {
      accountId: string;
      userId: string;
      displayName: string;
      openRequestCount: number;
    }[]
  > {
    // 1. Every team_member row for this user where role=FACILITY_MANAGER. We
    //    need the TeamMember ids (the `assigned_to` FK on maintenance_requests)
    //    and each team's creatorId — which, after the re-parent, is the ADMIN
    //    that manages the landlords, not a landlord directly.
    const memberships = await this.teamMemberRepository
      .createQueryBuilder('tm')
      .innerJoinAndSelect('tm.team', 'team')
      .innerJoin('tm.account', 'fmAccount')
      .innerJoin('fmAccount.user', 'fmUser')
      .where('fmUser.id = :userId', { userId: requesterUserId })
      .andWhere('tm.role = :role', { role: RolesEnum.FACILITY_MANAGER })
      .getMany();

    if (memberships.length === 0) {
      return [];
    }

    const fmTeamMemberIds = memberships.map((m) => m.id);
    const teamCreatorIds = memberships
      .map((m) => m.team?.creatorId)
      .filter((id): id is string => Boolean(id));

    // 2. Expand the team creators to the landlord set this FM serves: an admin
    //    creator → the landlords they manage; a legacy self-owned landlord team
    //    → the landlord itself. Both topologies coexist during the migration.
    const landlordIds =
      await this.managementScopeService.resolveLandlordsForTeamCreators(
        teamCreatorIds,
      );
    if (landlordIds.length === 0) {
      return [];
    }

    // 3. Load each landlord's account (+user) for the display name / userId the
    //    consumers expect.
    const landlordAccounts = await this.accountRepository.find({
      where: { id: In(landlordIds) },
      relations: ['user'],
    });

    // 4. Count open SRs assigned to this FM, grouped by the landlord that owns
    //    the request's property or common area. After the re-parent the FM has
    //    a single team_member row spanning many landlords, so we attribute by
    //    owner_id (both owner columns hold Account.ids), NOT by team_member id.
    const rawCounts = await this.dataSource
      .createQueryBuilder()
      .select('COALESCE(p.owner_id, ca.owner_id)', 'owner_id')
      .addSelect('COUNT(*)::int', 'open_count')
      .from('maintenance_requests', 'sr')
      .leftJoin('properties', 'p', 'p.id = sr.property_id')
      .leftJoin('common_areas', 'ca', 'ca.id = sr.common_area_id')
      .where('sr.assigned_to IN (:...tmIds)', { tmIds: fmTeamMemberIds })
      .andWhere('sr.deleted_at IS NULL')
      .andWhere("sr.status NOT IN ('resolved', 'closed')")
      .groupBy('COALESCE(p.owner_id, ca.owner_id)')
      .getRawMany<{ owner_id: string | null; open_count: number }>();

    const openCountByLandlord = new Map<string, number>();
    for (const row of rawCounts) {
      if (row.owner_id) {
        openCountByLandlord.set(row.owner_id, Number(row.open_count) || 0);
      }
    }

    // 5. One row per landlord, preserving the shape consumers expect.
    const result: {
      accountId: string;
      userId: string;
      displayName: string;
      openRequestCount: number;
    }[] = [];
    for (const account of landlordAccounts) {
      const user = account.user;
      if (!user) continue;
      const displayName =
        account.profile_name?.trim() ||
        `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() ||
        'Landlord';
      result.push({
        accountId: account.id,
        userId: user.id,
        displayName,
        openRequestCount: openCountByLandlord.get(account.id) ?? 0,
      });
    }

    return result;
  }

  /**
   * Gets team members for the team owned by a landlord.
   * If the landlord does not have a team, it creates one automatically.
   * @param requester The authenticated account making the request
   * @returns Array of team member DTOs
   */
  async getTeamMembers(requester: Account): Promise<TeamMemberDto[]> {
    // 1. Ensure requester may manage the team (admin)
    this.validateTeamManagerRole(requester);

    // 2. Get or create team with requester as creator
    let team = await this.teamRepository.findOne({
      where: { creatorId: requester.id },
    });

    // If no team exists, create one
    if (!team) {
      const teamName = requester.profile_name
        ? `${requester.profile_name} Team`
        : 'My Team';

      const newTeam = this.teamRepository.create({
        name: teamName,
        creatorId: requester.id,
      });
      team = await this.teamRepository.save(newTeam);

      // If a new team was created, return empty array as there are no members yet
      return [];
    }

    // 3. Fetch team members for existing team
    const members = await this.teamMemberRepository.find({
      where: { teamId: team.id },
      relations: ['account', 'account.user'],
    });

    // 4. Map the database entities to DTOs for response
    return members.map((member) => ({
      id: member.id,
      name:
        member.account?.profile_name ??
        `${member.account?.user.first_name} ${member.account?.user.last_name}`,
      email: member.email,
      phone_number: member.account?.user.phone_number ?? '——',
      role: member.role,
      date: member.created_at?.toString() || '',
    }));
  }

  /**
   * Updates a team member's details (name and phone).
   * @param id Team member ID
   * @param data Updated name and phone
   * @param requester The authenticated account making the request
   * @returns Success message
   */
  async updateTeamMember(
    id: string,
    data: UpdateTeamMemberInput,
    requester: Account,
  ): Promise<{ success: boolean; message: string }> {
    // 1. Ensure requester may manage the team (admin)
    this.validateTeamManagerRole(requester);

    // 2. Find the team member
    const teamMember = await this.teamMemberRepository.findOne({
      where: { id },
      relations: ['team', 'account', 'account.user'],
    });

    if (!teamMember) {
      throw new NotFoundException('Team member not found');
    }

    // 3. Ensure requester owns the team
    if (teamMember.team.creatorId !== requester.id) {
      throw new ForbiddenException('You cannot update this team member');
    }

    // 4. Update user details
    const [firstName, lastName] = data.name.split(' ');
    if (teamMember.account?.user) {
      teamMember.account.user.first_name = this.utilService.toSentenceCase(
        firstName || data.name,
      );
      teamMember.account.user.last_name = lastName
        ? this.utilService.toSentenceCase(lastName)
        : '';
      teamMember.account.user.phone_number =
        this.utilService.normalizePhoneNumber(data.phone);

      await this.usersRepository.save(teamMember.account.user);

      // Update account profile name
      teamMember.account.profile_name = data.name;
      await this.accountRepository.save(teamMember.account);

      // Invalidate account cache after update
      await this.accountCacheService.invalidate(teamMember.account.id);
    }

    return { success: true, message: 'Team member updated successfully' };
  }

  /**
   * Deletes a team member.
   * @param id Team member ID
   * @param requester The authenticated account making the request
   * @returns Success message
   */
  async deleteTeamMember(
    id: string,
    requester: Account,
  ): Promise<{ success: boolean; message: string }> {
    // 1. Ensure requester may manage the team (admin)
    this.validateTeamManagerRole(requester);

    // 2. Find the team member
    const teamMember = await this.teamMemberRepository.findOne({
      where: { id },
      relations: ['team'],
    });

    if (!teamMember) {
      throw new NotFoundException('Team member not found');
    }

    // 3. Ensure requester owns the team
    if (teamMember.team.creatorId !== requester.id) {
      throw new ForbiddenException('You cannot delete this team member');
    }

    // 4. Refuse if there are open SRs assigned to this FM. Closed/resolved
    //    requests get their assigned_to set to NULL via the FK (SET NULL),
    //    so history is preserved — but open work would be silently abandoned.
    const openCount = await this.dataSource
      .createQueryBuilder()
      .from('maintenance_requests', 'sr')
      .where('sr.assigned_to = :tmId', { tmId: id })
      .andWhere('sr.deleted_at IS NULL')
      .andWhere("sr.status NOT IN ('resolved', 'closed')")
      .getCount();

    if (openCount > 0) {
      throw new HttpException(
        `This facility manager has ${openCount} open maintenance request${
          openCount === 1 ? '' : 's'
        }. Reassign them before removing the team member.`,
        HttpStatus.CONFLICT,
      );
    }

    // 5. Delete the team member.
    //    Capture accountId before remove() — the in-memory entity keeps it, but
    //    being explicit guards against future relation-cascade changes.
    const removedAccountId = teamMember.accountId;
    await this.teamMemberRepository.remove(teamMember);

    // 6. Revoke the FACILITY_MANAGER role from the account IF this was their
    //    last FM membership. The same account can be an FM on several
    //    landlords' teams (see assignCollaboratorToTeam's "already an FM in
    //    another team" path), so we must NOT strip the role while another
    //    membership still grants it. Without this step the role lingers in
    //    accounts.roles[] forever, and the WhatsApp bot keeps showing the
    //    "you have multiple roles" picker to someone who was already removed.
    const remainingFmMemberships = await this.teamMemberRepository.count({
      where: {
        accountId: removedAccountId,
        role: RolesEnum.FACILITY_MANAGER,
      },
    });

    if (remainingFmMemberships === 0) {
      const account = await this.accountRepository.findOne({
        where: { id: removedAccountId },
      });
      if (account?.roles?.includes(RolesEnum.FACILITY_MANAGER)) {
        account.roles = account.roles.filter(
          (r) => r !== RolesEnum.FACILITY_MANAGER,
        );
        await this.accountRepository.save(account);
        // The bot's role detection reads a cached account — invalidate so the
        // picker stops appearing immediately, not after the cache TTL.
        await this.accountCacheService.invalidate(account.id);
      }
    }

    return { success: true, message: 'Team member deleted successfully' };
  }
}
