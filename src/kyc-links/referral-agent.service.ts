import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ReferralAgent } from './entities/referral-agent.entity';
import { KYCApplication } from './entities/kyc-application.entity';

/** One agent row for the admin Agents page. */
export interface AgentRollup {
  /** Normalised phone — the agent's identity. */
  id: string;
  phone: string;
  /** official_name ?? first-ever name. */
  primaryName: string;
  /** Every other name seen for this number, oldest first. */
  aliases: string[];
  /** Applications (in the caller's scope) crediting this number. */
  referralCount: number;
  lastReferralAt: string | null;
  /** True when an admin has overridden the name. */
  hasOfficialName: boolean;
}

/** A person linked to an agent, for the details modal. */
export interface AgentLinkedPerson {
  applicationId: string;
  fullName: string;
  property?: string;
  applicationDate?: string;
  status: 'Applicant' | 'Tenant';
}

/** Minimum digits before the public KYC autocomplete will return anything. */
const MIN_SUGGEST_DIGITS = 6;
const MAX_SUGGESTIONS = 5;

@Injectable()
export class ReferralAgentService {
  private readonly logger = new Logger(ReferralAgentService.name);

  constructor(
    @InjectRepository(ReferralAgent)
    private readonly referralAgentRepository: Repository<ReferralAgent>,
    @InjectRepository(KYCApplication)
    private readonly kycApplicationRepository: Repository<KYCApplication>,
  ) {}

  /**
   * Record an agent the first time their number is seen. WRITE-ONCE: `first_seen_name`
   * is never updated, so this is a plain insert-or-ignore and can be called from any
   * number of submission paths without risk of divergence. Never throws — a failure here
   * must not fail a KYC submission; the agent simply won't autocomplete until the
   * backfill/repair query re-seeds it.
   */
  async ensureAgent(phone?: string | null, name?: string | null): Promise<void> {
    const cleanPhone = (phone ?? '').trim();
    const cleanName = (name ?? '').trim();
    if (!cleanPhone || !cleanName) return;

    try {
      await this.referralAgentRepository
        .createQueryBuilder()
        .insert()
        .into(ReferralAgent)
        .values({ phone: cleanPhone, first_seen_name: cleanName })
        .orIgnore() // ON CONFLICT DO NOTHING — first name wins, forever.
        .execute();
    } catch (error) {
      this.logger.warn(
        `ensureAgent failed for ${cleanPhone}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Agents behind the applications this admin can see. Names/counts are DERIVED from
   * kyc_applications (sole truth); only the official-name override comes from the table.
   */
  async listForLandlords(managedLandlordIds: string[]): Promise<AgentRollup[]> {
    if (!managedLandlordIds?.length) return [];

    // `names` comes back in chronological order (duplicates included) so the first
    // distinct entry is the earliest name seen in this scope.
    const rows: Array<{
      phone: string;
      referral_count: string;
      last_referral_at: Date;
      names: string[];
    }> = await this.kycApplicationRepository
      .createQueryBuilder('application')
      .innerJoin('application.property', 'property')
      .select('btrim(application.referral_agent_phone_number)', 'phone')
      .addSelect('COUNT(*)', 'referral_count')
      .addSelect('MAX(application.created_at)', 'last_referral_at')
      .addSelect(
        `ARRAY_AGG(btrim(application.referral_agent_full_name) ORDER BY application.created_at ASC)`,
        'names',
      )
      .where('property.owner_id IN (:...managedLandlordIds)', {
        managedLandlordIds,
      })
      .andWhere('application.deleted_at IS NULL')
      .andWhere('application.referral_agent_phone_number IS NOT NULL')
      .andWhere("btrim(application.referral_agent_phone_number) <> ''")
      .groupBy('btrim(application.referral_agent_phone_number)')
      .getRawMany();

    if (!rows.length) return [];

    const overrides = await this.findByPhones(rows.map((r) => r.phone));

    return rows
      .map((row) => {
        // Dedupe case-insensitively while preserving chronological order.
        const seen = new Set<string>();
        const ordered: string[] = [];
        for (const raw of row.names ?? []) {
          const name = (raw ?? '').trim();
          if (!name) continue;
          const key = name.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          ordered.push(name);
        }

        const agent = overrides.get(row.phone);
        // Prefer the table's first_seen_name so this page and the KYC form agree even
        // when the agent's very first application belongs to another landlord.
        const primaryName =
          agent?.official_name?.trim() ||
          agent?.first_seen_name?.trim() ||
          ordered[0] ||
          '';

        return {
          id: row.phone,
          phone: row.phone,
          primaryName,
          aliases: ordered.filter(
            (n) => n.toLowerCase() !== primaryName.toLowerCase(),
          ),
          referralCount: Number(row.referral_count) || 0,
          lastReferralAt: row.last_referral_at
            ? new Date(row.last_referral_at).toISOString()
            : null,
          hasOfficialName: Boolean(agent?.official_name),
        };
      })
      .filter((a) => a.primaryName)
      .sort((a, b) => a.primaryName.localeCompare(b.primaryName));
  }

  /** Applicants/tenants linked to an agent, scoped to what this admin can see. */
  async getLinkedPeople(
    phone: string,
    managedLandlordIds: string[],
  ): Promise<AgentLinkedPerson[]> {
    if (!managedLandlordIds?.length) return [];

    const applications = await this.kycApplicationRepository
      .createQueryBuilder('application')
      .innerJoinAndSelect('application.property', 'property')
      .where('property.owner_id IN (:...managedLandlordIds)', {
        managedLandlordIds,
      })
      .andWhere('application.deleted_at IS NULL')
      .andWhere('btrim(application.referral_agent_phone_number) = :phone', {
        phone: phone.trim(),
      })
      .orderBy('application.created_at', 'DESC')
      .getMany();

    return applications
      .filter((app) => app.status !== 'rejected')
      .map((app) => ({
        applicationId: app.id,
        fullName: `${app.first_name ?? ''} ${app.last_name ?? ''}`.trim(),
        property: app.property?.name,
        applicationDate: app.created_at
          ? new Date(app.created_at).toISOString()
          : undefined,
        status:
          app.status === 'approved'
            ? ('Tenant' as const)
            : ('Applicant' as const),
      }));
  }

  /**
   * Set the admin-facing official name. Gated on the caller actually having an
   * application that references this number, so an admin can't rename arbitrary agents.
   */
  async setOfficialName(
    phone: string,
    officialName: string,
    accountId: string,
    managedLandlordIds: string[],
  ): Promise<ReferralAgent> {
    const cleanPhone = (phone ?? '').trim();
    const cleanName = (officialName ?? '').trim();
    if (!cleanName) {
      throw new ForbiddenException('Official name cannot be empty');
    }

    const inScope = await this.kycApplicationRepository
      .createQueryBuilder('application')
      .innerJoin('application.property', 'property')
      .where('property.owner_id IN (:...managedLandlordIds)', {
        managedLandlordIds: managedLandlordIds?.length
          ? managedLandlordIds
          : [null],
      })
      .andWhere('application.deleted_at IS NULL')
      .andWhere('btrim(application.referral_agent_phone_number) = :phone', {
        phone: cleanPhone,
      })
      .getCount();

    if (!inScope) {
      throw new ForbiddenException(
        'You do not manage any applicant referred by this agent',
      );
    }

    let agent = await this.referralAgentRepository.findOne({
      where: { phone: cleanPhone },
    });

    if (!agent) {
      // No row yet (agent predates the table and the backfill missed them) — create it,
      // seeding first_seen_name from the earliest name on record.
      await this.ensureAgent(cleanPhone, await this.earliestName(cleanPhone));
      agent = await this.referralAgentRepository.findOne({
        where: { phone: cleanPhone },
      });
      if (!agent) throw new NotFoundException('Agent not found');
    }

    agent.official_name = cleanName;
    agent.set_by = accountId;
    agent.set_at = new Date();
    return this.referralAgentRepository.save(agent);
  }

  /**
   * Public KYC-form autocomplete. Indexed lookup over `referral_agents` only — never
   * touches applications, so no applicant or landlord data can be exposed. Requires a
   * minimum number of digits so the roster can't be enumerated from a short prefix.
   */
  async suggestByPhone(
    partial: string,
  ): Promise<Array<{ phone: string; name: string }>> {
    const digits = (partial ?? '').replace(/\D/g, '');
    if (digits.length < MIN_SUGGEST_DIGITS) return [];

    const agents = await this.referralAgentRepository
      .createQueryBuilder('agent')
      .where('agent.deleted_at IS NULL')
      .andWhere('agent.phone LIKE :pattern', { pattern: `%${digits}%` })
      .orderBy('agent.phone', 'ASC')
      .limit(MAX_SUGGESTIONS)
      .getMany();

    return agents.map((agent) => ({
      phone: agent.phone,
      name: (agent.official_name || agent.first_seen_name || '').trim(),
    }));
  }

  private async findByPhones(
    phones: string[],
  ): Promise<Map<string, ReferralAgent>> {
    if (!phones.length) return new Map();
    const agents = await this.referralAgentRepository
      .createQueryBuilder('agent')
      .where('agent.phone IN (:...phones)', { phones })
      .getMany();
    return new Map(agents.map((a) => [a.phone, a]));
  }

  /** Earliest name ever recorded for a number, across all landlords. */
  private async earliestName(phone: string): Promise<string> {
    const row = await this.kycApplicationRepository
      .createQueryBuilder('application')
      .select('btrim(application.referral_agent_full_name)', 'name')
      .where('btrim(application.referral_agent_phone_number) = :phone', {
        phone,
      })
      .andWhere('application.deleted_at IS NULL')
      .andWhere("btrim(application.referral_agent_full_name) <> ''")
      .orderBy('application.created_at', 'ASC')
      .limit(1)
      .getRawOne();
    return row?.name ?? '';
  }
}
