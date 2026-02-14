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
   * Converts a role enum value to a human-readable display name.
   */
  private getRoleDisplayName(role: RolesEnum): string {
    const roleMap: Record<string, string> = {
      [RolesEnum.FACILITY_MANAGER]: 'Facility Manager',
      [RolesEnum.PROSPECT_AGENT]: 'Prospect Agent',
      [RolesEnum.LANDLORD]: 'Landlord',
      [RolesEnum.ADMIN]: 'Admin',
    };
    return roleMap[role] || role;
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
        // Ensure only LANDLORD or ADMIN can add to team
        const account = await manager
          .getRepository(Account)
          .findOne({ where: { id: userId } });

        if (
          !account ||
          (account.role !== RolesEnum.LANDLORD &&
            account.role !== RolesEnum.ADMIN)
        ) {
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

        // 3. Ensure collaborator is not already a member
        const existingMember = await manager.getRepository(TeamMember).findOne({
          where: { email: teamMember.email, teamId: team.id },
        });

        if (existingMember) {
          throw new ConflictException('Collaborator already in team');
        }

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

        // 6. Check if user already has an account with the specified role
        let userAccount = await manager.getRepository(Account).findOne({
          where: {
            user: { id: user.id },
            role: teamMember.role,
          },
        });

        let plainPassword: string | undefined;

        if (!userAccount) {
          const generatedPassword = await this.utilService.generatePassword();
          plainPassword = generatedPassword.plain;
          userAccount = manager.getRepository(Account).create({
            user,
            email: teamMember.email,
            password: generatedPassword.hashed,
            role: teamMember.role,
            profile_name: `${teamMember.first_name} ${teamMember.last_name}`,
            is_verified: true,
          });

          await manager.getRepository(Account).save(userAccount);
        } else {
          // Account exists — reset password so the agent can sign in
          const generatedPassword = await this.utilService.generatePassword();
          plainPassword = generatedPassword.plain;
          userAccount.password = generatedPassword.hashed;
          await manager.getRepository(Account).save(userAccount);
        }

        // 7. Add collaborator to team
        const newTeamMember = manager.getRepository(TeamMember).create({
          email: teamMember.email,
          permissions: teamMember.permissions,
          teamId: team.id,
          accountId: userAccount.id,
          role: teamMember.role,
        });

        await manager.getRepository(TeamMember).save(newTeamMember);

        // 8. Send WhatsApp notification to the new team member
        const roleDisplayName = this.getRoleDisplayName(teamMember.role);
        await this.whatsappBotService.sendToFacilityManagerWithTemplate({
          phone_number: normalizedPhoneNumber,
          name: this.utilService.toSentenceCase(teamMember.first_name),
          team: team.name,
          role: roleDisplayName,
          password: plainPassword,
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
