import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';

import { CacheService } from 'src/lib/cache';
import { TemplateSenderService } from '../template-sender';
import { TenantFlowService } from '../tenant-flow';
import { Users } from 'src/users/entities/user.entity';
import { Account, accountHasRole } from 'src/users/entities/account.entity';
import { RolesEnum } from 'src/base.entity';
import { UtilService } from 'src/utils/utility-service';
import { NotificationService } from 'src/notifications/notification.service';
import { NotificationType } from 'src/notifications/enums/notification-type';

import { LlmClientService } from './llm-client.service';
import { TenantReadContextService } from './tenant-read-context.service';
import {
  CONFIDENCE_THRESHOLDS,
  INTENT_META,
  PrimaryIntent,
  SubIntent,
} from './intent-taxonomy';
import { AiIntentLog, AiIntentAction } from './entities/ai-intent-log.entity';
import {
  TenantNotice,
  TenantNoticeStatus,
} from './entities/tenant-notice.entity';
import { PendingConfirmation } from './dto/pending-confirmation.dto';
import { RawLlmResult } from './dto/raw-llm-result.dto';

const PENDING_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class IntentRouterService {
  private readonly logger = new Logger(IntentRouterService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly llm: LlmClientService,
    private readonly ctx: TenantReadContextService,
    private readonly cache: CacheService,
    private readonly utilService: UtilService,
    private readonly templateSender: TemplateSenderService,
    private readonly notificationService: NotificationService,
    @InjectRepository(Users) private readonly usersRepo: Repository<Users>,
    @InjectRepository(Account)
    private readonly accountsRepo: Repository<Account>,
    @InjectRepository(TenantNotice)
    private readonly noticeRepo: Repository<TenantNotice>,
    @InjectRepository(AiIntentLog)
    private readonly logRepo: Repository<AiIntentLog>,
    @Inject(forwardRef(() => TenantFlowService))
    private readonly tenantFlow: TenantFlowService,
  ) {}

  /**
   * Entry point. Called from TenantFlowService.cachedResponse when no
   * expected state matched the inbound text.
   *
   * Returns true if the router handled the message (caller skips menu),
   * false if the caller should fall back to the menu as before.
   */
  async handleFreeText(from: string, text: string): Promise<boolean> {
    // Single gate. Off ⇒ caller falls back to today's menu, no cache reads,
    // no DB lookups, no LLM call.
    if (!this.isEnabled()) return false;

    const priorBotMessage =
      (await this.cache.get<string>(`last_bot_outbound_${from}`)) ?? null;
    const priorBotType =
      (await this.cache.get<string>(`last_bot_outbound_type_${from}`)) ?? null;

    const tenant = await this.resolveTenant(from);
    if (!tenant) return false;

    const llmOutcome = await this.llm.classify({
      text,
      priorBotMessage,
      priorBotType,
      tenant: {
        accountId: tenant.accountId,
        name: tenant.name,
        propertyCount: tenant.propertyCount,
      },
    });

    if (!llmOutcome.ok) {
      await this.persistLog({
        tenantId: tenant.accountId,
        phoneNumber: from,
        inboundText: text,
        priorBotMessage,
        priorBotType,
        result: null,
        action: 'error',
        errorMessage: `${llmOutcome.error.kind}: ${llmOutcome.error.message}`,
        latencyMs: llmOutcome.latencyMs,
      });
      return false; // caller shows menu
    }

    const result = llmOutcome.result;

    // <0.7 → menu fallback
    if (result.confidence < CONFIDENCE_THRESHOLDS.ROUTE) {
      await this.persistLog({
        tenantId: tenant.accountId,
        phoneNumber: from,
        inboundText: text,
        priorBotMessage,
        priorBotType,
        result,
        action: 'low_confidence',
        latencyMs: llmOutcome.latencyMs,
      });
      return false;
    }

    const meta = INTENT_META[result.sub_intent];

    // READ at ≥0.9 → execute inline
    if (
      !meta.isWrite &&
      result.confidence >= CONFIDENCE_THRESHOLDS.AUTO_EXECUTE_READ
    ) {
      await this.executeRead(from, tenant, result);
      await this.persistLog({
        tenantId: tenant.accountId,
        phoneNumber: from,
        inboundText: text,
        priorBotMessage,
        priorBotType,
        result,
        action: 'auto_executed',
        latencyMs: llmOutcome.latencyMs,
      });
      return true;
    }

    // Everything else → confirmation card
    const queued = await this.queueConfirmation(from, tenant, result);
    if (!queued) {
      // Couldn't resolve required context (e.g. no pending-confirmation MR
      // exists for `confirm_filed_request`). Fall back to menu.
      await this.persistLog({
        tenantId: tenant.accountId,
        phoneNumber: from,
        inboundText: text,
        priorBotMessage,
        priorBotType,
        result,
        action: 'menu_fallback',
        latencyMs: llmOutcome.latencyMs,
      });
      return false;
    }

    await this.persistLog({
      tenantId: tenant.accountId,
      phoneNumber: from,
      inboundText: text,
      priorBotMessage,
      priorBotType,
      result,
      action: 'confirmation_sent',
      latencyMs: llmOutcome.latencyMs,
    });
    return true;
  }

  /**
   * Called from TenantFlowService.handleInteractive when an ai_confirm:* /
   * ai_cancel:* button is tapped. Returns true if the router handled it.
   */
  async handleConfirmationButton(
    from: string,
    buttonId: string,
  ): Promise<boolean> {
    const [action, hash] = buttonId.split(':');
    if (!hash) return false;

    const cacheKey = `ai_pending_${hash}`;
    const pending = (await this.cache.get(cacheKey)) as PendingConfirmation | null;

    if (!pending) {
      await this.templateSender.sendText(
        from,
        'That request expired. Please send your message again.',
      );
      return true;
    }

    await this.cache.delete(cacheKey);

    if (action === 'ai_cancel') {
      // Silent cancel — no menu, no message.
      return true;
    }
    if (action !== 'ai_confirm') return false;

    const tenant = await this.resolveTenant(from);
    if (!tenant) {
      await this.templateSender.sendText(
        from,
        "I couldn't find your tenant account. Please contact your landlord.",
      );
      return true;
    }

    await this.executeConfirmedAction(from, tenant, pending);
    return true;
  }

  // -------------------------------------------------------------------
  // private
  // -------------------------------------------------------------------

  private isEnabled(): boolean {
    const flag = this.config.get<string>('INTENT_ROUTER_ENABLED');
    return flag === 'on';
  }

  private async resolveTenant(from: string): Promise<ResolvedTenant | null> {
    const normalized = this.utilService.normalizePhoneNumber(from);
    const user = await this.usersRepo.findOne({
      where: { phone_number: normalized },
      relations: ['accounts'],
    });
    if (!user) return null;
    const tenantAcc = user.accounts?.find((a) => accountHasRole(a, RolesEnum.TENANT));
    if (!tenantAcc) return null;

    // Resolve landlord by looking at the first active property_tenant
    const tenancies = await this.ctx.getTenancy(tenantAcc.id);
    const firstLandlord = tenancies[0]?.landlordAccountId ?? null;

    return {
      accountId: tenantAcc.id,
      userId: user.id,
      name: this.utilService.toSentenceCase(user.first_name || 'there'),
      propertyCount: tenancies.length,
      landlordAccountId: firstLandlord,
      firstPropertyId: tenancies[0]?.propertyId ?? null,
    };
  }

  // ----- read execution ----------------------------------------------

  private async executeRead(
    from: string,
    tenant: ResolvedTenant,
    result: RawLlmResult,
  ): Promise<void> {
    switch (result.sub_intent) {
      case SubIntent.META_ACKNOWLEDGEMENT:
        await this.templateSender.sendText(from, '👍');
        return;

      case SubIntent.META_GREETING:
      case SubIntent.META_SHOW_MENU:
      case SubIntent.META_END_SESSION:
        // Defer to TenantFlowService — it owns the menu. We can't call its
        // private method, but the public `handleText` pipeline already
        // routes 'menu'/'done' correctly. For greeting/show_menu we just
        // ask the bot to show the menu via a button card.
        await this.templateSender.sendButtons(
          from,
          `Hi ${tenant.name} — what would you like to do?`,
          [
            { id: 'maintenance_request', title: 'Maintenance request' },
            { id: 'view_tenancy', title: 'View tenancy details' },
            { id: 'payment', title: 'Payment' },
          ],
        );
        return;

      case SubIntent.META_SWITCH_ROLE:
        await this.cache.delete(`selected_role_${from}`);
        await this.templateSender.sendText(
          from,
          'Role cleared. Send any message to select a new role.',
        );
        return;

      case SubIntent.META_OFF_TOPIC:
        await this.templateSender.sendText(
          from,
          'I can help with rent, maintenance, and tenancy details. For anything else, please contact your landlord.',
        );
        return;

      case SubIntent.META_ABUSE:
      case SubIntent.META_UNCLEAR:
        // Silent: log only; don't escalate, don't expand the menu.
        return;

      case SubIntent.PAY_BALANCE_QUESTION: {
        if (!tenant.landlordAccountId) {
          await this.templateSender.sendText(
            from,
            "I couldn't find an active tenancy on your account.",
          );
          return;
        }
        const balance = await this.ctx.getBalance(
          tenant.accountId,
          tenant.landlordAccountId,
        );
        const formatMoney = (n: number) =>
          `₦${Math.abs(Number(n)).toLocaleString('en-NG', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`;
        await this.templateSender.sendText(
          from,
          balance > 0
            ? `Your outstanding balance is ${formatMoney(balance)}.`
            : balance < 0
              ? `You have a credit of ${formatMoney(-balance)}.`
              : 'You have no outstanding balance. ',
        );
        return;
      }

      case SubIntent.PAY_DUE_DATE_QUESTION:
      case SubIntent.TENANCY_LEASE_QUESTION:
      case SubIntent.PAY_QUESTION:
      case SubIntent.INFO_PROPERTY:
      case SubIntent.INFO_ACCOUNT_SUMMARY:
      case SubIntent.MR_CHECK_STATUS: {
        const tenancies = await this.ctx.getTenancy(tenant.accountId);
        if (!tenancies.length) {
          await this.templateSender.sendText(
            from,
            "I couldn't find an active tenancy on your account.",
          );
          return;
        }
        const lines: string[] = [];
        for (const t of tenancies) {
          lines.push(`*${t.propertyName}* (${t.propertyLocation})`);
          if (t.rentAmount != null)
            lines.push(`  • Rent: ₦${Number(t.rentAmount).toLocaleString()}`);
          if (t.endDate)
            lines.push(
              `  • Lease ends: ${new Date(t.endDate as string).toLocaleDateString()}`,
            );
        }
        if (result.sub_intent === SubIntent.MR_CHECK_STATUS) {
          const mrs = await this.ctx.getOpenMaintenanceRequests(
            tenant.accountId,
          );
          lines.push('');
          if (mrs.length === 0) {
            lines.push('No open maintenance requests.');
          } else {
            lines.push(`*Open requests:*`);
            for (const mr of mrs) {
              const shortDesc =
                mr.description.length > 60
                  ? mr.description.slice(0, 60) + '…'
                  : mr.description;
              lines.push(`  • ${shortDesc} — ${mr.status}`);
            }
          }
        }
        await this.templateSender.sendText(from, lines.join('\n'));
        return;
      }

      case SubIntent.INFO_LANDLORD_CONTACT: {
        if (!tenant.landlordAccountId) {
          await this.templateSender.sendText(
            from,
            "I couldn't find your landlord's details.",
          );
          return;
        }
        const c = await this.ctx.getLandlordContact(tenant.landlordAccountId);
        if (!c) {
          await this.templateSender.sendText(
            from,
            "I couldn't find your landlord's details.",
          );
          return;
        }
        await this.templateSender.sendText(
          from,
          c.phone
            ? `Your landlord is ${c.name}. Contact: ${c.phone}.`
            : `Your landlord is ${c.name}.`,
        );
        return;
      }

      case SubIntent.INFO_FM_CONTACT: {
        const c = await this.ctx.getFmContact(tenant.accountId);
        if (!c) {
          await this.templateSender.sendText(
            from,
            'No facility manager is assigned to your property yet.',
          );
          return;
        }
        await this.templateSender.sendText(
          from,
          c.phone
            ? `Your facility manager is ${c.name}. Contact: ${c.phone}.`
            : `Your facility manager is ${c.name}.`,
        );
        return;
      }

      case SubIntent.PAY_REQUEST_RECEIPT:
        await this.templateSender.sendText(
          from,
          'Your most recent receipts are sent automatically after each payment. If you need an older one, please contact your landlord.',
        );
        return;

      default:
        // READ that isn't covered — show a soft hint.
        await this.templateSender.sendText(
          from,
          result.suggested_reply ||
            'I can help with rent, maintenance, and tenancy details.',
        );
    }
  }

  // ----- confirmation queueing ---------------------------------------

  /**
   * Returns false if we couldn't queue the action (e.g. required context is
   * missing). Caller will fall back to the menu.
   */
  private async queueConfirmation(
    from: string,
    tenant: ResolvedTenant,
    result: RawLlmResult,
  ): Promise<boolean> {
    const meta = INTENT_META[result.sub_intent];
    const resolved: PendingConfirmation['resolved'] = {};

    // For "confirm_filed_request" / "deny_filed_request" we need the MR id.
    if (
      result.sub_intent === SubIntent.MR_CONFIRM_FILED_REQUEST ||
      result.sub_intent === SubIntent.MR_DENY_FILED_REQUEST
    ) {
      const mr = await this.ctx.getPendingTenantConfirmationMR(tenant.accountId);
      if (!mr) {
        await this.templateSender.sendText(
          from,
          "I couldn't find a request waiting for your confirmation.",
        );
        return false;
      }
      resolved.maintenanceRequestId = mr.id;
    }

    const hash = this.shortHash();
    const pending: PendingConfirmation = {
      intent: result.intent,
      subIntent: result.sub_intent,
      extracted: result.extracted,
      resolved,
      createdAt: Date.now(),
    };
    await this.cache.set(`ai_pending_${hash}`, pending, PENDING_TTL_MS);

    const body = this.buildConfirmationBody(meta.displayVerb, result, resolved);
    await this.templateSender.sendButtons(from, body, [
      { id: `ai_confirm:${hash}`, title: 'Confirm' },
      { id: `ai_cancel:${hash}`, title: 'Cancel' },
    ]);
    return true;
  }

  private buildConfirmationBody(
    displayVerb: string,
    result: RawLlmResult,
    _resolved: PendingConfirmation['resolved'],
  ): string {
    const e = result.extracted;
    const quoted =
      e.description ||
      e.message_to_human ||
      e.reason ||
      e.target_request_hint ||
      e.question ||
      '';
    if (quoted) {
      const short = quoted.length > 200 ? quoted.slice(0, 200) + '…' : quoted;
      return `Sounds like you want to ${displayVerb}:\n\n"${short}"\n\nTap *Confirm* to proceed.`;
    }
    return `Sounds like you want to ${displayVerb}. Tap *Confirm* to proceed.`;
  }

  // ----- confirmed action execution ----------------------------------

  private async executeConfirmedAction(
    from: string,
    tenant: ResolvedTenant,
    pending: PendingConfirmation,
  ): Promise<void> {
    // MESSAGE_TO_HUMAN paths and a couple of "no existing button" intents
    // all route into tenant_notices + Notification.
    const noticeSubIntents = new Set<SubIntent>([
      SubIntent.HUMAN_TO_LANDLORD,
      SubIntent.HUMAN_TO_FM,
      SubIntent.HUMAN_COMPLAINT,
      SubIntent.HUMAN_REQUEST,
      SubIntent.MR_POSTPONE_CONFIRMATION,
      SubIntent.MR_ADD_DETAIL,
      SubIntent.TENANCY_MOVE_OUT,
      SubIntent.PAY_REQUEST_PLAN,
    ]);

    if (noticeSubIntents.has(pending.subIntent)) {
      await this.createNoticeForLandlord(from, tenant, pending);
      return;
    }

    // For sub-intents that map to an existing button flow, hand off to the
    // tenant flow service's dedicated AI executor.
    try {
      await this.tenantFlow.executeAiIntent(from, pending);
    } catch (err) {
      this.logger.error(
        `executeAiIntent failed for ${pending.subIntent}: ${(err as Error).message}`,
      );
      await this.templateSender.sendText(
        from,
        'Something went wrong. Please try again or tap an option below.',
      );
    }
  }

  private async createNoticeForLandlord(
    from: string,
    tenant: ResolvedTenant,
    pending: PendingConfirmation,
  ): Promise<void> {
    if (!tenant.landlordAccountId) {
      await this.templateSender.sendText(
        from,
        "I couldn't find your landlord on file.",
      );
      return;
    }

    const originalMessage =
      pending.extracted.message_to_human ||
      pending.extracted.description ||
      pending.extracted.reason ||
      pending.extracted.question ||
      '(no message)';

    const notice = this.noticeRepo.create({
      tenant_id: tenant.accountId,
      landlord_id: tenant.landlordAccountId,
      fm_id: null,
      property_id: tenant.firstPropertyId,
      original_message: originalMessage,
      ai_extraction: {
        sub_intent: pending.subIntent,
        extracted: pending.extracted,
      } as Record<string, unknown>,
      sub_intent: pending.subIntent,
      status: TenantNoticeStatus.NEW,
    });
    await this.noticeRepo.save(notice);

    // Side-effect: write a Notification row so LandlordLiveFeed.tsx picks
    // it up automatically (no frontend changes needed).
    try {
      await this.notificationService.create({
        type: NotificationType.TENANT_BOT_MESSAGE,
        description: `${tenant.name}: ${originalMessage.slice(0, 180)}`,
        date: new Date().toISOString(),
        status: 'Pending',
        user_id: tenant.landlordAccountId,
        property_id: tenant.firstPropertyId ?? undefined,
      } as never);
    } catch (err) {
      this.logger.warn(
        `Failed to write livefeed Notification (notice still saved): ${(err as Error).message}`,
      );
    }

    await this.templateSender.sendText(
      from,
      "I've passed this to your landlord.",
    );
  }

  // ----- logging -----------------------------------------------------

  private async persistLog(params: {
    tenantId: string | null;
    phoneNumber: string;
    inboundText: string;
    priorBotMessage: string | null;
    priorBotType: string | null;
    result: RawLlmResult | null;
    action: AiIntentAction;
    errorMessage?: string;
    latencyMs?: number;
  }): Promise<void> {
    try {
      const row = this.logRepo.create({
        tenant_id: params.tenantId,
        phone_number: this.utilService.normalizePhoneNumber(params.phoneNumber),
        inbound_text: params.inboundText,
        prior_bot_message: params.priorBotMessage,
        prior_bot_message_type: params.priorBotType,
        raw_llm_response: params.result
          ? (params.result as unknown as Record<string, unknown>)
          : null,
        parsed_intent: params.result?.intent ?? null,
        parsed_sub_intent: params.result?.sub_intent ?? null,
        confidence: params.result?.confidence ?? null,
        action_taken: params.action,
        error_message: params.errorMessage ?? null,
        latency_ms: params.latencyMs ?? null,
      });
      await this.logRepo.save(row);
    } catch (err) {
      this.logger.warn(
        `Failed to persist ai_intent_log row (continuing): ${(err as Error).message}`,
      );
    }
  }

  private shortHash(): string {
    // 8-char base32-ish slug; collisions over 10-min TTL are astronomically
    // unlikely.
    return randomBytes(6).toString('base64url').slice(0, 8);
  }
}

interface ResolvedTenant {
  accountId: string;
  userId: string;
  name: string;
  propertyCount: number;
  landlordAccountId: string | null;
  firstPropertyId: string | null;
}
