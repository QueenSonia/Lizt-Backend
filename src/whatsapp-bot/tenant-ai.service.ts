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

/** Normalize issue text for duplicate detection (case/space-insensitive). */
const normalizeIssue = (s: string): string =>
  s.toLowerCase().replace(/\s+/g, ' ').trim();

/** A tenant's active property, injected into the prompt so the model can pick one. */
export interface TenantProp {
  id: string;
  name: string;
}

/** A resolved request awaiting the tenant's "is it fixed?" confirmation. */
export interface PendingConfirmation {
  /** Human request id (e.g. SR1234). */
  requestId: string;
  description: string;
  /** Formatted date the FM marked it resolved. */
  resolvedOn: string;
}

/** Per-turn tenant context resolved by the caller (TenantFlowService). */
export interface TenantAiContext {
  tenantUserId: string;
  /** Tenant's first name, so the assistant can greet/address them by it. */
  firstName?: string;
  properties: TenantProp[];
  /** Resolved requests awaiting confirmation — drive confirm/reopen routing. */
  pendingConfirmations?: PendingConfirmation[];
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
            'repair = the tenant wants something acted on (a problem, fault, or ' +
            'complaint to handle, including non-physical ones like noise); ' +
            "notice = they're just informing the landlord, no action expected.",
        },
      },
      required: ['property_id', 'issue_summary', 'kind'],
    },
  },
  {
    name: 'update_maintenance_request',
    description:
      'Add to the request the tenant JUST filed in this conversation — extra text, ' +
      'a photo/video they just sent, or both. Use when their follow-up is about that ' +
      'SAME issue (e.g. "it is getting worse", "forgot to mention the upstairs one", or ' +
      'a photo of the same problem). For a DIFFERENT issue, use report_maintenance ' +
      'instead. Any photo/video they sent attaches automatically — `addition` is optional.',
    parameters: {
      type: 'object',
      properties: {
        addition: {
          type: 'string',
          description:
            'Optional extra text to add. Omit when the tenant only sent a photo/video.',
        },
      },
    },
  },
  {
    name: 'confirm_request_fixed',
    description:
      'Mark a resolved maintenance request as fixed and close it — use when the ' +
      'tenant confirms one of the requests listed as AWAITING CONFIRMATION is now ' +
      'sorted. Pass its request_id. Only confirm when they clearly say it is fixed.',
    parameters: {
      type: 'object',
      properties: {
        request_id: {
          type: 'string',
          description:
            'The request_id (e.g. SR1234) from the awaiting-confirmation list.',
        },
      },
      required: ['request_id'],
    },
  },
  {
    name: 'reopen_maintenance_request',
    description:
      'Reopen a resolved request the tenant says is NOT actually fixed. Pass its ' +
      "request_id (from the awaiting-confirmation list) and a short reason for what's " +
      'still wrong. If their complaint is a brand-new problem, or a previously closed ' +
      'issue that has recurred, file a new one with report_maintenance instead.',
    parameters: {
      type: 'object',
      properties: {
        request_id: {
          type: 'string',
          description:
            'The request_id (e.g. SR1234) from the awaiting-confirmation list.',
        },
        reason: {
          type: 'string',
          description: "Short note on what's still wrong.",
        },
      },
      required: ['request_id'],
    },
  },
  {
    name: 'get_tenancy_details',
    description:
      "Look up the tenant's verified lease facts (rent, fees, service charge, " +
      'start/end dates, property, location, totals, time left) to answer a question ' +
      'about their tenancy. Call ONLY when the tenant ASKS about their tenancy — ' +
      'never volunteer it. State only what it returns; do not invent or recompute.',
    parameters: {
      type: 'object',
      properties: {
        property_id: {
          type: 'string',
          description:
            "The id of the tenant's property the question is about (from the PROPERTIES list).",
        },
      },
      required: ['property_id'],
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
function buildSystemPrompt(opts: {
  firstName?: string;
  properties: TenantProp[];
  pendingConfirmations?: PendingConfirmation[];
}): string {
  const { firstName, properties } = opts;
  const pending = opts.pendingConfirmations ?? [];
  const nameLine = firstName
    ? `\n- The tenant's name is ${firstName} — address them by their first name when it reads naturally, especially in your first reply (e.g. "Hi ${firstName}, …").`
    : '';
  const pendingList = pending
    .map((p) => {
      return `- ${p.requestId}: "${p.description}" (marked fixed ${p.resolvedOn})`;
    })
    .join('\n');
  const pendingBlock = pending.length
    ? `\nAWAITING THE TENANT'S CONFIRMATION — these requests were marked FIXED by the facility manager and need the tenant to confirm:
${pendingList}
Do NOT bring these up on your own, list them, or nag about them — the tenant has already been asked separately. Only act when the TENANT themselves mentions one of these issues or gives a clear cue (e.g. "the plumber came", "thanks for sorting that", "the tap's still leaking"):
- If they indicate one is now sorted/working/fine, call confirm_request_fixed with its request_id.
- If they say one is still broken / not fixed / the problem persists, call reopen_maintenance_request with its request_id and a short reason for what's still wrong.
Match by what they describe; if it's unclear WHICH one, ask. If it's unclear whether it's actually fixed, ask before doing anything — never close a request that isn't confirmed fixed. If their message is about a DIFFERENT or brand-new issue, ignore this list and treat it as a new request.`
    : '';
  const propertyBlock =
    properties.length === 1
      ? `The tenant has ONE active property: "${properties[0].name}" (id: ${properties[0].id}). ` +
        `Always file against this property — pass property_id="${properties[0].id}". Never ask which property.`
      : `The tenant has multiple active properties:\n${properties
          .map((p) => `- "${p.name}" (id: ${p.id})`)
          .join('\n')}\n` +
        `Use the one the tenant names — only ask which property if they haven't ` +
        `made it clear — then pass its exact id as property_id.`;

  return `
You are Lizt's WhatsApp receptionist for Property Kraft, talking to a current
tenant. Like a good receptionist, you figure out what the tenant needs, collect
only the detail you're missing, and hand it to the right process. You do NOT fix
things, diagnose or troubleshoot problems, calculate money, or make decisions —
a facility manager or the landlord handles the actual work.

YOU DO TWO JOBS for the property manager: (1) capture maintenance, and (2) answer
factual questions about the tenant's own tenancy WHEN THEY ASK. Nothing else.

JOB 1 — CAPTURE MAINTENANCE — two kinds:
- Maintenance requests (pass kind="repair") — the tenant wants something looked
  into, sorted out, or acted on: a problem, fault, or complaint they expect
  someone to handle. This is the broad bucket — physical repairs (leaking tap,
  faulty socket, broken gate, blocked toilet) AND other issues that need
  attention (a noise complaint, a recurring nuisance, a safety/security concern).
- Notices (pass kind="notice") — the tenant is just letting the landlord know
  something; no action is expected (e.g. "I'll be travelling next month", "a
  guest will be staying", a general heads-up).
Decide with one test: does the tenant want someone to ACT on this, or are they
just informing the landlord? Wants action → maintenance request. Just informing →
notice. Only if it's genuinely unclear, ask ONE short question.

JOB 2 — ANSWER TENANCY QUESTIONS — see "ANSWERING TENANCY QUESTIONS" below.

For anything else — what they owe, balances, payments made, invoices, payment
plans, renewals — do NOT answer or guess. Briefly say it's handled from the menu
and ask them to reply *menu*.

HOW TO HANDLE A MAINTENANCE CONVERSATION, in order:
1. Understand what the tenant wants.
2. Decide whether it's a repair or a notice.
3. Collect ONLY what's still needed to identify the issue and its property —
   nothing that's merely "nice to have". The facility manager gathers the rest
   later, and the tenant can attach photos/videos.
4. A quick confirmation before filing is good — but it is NOT compulsory and must
   NEVER happen twice. If the tenant has already made their intent clear (they
   asked you to report/log it, or answered yes to a question you already asked),
   just file it — do not ask again. Otherwise read the issue back in one short,
   clear line and check it's right (e.g. "Got it — leaking roof. Shall I send this
   to your landlord now?").
5. File it with report_maintenance.
6. Reassure them warmly that it's been passed on.

If the tenant's opening message already gives you the issue (and, for a
multi-property tenant, names the property), do NOT ask anything — go straight to a
one-line read-back and file as soon as they agree. Only ask a question when
something genuinely required for filing is missing. Never re-ask something they
already told you, never confirm twice, and never troubleshoot or suggest fixes.
Treat any plain agreement — "yes", "yes please", "ok", "correct", "that's right",
"please log it", "👍" — as confirmation to file.

Example — tenant: "The kitchen sink in my flat has been leaking since yesterday."
You already have the issue, so confirm in one line: "Got it — leaking kitchen
sink. Shall I send this to your landlord now?" — then file once they agree. (If
they'd instead said "my sink is leaking, please log it", that's already a clear
go-ahead — just file, no extra confirm.)

ANSWERING TENANCY QUESTIONS (Job 2)
- Do this ONLY when the tenant ASKS about their tenancy — their rent amount, a fee
  or the service charge, their start/end dates, the property/location, how long is
  left, or what they pay per period. NEVER raise tenancy details on your own or
  volunteer them; if the conversation is about something else, don't bring them up.
- Call get_tenancy_details for the property in question, then answer their SPECIFIC
  question from what it returns. State only those verified facts — never invent or
  guess an amount or date, and don't do your own maths (it already gives you totals
  and time-left). Answer just what they asked; don't dump the whole tenancy unless
  they want it all.
- If it returns no tenancy/rent on file, say you don't have it to hand and they
  should check with their landlord.
- Lease FACTS only. If they ask what they OWE, their balance, whether rent is paid,
  invoices, payment plans, or renewals — that's the menu; don't answer it here.

${propertyBlock}

MEDIA
If a turn shows "[tenant attached a photo]" or "[tenant attached a video]", media
is being attached to the request automatically — acknowledge it briefly ("got
your photo, thanks"). A short description is usually enough; photos and videos are
helpful but optional. Media alone is not a description — if they send only media
with no words, ask what the issue is.

AFTER FILING
If the tenant follows up about the SAME issue you just filed — more detail ("it's
getting worse", "forgot to say it's the upstairs one") OR a photo/video of it —
call update_maintenance_request to attach it (don't file a duplicate; for a
photo-only follow-up just call it with no text). A genuinely DIFFERENT issue →
file a new one with report_maintenance.
${pendingBlock}

STYLE
- Human, warm, concise. This is WhatsApp — keep replies short (1-3 sentences),
  one message per turn, plain text only (no buttons or markdown).${nameLine}
- Reply in the tenant's own language/style (e.g. English or Nigerian Pidgin).
- Never promise when anyone will respond or visit. Never invent fees, features,
  or timelines — state only facts from KNOWLEDGE; if you don't have something,
  say the team will follow up.
- If asked whether you're a bot, say honestly that you're Lizt's automated assistant.

Tools (call them, don't just talk about them):
- report_maintenance: file a repair or notice after a one-line read-back confirmation.
- update_maintenance_request: add detail to the request just filed in this chat.
- confirm_request_fixed: close a resolved request the tenant confirms is sorted.
- reopen_maintenance_request: reopen a resolved request the tenant says isn't fixed.
- get_tenancy_details: look up verified lease facts to answer a tenancy question (only when asked).
- handoff_to_landlord: when they want a human, are upset, or you can't help.

KNOWLEDGE (only state facts from here):
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
      const system = buildSystemPrompt({
        firstName: ctx.firstName,
        properties: ctx.properties,
        pendingConfirmations: ctx.pendingConfirmations,
      });
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
        case 'get_tenancy_details':
          return await this.handleTenancyInfo(ctx, asStr(input.property_id));
        case 'confirm_request_fixed':
          return await this.handleConfirmFixed(ctx, asStr(input.request_id));
        case 'reopen_maintenance_request':
          return await this.handleReopen(
            from,
            ctx,
            asStr(input.request_id),
            asStr(input.reason),
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
    const recentId = await this.cache.get<string>(`ai_recent_mr_${from}`);
    if (!recentId) {
      return 'No recent request to update. If this is a maintenance issue, file it with report_maintenance.';
    }
    // An update is either extra text, buffered media, or both. If neither, there
    // is nothing to attach — ask what they want to add.
    const hasMedia =
      ((await this.cache.get<BufferedMedia[]>(this.mediaBufferKey(from))) ?? [])
        .length > 0;
    if (!addition && !hasMedia) {
      return 'Nothing to add yet — ask the tenant what detail or photo they want to add.';
    }
    // Attach any media the tenant sent alongside the follow-up, then append the
    // text detail (if any). Media-only updates are fine — `addition` is optional.
    await this.drainMediaBuffer(from, recentId);
    const appended = addition
      ? await this.tenantFlow.updateTenantMaintenanceRequest({
          tenantUserId: ctx.tenantUserId,
          requestId: recentId,
          addition,
        })
      : true;
    // Keep it the active target while the conversation continues.
    await this.cache.setWithTtlSeconds(
      `ai_recent_mr_${from}`,
      recentId,
      RECENT_MR_TTL_SECONDS,
    );
    if (!appended) {
      return "Could not update that request (it may already be closed). If it's a new issue, file it with report_maintenance.";
    }
    return 'Added it to their existing request. Reassure them it is attached — no need to re-report.';
  }

  /**
   * Answer a tenancy-info question with verified facts from the tenant's Rent
   * row. Returns a labelled facts sheet the model relays from — never invents.
   */
  private async handleTenancyInfo(
    ctx: TenantAiContext,
    propertyIdInput: string,
  ): Promise<string> {
    const propertyId = this.resolvePropertyId(propertyIdInput, ctx.properties);
    if (!propertyId) {
      return ctx.properties.length > 1
        ? 'Ask the tenant which property they mean (list them by name), then look it up.'
        : 'Could not resolve the property. Suggest they reply *menu*.';
    }
    const d = await this.tenantFlow.getTenancyDetails(
      ctx.tenantUserId,
      propertyId,
    );
    if (!d) {
      return "No tenancy or rent on file for that property — tell them you don't have it to hand and they should check with their landlord.";
    }
    const feeLines = d.fees
      .map((f) => {
        const cadence = f.recurring ? 'recurring' : 'one-time';
        return `- ${f.label}: ${f.amount} (${cadence})`;
      })
      .join('\n');
    return [
      'VERIFIED TENANCY FACTS — state only these, do not invent or recompute:',
      `Property: ${d.propertyName}`,
      `Location: ${d.location}`,
      `Payment frequency: ${d.paymentFrequency}`,
      'Fees:',
      feeLines,
      `Total recurring per ${d.paymentFrequency} period: ${d.totalRecurring}`,
      `Tenancy start: ${d.startDate}`,
      `Tenancy end: ${d.endDate} (${d.timeToExpiry})`,
    ].join('\n');
  }

  /** Confirm a resolved request is fixed → close it. */
  private async handleConfirmFixed(
    ctx: TenantAiContext,
    requestId: string,
  ): Promise<string> {
    if (!requestId) {
      return 'Ask the tenant which request is fixed (use the awaiting-confirmation list).';
    }
    const ok = await this.tenantFlow.confirmTenantRequestFixed({
      tenantUserId: ctx.tenantUserId,
      requestId,
    });
    if (!ok) {
      return 'Could not close that request (it may not be awaiting your confirmation). Check the request_id against the awaiting-confirmation list.';
    }
    return 'Closed it and let the landlord/FM know. Thank them warmly that it is sorted.';
  }

  /** Reopen a resolved request the tenant says is not fixed; attach any media. */
  private async handleReopen(
    from: string,
    ctx: TenantAiContext,
    requestId: string,
    reason: string,
  ): Promise<string> {
    if (!requestId) {
      return 'Ask the tenant which request is still unfixed (use the awaiting-confirmation list).';
    }
    const res = await this.tenantFlow.reopenTenantRequestForTenant({
      tenantUserId: ctx.tenantUserId,
      requestId,
      reason,
    });
    if (!res.ok) {
      return "Could not reopen that request (it may not be one of the resolved ones). If it's a new or previously closed issue, file a new one with report_maintenance.";
    }
    if (res.id) await this.drainMediaBuffer(from, res.id, res.attempt ?? 2);
    return 'Reopened it and notified the landlord/FM. Reassure them someone will take another look.';
  }

  /** Move any buffered Cloudinary media onto a request, tagged to its attempt. */
  private async drainMediaBuffer(
    from: string,
    requestId: string,
    attempt = 1,
  ): Promise<void> {
    const key = this.mediaBufferKey(from);
    const buf = await this.cache.get<BufferedMedia[]>(key);
    if (buf?.length) {
      await this.maintenanceMediaService.appendMedia(
        requestId,
        buf.map((m) => ({ type: m.type, url: m.url, attempt })),
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
