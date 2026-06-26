import {
  Inject,
  Injectable,
  Logger,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { LlmService } from '../ai/llm.service';
import { UNKNOWNS_KNOWLEDGE } from '../ai/knowledge/unknowns';
import { OTP_GUARDRAIL, redactSensitiveContent } from '../ai/guardrails';
import { AiMessage, AiTool, AiToolUse } from '../ai/ai.types';
import { CacheService } from 'src/lib/cache';
import { UtilService } from 'src/utils/utility-service';
import { Property } from 'src/properties/entities/property.entity';
import { MaintenanceRequestKindEnum } from 'src/maintenance-requests/dto/create-maintenance-request.dto';
import { ChatLogService } from './chat-log.service';
import { MessageDirection } from './entities/message-direction.enum';
import { TemplateSenderService } from './template-sender';
import { MaintenanceMediaService } from './maintenance-media.service';
import { TenantFlowService } from './tenant-flow';
import { NotificationService } from 'src/notifications/notification.service';
import { NotificationType } from 'src/notifications/enums/notification-type';

/** Coerce an unknown tool-input value to a trimmed string. */
const asStr = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Bound the tool-call back-and-forth within a single inbound turn. */
const MAX_TOOL_ITERATIONS = 5;
/** How many prior chat-log rows to feed the model as context. */
const HISTORY_LIMIT = 20;
/** Cloudinary-backed media a tenant sent mid-chat, awaiting a request to attach to. */
const MEDIA_BUFFER_TTL_SECONDS = 900;
/** How long a just-filed request stays the target of update_maintenance_request. */
const RECENT_MR_TTL_SECONDS = 15 * 60;
/** Window in which an identical issue summary is treated as an accidental re-file. */
const DUP_TEXT_TTL_SECONDS = 120;
/** Trailing window (reuses the post-Flow path) for media sent just after filing. */
const TRAILING_MEDIA_TTL_SECONDS = 600;

/** Normalize issue text for duplicate detection (case/space-insensitive). */
const normalizeIssue = (s: string): string =>
  s.toLowerCase().replace(/\s+/g, ' ').trim();

/** A tenant's active property, injected into the prompt so the model can pick one. */
export interface TenantProp {
  id: string;
  name: string;
}

/** Per-turn tenant context resolved by the caller (TenantFlowService). */
export interface TenantAiContext {
  tenantUserId: string;
  properties: TenantProp[];
}

/** Buffered media item (already uploaded to Cloudinary) keyed per phone. */
interface BufferedMedia {
  type: 'image' | 'video';
  url: string;
}

const TOOLS: AiTool[] = [
  {
    name: 'report_maintenance',
    description:
      "File the tenant's maintenance item once you have a clear one-line issue " +
      'summary, the property it concerns, and whether it is a repair or a notice. ' +
      'Only call this after a quick read-back confirmation from the tenant.',
    parameters: {
      type: 'object',
      properties: {
        property_id: {
          type: 'string',
          description:
            "The id of one of the tenant's active properties (from the PROPERTIES list).",
        },
        issue_summary: {
          type: 'string',
          description:
            'One clear line describing the issue or notice, in the tenant\'s own words.',
        },
        kind: {
          type: 'string',
          enum: ['repair', 'notice'],
          description:
            "repair = something needs fixing; notice = informational message for the landlord.",
        },
      },
      required: ['property_id', 'issue_summary', 'kind'],
    },
  },
  {
    name: 'update_maintenance_request',
    description:
      'Append extra detail to the request the tenant JUST filed in this conversation. ' +
      'Use when their new message elaborates on that SAME issue (e.g. "it is getting ' +
      'worse", "forgot to mention it is the upstairs bathroom"). For a DIFFERENT issue, ' +
      'use report_maintenance to file a new one instead.',
    parameters: {
      type: 'object',
      properties: {
        addition: {
          type: 'string',
          description: 'The extra detail to add to the request they just filed.',
        },
      },
      required: ['addition'],
    },
  },
  {
    name: 'handoff_to_landlord',
    description:
      'Flag this conversation for the landlord to follow up — call when the tenant ' +
      'asks to speak to a human, is upset, or you genuinely cannot help.',
    parameters: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'One short line for the landlord: who this is and why you handed off.',
        },
      },
      required: ['summary'],
    },
  },
];

/**
 * Build the per-turn system prompt. The tenant's active properties are injected
 * fresh each inbound message (the handler is stateless), so the list is always
 * current.
 */
function buildSystemPrompt(properties: TenantProp[]): string {
  const propertyBlock =
    properties.length === 1
      ? `The tenant has ONE active property: "${properties[0].name}" (id: ${properties[0].id}). ` +
        `Always file against this property — pass property_id="${properties[0].id}". Never ask which property.`
      : `The tenant has multiple active properties:\n${properties
          .map((p) => `- "${p.name}" (id: ${p.id})`)
          .join('\n')}\n` +
        `Before filing, find out which one this is about, then pass its exact id as property_id.`;

  return `
You are Lizt's WhatsApp receptionist for Property Kraft, talking to a current
tenant. Think of yourself as an intelligent receptionist for the property
manager: you figure out what the tenant needs, collect the missing detail, and
hand it to the right process. You do NOT fix things, calculate money, or make
decisions — a facility manager or the landlord handles the actual work.

WHAT YOU HANDLE (this is your ONLY job right now):
- Maintenance issues — something in their home/compound needs fixing (a repair).
- Notices — something they want the landlord to KNOW but that isn't a repair
  (e.g. "I'll be travelling next month", "a guest will be staying", an
  observation or complaint that doesn't need a repair job).

ANYTHING ELSE IS OUT OF SCOPE. If they ask about rent, payments, balances,
what they owe, invoices, payment plans, renewals, tenancy details, or anything
that isn't a maintenance issue or a notice, do NOT try to answer or guess —
briefly tell them those are handled from the menu and ask them to reply *menu*
to see the options.

CAPTURING A MAINTENANCE ITEM:
- Get a clear one-line summary of the issue in their words. Be calm,
  professional, warm, and concise — lightly empathetic, no long paragraphs.
- Don't interrogate them. A facility manager will still contact them to resolve
  it, and they can attach photos/videos — so a short description plus any media
  is enough. Ask at most one or two short questions.
- repair vs notice: if it's clearly something to fix, treat it as a repair. If
  it's clearly just informing the landlord, treat it as a notice. If it's
  genuinely ambiguous, ask ONE short question to decide. Pass kind accordingly.
- Photos/videos: if a turn contains a line like "[tenant attached a photo]" or
  "[tenant attached a video]", they have sent media that will be attached to the
  request automatically — acknowledge it briefly ("got your photo, thanks"). A
  photo ALONE is not a description: if they send only media with no words, ask
  what the issue is before filing.
- Before filing, give a one-line read-back and get a quick yes — e.g. "Got it —
  leaking kitchen tap. I'll send this to your landlord now, ok?" — then call
  report_maintenance.
- AFTER you've already filed something in this conversation: if the tenant adds
  more about that SAME issue (e.g. "it's getting worse", "forgot to say it's the
  upstairs one"), call update_maintenance_request to attach the extra detail to
  it — do NOT file a duplicate. If they raise a genuinely DIFFERENT issue, file a
  new one with report_maintenance.
- After filing, reassure them warmly: someone will look into it.

${propertyBlock}

Style:
- Human, warm, concise. This is WhatsApp — keep replies short (1-3 short sentences).
- Reply in the same language/style the tenant uses (e.g. English or Nigerian Pidgin).
- One message per turn. Plain text only — no buttons, no markdown headings.
- If asked whether you're a bot, say honestly that you're Lizt's automated assistant.

Tools (call them, don't just talk about them):
- report_maintenance: file a repair or notice after a quick read-back confirmation.
- handoff_to_landlord: when they want a human, are upset, or you can't help.

KNOWLEDGE (only state facts from here; never invent fees, timelines, or promises):
${UNKNOWNS_KNOWLEDGE}

${OTP_GUARDRAIL}
`.trim();
}

/**
 * AI receptionist for current tenants on WhatsApp. Engages on "stray" input
 * (free text or media sent when no active conversation state is set) and, in
 * this first cut, captures maintenance issues + notices, then files them via a
 * tool. Off-scope intents are steered back to the existing button menu.
 *
 * Mirrors ApplicantAiService (stateless, history-driven, tool-calling) with two
 * differences: there is no turn cap (tenants are authenticated, real users), and
 * mid-chat media is buffered to Cloudinary and drained into the request at file
 * time. Entry points return true if the turn was handled; false tells the caller
 * to fall back to the legacy button offer.
 */
@Injectable()
export class TenantAiService {
  private readonly logger = new Logger(TenantAiService.name);

  constructor(
    private readonly llm: LlmService,
    private readonly cache: CacheService,
    private readonly utilService: UtilService,
    private readonly chatLogService: ChatLogService,
    private readonly templateSender: TemplateSenderService,
    private readonly maintenanceMediaService: MaintenanceMediaService,
    @Inject(forwardRef(() => TenantFlowService))
    private readonly tenantFlow: TenantFlowService,
    @InjectRepository(Property)
    private readonly propertyRepo: Repository<Property>,
    private readonly notificationService: NotificationService,
  ) {}

  /** Gate check shared by both entry points. */
  isEnabled(): boolean {
    return this.llm.isEnabled();
  }

  /**
   * Handle a stray free-text tenant message.
   * @returns true if handled; false to fall back to the legacy button offer.
   */
  async tryHandleText(
    from: string,
    text: string,
    ctx: TenantAiContext,
  ): Promise<boolean> {
    const userText = (text || '').trim();
    if (!userText) return false;
    return this.run(from, userText, ctx);
  }

  /**
   * Handle inbound media. The caller has already uploaded the media to
   * Cloudinary and pushed it into the per-phone buffer; `breadcrumb` is the
   * synthetic "[tenant attached a photo]" turn the model sees.
   */
  async tryHandleMedia(
    from: string,
    breadcrumb: string,
    ctx: TenantAiContext,
  ): Promise<boolean> {
    return this.run(from, breadcrumb, ctx);
  }

  /** Buffer a Cloudinary-hosted media item for this phone (drained at file time). */
  async bufferMedia(from: string, item: BufferedMedia): Promise<void> {
    const key = this.mediaBufferKey(from);
    const buf = (await this.cache.get<BufferedMedia[]>(key)) ?? [];
    buf.push(item);
    await this.cache.setWithTtlSeconds(key, buf, MEDIA_BUFFER_TTL_SECONDS);
  }

  private mediaBufferKey(from: string): string {
    return `ai_media_buffer_${from}`;
  }

  /** Shared inbound-turn pipeline. Returns false on disabled/throw → caller falls back. */
  private async run(
    from: string,
    userTurn: string,
    ctx: TenantAiContext,
  ): Promise<boolean> {
    if (!this.llm.isEnabled()) return false;
    try {
      const system = buildSystemPrompt(ctx.properties);
      const messages = await this.buildHistory(from, userTurn);
      const body = await this.runConversationWithRetry(from, ctx, {
        system,
        messages,
      });
      await this.templateSender.sendText(
        from,
        body ||
          "Thanks for your message. If this is a maintenance issue, tell me what's going on and I'll log it for you.",
      );
      return true;
    } catch (err) {
      this.logger.error(
        `AI tenant flow failed for ${from}; falling back: ${(err as Error).message}`,
      );
      return false;
    }
  }

  /** Build the LLM message array from recent chat history + the current turn. */
  private async buildHistory(
    from: string,
    userText: string,
  ): Promise<AiMessage[]> {
    const rows = await this.chatLogService.getRecentMessages(
      from,
      HISTORY_LIMIT,
    );

    const messages: AiMessage[] = [];
    for (const row of rows) {
      const content = redactSensitiveContent(
        (row.content || '').trim(),
        (row.metadata as { template?: { name?: string } } | null)?.template
          ?.name,
      );
      if (!content || content.startsWith('flow:')) continue;
      const role =
        row.direction === MessageDirection.INBOUND ? 'user' : 'assistant';
      messages.push({ role, content });
    }

    while (messages.length && messages[0].role === 'assistant') {
      messages.shift();
    }

    const last = messages[messages.length - 1];
    if (!(last && last.role === 'user' && last.content === userText)) {
      messages.push({ role: 'user', content: userText });
    }
    if (messages.length === 0) {
      messages.push({ role: 'user', content: userText });
    }
    return messages;
  }

  private async runConversationWithRetry(
    from: string,
    ctx: TenantAiContext,
    args: { system: string; messages: AiMessage[] },
  ): Promise<string> {
    try {
      return await this.runConversation(from, ctx, args);
    } catch (err) {
      this.logger.warn(
        `AI tenant turn failed for ${from}, retrying once: ${(err as Error).message}`,
      );
      return await this.runConversation(from, ctx, args);
    }
  }

  private async runConversation(
    from: string,
    ctx: TenantAiContext,
    args: { system: string; messages: AiMessage[] },
  ): Promise<string> {
    const { text } = await this.llm.runConversation({
      system: args.system,
      history: args.messages,
      tools: TOOLS,
      maxIterations: MAX_TOOL_ITERATIONS,
      onToolUse: (call) => this.executeTool(from, ctx, call),
    });
    return text.trim();
  }

  /** Execute one tool call; returns a short result string fed back to the model. */
  private async executeTool(
    from: string,
    ctx: TenantAiContext,
    call: AiToolUse,
  ): Promise<string> {
    const input = call.input || {};
    try {
      switch (call.name) {
        case 'report_maintenance':
          return await this.handleReportMaintenance(from, ctx, input);
        case 'update_maintenance_request':
          return await this.handleUpdateMaintenance(
            from,
            ctx,
            asStr(input.addition),
          );
        case 'handoff_to_landlord':
          return await this.handleHandoff(from, ctx, asStr(input.summary));
        default:
          return `Unknown tool: ${call.name}`;
      }
    } catch (err) {
      this.logger.error(
        `Tool ${call.name} failed for ${from}: ${(err as Error).message}`,
      );
      return `Error running ${call.name}. Continue gracefully.`;
    }
  }

  /** Resolve, validate, file, and attach media for a maintenance report. */
  private async handleReportMaintenance(
    from: string,
    ctx: TenantAiContext,
    input: Record<string, unknown>,
  ): Promise<string> {
    const propertyId = this.resolvePropertyId(
      asStr(input.property_id),
      ctx.properties,
    );
    if (!propertyId) {
      return ctx.properties.length > 1
        ? 'That property did not match. Ask the tenant which of their properties this is about (list them by name), then file with its id.'
        : 'Could not resolve the property. Apologise briefly and suggest they reply *menu*.';
    }

    const text = asStr(input.issue_summary);
    if (!text) {
      return 'Need a short description of the issue before filing. Ask the tenant what is going on.';
    }

    // Duplicate guard: block only an identical issue re-filed within a short
    // window (the model double-firing / not realising the first succeeded). A
    // genuinely different second issue is NOT blocked — that's a real new MR,
    // and elaboration on the same issue should go through update_maintenance_request.
    const normalized = normalizeIssue(text);
    const lastTextKey = `ai_mr_last_text_${from}`;
    if ((await this.cache.get<string>(lastTextKey)) === normalized) {
      return 'That exact issue was just logged — do not file it again. If the tenant added new detail to it, use update_maintenance_request; otherwise reassure them it is already with their landlord.';
    }

    const kind =
      asStr(input.kind) === 'notice'
        ? MaintenanceRequestKindEnum.NOTICE
        : MaintenanceRequestKindEnum.REPAIR;

    const created = await this.tenantFlow.createTenantMaintenanceRequest({
      tenantUserId: ctx.tenantUserId,
      propertyId,
      text,
      kind,
    });
    if (!created) {
      return 'Filing failed. Apologise briefly and suggest they reply *menu* to try again.';
    }

    // Remember the request id so a follow-up elaboration can update it, and the
    // issue text so an accidental identical re-file is caught.
    await this.cache.setWithTtlSeconds(
      `ai_recent_mr_${from}`,
      created.id,
      RECENT_MR_TTL_SECONDS,
    );
    await this.cache.setWithTtlSeconds(
      lastTextKey,
      normalized,
      DUP_TEXT_TTL_SECONDS,
    );
    await this.drainMediaBuffer(from, created.id);

    // Catch any photo/video the tenant sends right after confirming, via the
    // existing post-Flow attachment window (handleInboundMedia checks this).
    await this.cache.setWithTtlSeconds(
      `awaiting_media_${from}`,
      { request_id: created.id, attempt: 1 },
      TRAILING_MEDIA_TTL_SECONDS,
    );

    return kind === MaintenanceRequestKindEnum.NOTICE
      ? 'Notice logged for the landlord. Confirm warmly that you have passed it on.'
      : 'Maintenance request logged and the landlord/facility manager notified. Reassure them someone will look into it.';
  }

  /**
   * Append a tenant's follow-up detail to the request they just filed, instead
   * of creating a duplicate. Targets the most-recent request from this
   * conversation (tracked in `ai_recent_mr_${from}`).
   */
  private async handleUpdateMaintenance(
    from: string,
    ctx: TenantAiContext,
    addition: string,
  ): Promise<string> {
    if (!addition) {
      return 'Nothing to add — ask the tenant what detail they want to add.';
    }
    const recentId = await this.cache.get<string>(`ai_recent_mr_${from}`);
    if (!recentId) {
      return 'No recent request to update. If this is a maintenance issue, file it with report_maintenance.';
    }
    const ok = await this.tenantFlow.updateTenantMaintenanceRequest({
      tenantUserId: ctx.tenantUserId,
      requestId: recentId,
      addition,
    });
    if (!ok) {
      return "Could not update that request (it may already be closed). If it's a new issue, file it with report_maintenance.";
    }
    // Attach any media buffered during the follow-up and re-arm the trailing
    // window, so photos sent alongside an update land on the same request.
    await this.drainMediaBuffer(from, recentId);
    await this.cache.setWithTtlSeconds(
      `awaiting_media_${from}`,
      { request_id: recentId, attempt: 1 },
      TRAILING_MEDIA_TTL_SECONDS,
    );
    // Keep it the active target while the conversation continues.
    await this.cache.setWithTtlSeconds(
      `ai_recent_mr_${from}`,
      recentId,
      RECENT_MR_TTL_SECONDS,
    );
    return 'Added the extra detail to their existing request. Reassure them it is attached — no need to re-report.';
  }

  /** Move any buffered Cloudinary media onto the freshly-created request. */
  private async drainMediaBuffer(from: string, requestId: string): Promise<void> {
    const key = this.mediaBufferKey(from);
    const buf = await this.cache.get<BufferedMedia[]>(key);
    if (buf?.length) {
      await this.maintenanceMediaService.appendMedia(
        requestId,
        buf.map((m) => ({ type: m.type, url: m.url, attempt: 1 })),
      );
    }
    await this.cache.delete(key);
  }

  /**
   * Resolve the property the model named. Single-property tenants auto-resolve
   * (the model can't get it wrong). Otherwise the id must be one the tenant
   * actually rents — never trust a hallucinated id.
   */
  private resolvePropertyId(
    candidate: string,
    properties: TenantProp[],
  ): string | null {
    if (properties.length === 1) return properties[0].id;
    const match = properties.find((p) => p.id === candidate);
    return match ? match.id : null;
  }

  /** Flag the tenant for the landlord to follow up, on the landlord's live feed. */
  private async handleHandoff(
    from: string,
    ctx: TenantAiContext,
    summary: string,
  ): Promise<string> {
    try {
      // Use the first property to locate the owning landlord (all of a tenant's
      // active properties under one landlord is the overwhelming common case).
      const propertyId = ctx.properties[0]?.id;
      if (!propertyId) return 'Flagged. Let them know someone will reach out.';
      const property = await this.propertyRepo.findOne({
        where: { id: propertyId },
      });
      if (!property?.owner_id) {
        return 'Flagged. Let them know someone will reach out.';
      }

      const tenantName = property.name?.trim();
      const description =
        `A tenant${tenantName ? ` at ${tenantName}` : ''} asked to speak with ` +
        `someone on WhatsApp` +
        (summary ? `: ${summary}` : '.');

      await this.notificationService.create({
        date: new Date().toISOString(),
        type: NotificationType.TENANT_HANDOFF,
        description,
        status: 'Pending',
        property_id: propertyId,
        user_id: property.owner_id,
      });
    } catch (err) {
      this.logger.error(
        `Failed to log tenant handoff to landlord feed: ${(err as Error).message}`,
      );
    }
    return 'Flagged for the landlord. Tell the tenant someone will reach out.';
  }
}
