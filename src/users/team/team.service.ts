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
import { DataSource, Repository } from 'typeorm';
import { RolesEnum } from 'src/base.entity';
import { Account } from '../entities/account.entity';
import { Team } from '../entities/team.entity';
import { TeamMember } from '../entities/team-member.entity';
import { Users } from '../entities/user.entity';
import { TeamMemberDto } from '../dto/team-member.dto';
import { UtilService } from 'src/utils/utility-service';
import { WhatsappBotService } from 'src/whatsapp-bot/whatsapp-bot.service';
import { AccountCacheService } from 'src/auth/account-cache.service';
import { isPlaceholderEmail } from 'src/utils/placeholder-email';

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
  ) {}

  /**
   * Validates that the requester has the LANDLORD role.
   * Throws ForbiddenException if not a landlord.
   * @param requester The account making the request
   */
  private validateLandlordRole(requester: Account): void {
    if (requester.role !== RolesEnum.LANDLORD) {
      throw new ForbiddenException('Only landlords can manage teams');
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
        // Ensure only LANDLORD can add to team
        const account = await manager
          .getRepository(Account)
          .findOne({ where: { id: userId } });

        if (!account || account.role !== RolesEnum.LANDLORD) {
          throw new HttpException(
            `${account ? account.role : 'Unknown role'} cannot add to team`,
            HttpStatus.FORBIDDEN,
          );
        }

        // 1. Get or create team
        let team = await manager.getRepository(Team).findOne({
          where: { creatorId: userId },
        });

        if (!team) {
          const teamAdminAccount = await manager
            .getRepository(Account)
            .findOne({
              where: { id: userId, role: RolesEnum.LANDLORD },
            });

          if (!teamAdminAccount) {
            throw new HttpException(
              'Team admin account not found',
              HttpStatus.NOT_FOUND,
            );
          }

          team = manager.getRepository(Team).create({
            name: `${teamAdminAccount.profile_name} Team`,
            creatorId: teamAdminAccount.id,
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

        // Decide whether to (re)generate a password.
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
        const hasLandlordRole = !!userAccount?.roles?.includes(
          RolesEnum.LANDLORD,
        );
        const alreadyHasFmRole = !!userAccount?.roles?.includes(
          RolesEnum.FACILITY_MANAGER,
        );

        let plainPasswordToSend: string | null = null;

        if (!userAccount) {
          // Brand new identity → generate password and send it.
          const { plain, hash } = await this.utilService.generatePassword();
          plainPasswordToSend = plain;
          userAccount = manager.getRepository(Account).create({
            user,
            email: teamMember.email,
            password: hash,
            roles: [teamMember.role],
            role: teamMember.role,
            profile_name: `${teamMember.first_name} ${teamMember.last_name}`,
            is_verified: true,
          });
          await manager.getRepository(Account).save(userAccount);
        } else if (!alreadyHasFmRole) {
          // Existing account being elevated into FM. Always append the role.
          // Only regenerate the password if the account doesn't already have
          // a usable sign-in surface (i.e. no LANDLORD role).
          if (!hasLandlordRole) {
            const { plain, hash } = await this.utilService.generatePassword();
            plainPasswordToSend = plain;
            userAccount.password = hash;
          }
          userAccount.roles = [
            ...(userAccount.roles ?? []),
            teamMember.role,
          ];
          userAccount.role = userAccount.roles[0];
          userAccount.is_verified = true;
          await manager.getRepository(Account).save(userAccount);
          await this.accountCacheService.invalidate(userAccount.id);
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
        // Only include the temporary password when we actually (re)issued one;
        // for an FM joining an additional team, their existing creds still work.
        await this.whatsappBotService.sendToFacilityManagerWithTemplate({
          phone_number: normalizedPhoneNumber,
          name: this.utilService.toSentenceCase(teamMember.first_name),
          team: team.name,
          role: 'Facility Manager',
          temporary_password: plainPasswordToSend ?? undefined,
        });

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
    // 1. Every team_member row for this user where role=FACILITY_MANAGER.
    //    Pull team.creator (Account) and team.creator.user (Users) so we can
    //    build the landlord summary directly from the row.
    const memberships = await this.teamMemberRepository
      .createQueryBuilder('tm')
      .innerJoinAndSelect('tm.team', 'team')
      .innerJoinAndSelect('team.creator', 'creator')
      .innerJoinAndSelect('creator.user', 'creatorUser')
      .innerJoin('tm.account', 'fmAccount')
      .innerJoin('fmAccount.user', 'fmUser')
      .where('fmUser.id = :userId', { userId: requesterUserId })
      .andWhere('tm.role = :role', { role: RolesEnum.FACILITY_MANAGER })
      .getMany();

    if (memberships.length === 0) {
      return [];
    }

    const tmIds = memberships.map((m) => m.id);

    // 2. Count open SRs assigned to any of those TeamMember ids, keyed by
    //    the FK so we can re-attach to the landlord.
    const rawCounts = await this.dataSource
      .createQueryBuilder()
      .select('sr.assigned_to', 'assigned_to')
      .addSelect('COUNT(*)::int', 'open_count')
      .from('maintenance_requests', 'sr')
      .where('sr.assigned_to IN (:...tmIds)', { tmIds })
      .andWhere('sr.deleted_at IS NULL')
      .andWhere("sr.status NOT IN ('resolved', 'closed')")
      .groupBy('sr.assigned_to')
      .getRawMany<{ assigned_to: string; open_count: number }>();

    const openCountByTm = new Map<string, number>();
    for (const row of rawCounts) {
      openCountByTm.set(row.assigned_to, Number(row.open_count) || 0);
    }

    // 3. Reduce memberships to one row per landlord, summing the open counts
    //    across all TeamMember rows belonging to that landlord (an FM rarely
    //    has more than one TM row per team, but be defensive).
    const byLandlord = new Map<
      string,
      { accountId: string; userId: string; displayName: string; openRequestCount: number }
    >();
    for (const m of memberships) {
      const account = m.team?.creator;
      const user = account?.user;
      if (!account || !user) continue;
      const displayName =
        account.profile_name?.trim() ||
        `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() ||
        'Landlord';
      const prev = byLandlord.get(account.id);
      const openForThisTm = openCountByTm.get(m.id) ?? 0;
      if (prev) {
        prev.openRequestCount += openForThisTm;
      } else {
        byLandlord.set(account.id, {
          accountId: account.id,
          userId: user.id,
          displayName,
          openRequestCount: openForThisTm,
        });
      }
    }

    return Array.from(byLandlord.values());
  }

  /**
   * Gets team members for the team owned by a landlord.
   * If the landlord does not have a team, it creates one automatically.
   * @param requester The authenticated account making the request
   * @returns Array of team member DTOs
   */
  async getTeamMembers(requester: Account): Promise<TeamMemberDto[]> {
    // 1. Ensure requester is a LANDLORD
    this.validateLandlordRole(requester);

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
    // 1. Ensure requester is a LANDLORD
    this.validateLandlordRole(requester);

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
    // 1. Ensure requester is a LANDLORD
    this.validateLandlordRole(requester);

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

    // 4. Delete the team member
    await this.teamMemberRepository.remove(teamMember);

    return { success: true, message: 'Team member deleted successfully' };
  }
}
