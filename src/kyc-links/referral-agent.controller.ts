import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RoleGuard } from '../auth/role.guard';
import { Roles } from '../auth/role.decorator';
import { RolesEnum } from 'src/base.entity';
import { SkipAuth } from '../auth/auth.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { Account } from '../users/entities/account.entity';
import { ManagedLandlordIds } from 'src/common/scope/managed-landlord-ids.decorator';
import {
  AgentLinkedPerson,
  AgentRollup,
  ReferralAgentService,
} from './referral-agent.service';
import { KYCLinksService } from './kyc-links.service';
import { SetOfficialAgentNameDto } from './dto/set-official-agent-name.dto';

@Controller('api')
export class ReferralAgentController {
  constructor(
    private readonly referralAgentService: ReferralAgentService,
    private readonly kycLinksService: KYCLinksService,
  ) {}

  /**
   * Agents behind this admin's tenant applicants.
   * GET /api/referral-agents
   */
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RolesEnum.ADMIN)
  @Get('referral-agents')
  async list(
    @ManagedLandlordIds() landlordIds: string[],
  ): Promise<{ success: boolean; agents: AgentRollup[] }> {
    const agents = await this.referralAgentService.listForLandlords(landlordIds);
    return { success: true, agents };
  }

  /**
   * Applicants/tenants linked to one agent (details modal).
   * GET /api/referral-agents/:phone/people
   */
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RolesEnum.ADMIN)
  @Get('referral-agents/:phone/people')
  async people(
    @Param('phone') phone: string,
    @ManagedLandlordIds() landlordIds: string[],
  ): Promise<{ success: boolean; people: AgentLinkedPerson[] }> {
    const people = await this.referralAgentService.getLinkedPeople(
      phone,
      landlordIds,
    );
    return { success: true, people };
  }

  /**
   * Set an agent's official name.
   * PATCH /api/referral-agents/:phone
   */
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles(RolesEnum.ADMIN)
  @Patch('referral-agents/:phone')
  async setOfficialName(
    @Param('phone') phone: string,
    @Body() dto: SetOfficialAgentNameDto,
    @CurrentUser() user: Account,
    @ManagedLandlordIds() landlordIds: string[],
  ): Promise<{ success: boolean; message: string }> {
    await this.referralAgentService.setOfficialName(
      phone,
      dto.official_name,
      user.id,
      landlordIds,
    );
    return { success: true, message: 'Agent name updated' };
  }

  /**
   * Agent autocomplete for the tenant-facing KYC form.
   * GET /api/kyc/:token/agent-suggestions?phone=
   *
   * Gated on a valid KYC link token, requires a minimum number of digits, and returns
   * ONLY { phone, name } — never applicant, application or landlord data.
   */
  @SkipAuth()
  @Get('kyc/:token/agent-suggestions')
  async suggest(
    @Param('token') token: string,
    @Query('phone') phone: string,
  ): Promise<{
    success: boolean;
    agents: Array<{ phone: string; name: string }>;
  }> {
    // kyc_links.token is a uuid column — a malformed token would make Postgres raise
    // 22P02 rather than simply failing validation, so reject non-UUIDs up front. This
    // endpoint is public, so garbage tokens are expected traffic and must stay quiet.
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        token ?? '',
      );
    if (!isUuid) return { success: true, agents: [] };

    try {
      const validation = await this.kycLinksService.validateKYCToken(token);
      if (!validation?.valid) {
        return { success: true, agents: [] };
      }
      const agents = await this.referralAgentService.suggestByPhone(phone);
      return { success: true, agents };
    } catch {
      // Autocomplete is a convenience — never surface an error to the KYC form.
      return { success: true, agents: [] };
    }
  }
}
