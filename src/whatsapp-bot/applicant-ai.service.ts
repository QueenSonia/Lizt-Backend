import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { LlmService } from '../ai/llm.service';
import { UNKNOWNS_KNOWLEDGE } from '../ai/knowledge/unknowns';
import { OTP_GUARDRAIL, redactSensitiveContent } from '../ai/guardrails';
import { AiMessage, AiTool, AiToolUse } from '../ai/ai.types';
import { CacheService } from 'src/lib/cache';
import { UtilService } from 'src/utils/utility-service';
import { Waitlist } from 'src/users/entities/waitlist.entity';
import {
  ApplicationStatus,
  KYCApplication,
} from 'src/kyc-links/entities/kyc-application.entity';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { Property } from 'src/properties/entities/property.entity';
import { TenantStatusEnum } from 'src/properties/dto/create-property.dto';
import { ChatLogService } from './chat-log.service';
import { MessageDirection } from './entities/message-direction.enum';
import { TemplateSenderService } from './template-sender';
import { NotificationService } from 'src/notifications/notification.service';
import { NotificationType } from 'src/notifications/enums/notification-type';

/** Coerce an unknown tool-input value to a trimmed string (never "[object Object]"). */
const asStr = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Human contact line surfaced to applicants (mirrors the unknowns flow). */
const SUPPORT_PHONE = '0803 632 2847';

/**
 * Per-phone turn caps over a rolling 24h window. Shares the SAME `ai_turns_{phone}`
 * key as UnknownsAiService — it's the same person and the same 24h AI budget,
 * even if they move unknown -> applicant.
 *  - < SOFT: normal conversation.
 *  - SOFT..HARD-1: "wind-down" — AI keeps replying but is told to wrap up.
 *  - >= HARD: stop calling the LLM. Hand off + notify once, then stay silent.
 */
const SOFT_TURN_CAP = 20;
const HARD_TURN_CAP = 30;
const TURN_CAP_WINDOW_SECONDS = 24 * 60 * 60;

const HANDOFF_MESSAGE =
  "Thanks for all your messages! I've passed this to our team and someone will reach out to you shortly. You can also call us on " +
  `${SUPPORT_PHONE}.`;

/** Appended to the system prompt during the wind-down window. */
const WIND_DOWN_ADDENDUM = `
This conversation has been going on for a while — start wrapping it up warmly.
If they still have an open concern you can't fully resolve, offer to pass it to a
human (call handoff_to_team) and let them know someone will follow up. Do NOT open
new topics or ask open-ended questions that would prolong the conversation. If they
have nothing more, reassure them and close the chat politely.
`.trim();

/** Bound the tool-call back-and-forth within a single inbound turn. */
const MAX_TOOL_ITERATIONS = 5;
/** How many prior chat-log rows to feed the model as context. */
const HISTORY_LIMIT = 20;

const TOOLS: AiTool[] = [
  {
    name: 'handoff_to_team',
    description:
      'Flag this conversation for a human to follow up — call this when the ' +
      'applicant asks to speak to a human, is upset or confused, or you ' +
      'genuinely cannot help them.',
    parameters: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description:
            'One short line for the team: who this is and why you handed off.',
        },
      },
      required: ['summary'],
    },
  },
];

/**
 * Build the per-turn system prompt. Live data (name, property, availability) is
 * injected fresh every inbound message — the handler is stateless, so there is
 * no staleness: the `unavailable` snapshot is always current.
 */
function buildSystemPrompt(opts: {
  firstName: string;
  propertyName?: string;
  propertyLocation?: string;
  unavailable: boolean;
}): string {
  const { firstName, propertyName, propertyLocation, unavailable } = opts;

  const propertyDescriptor = propertyName
    ? `their application for *${propertyName}*${
        propertyLocation ? ` (${propertyLocation})` : ''
      }`
    : 'their rental application';

  const situation = unavailable
    ? `
CURRENT SITUATION: the property this person applied for is NO LONGER AVAILABLE.
- Only bring this up IF they ask about their status, their application, or this
  specific property (e.g. "any update?", "did I get it?", "what's happening?").
  If they're just greeting you or asking general questions, do NOT volunteer it —
  simply help them.
- When you do tell them: say warmly that the property is no longer available, and
  that they can call us on ${SUPPORT_PHONE} to find out more or to check out other
  available properties.
- NEVER use the word "rejected", "declined", "denied", or any negative framing
  about them. Never imply they were turned down. Keep it about the property simply
  no longer being available.
`.trim()
    : `
CURRENT SITUATION: their application is still under review by the landlord.
- Reassure them that the landlord is still reviewing ${propertyDescriptor} and will
  get back to them once a decision has been made.
- Do NOT promise any timeline, outcome, or approval. Only mention the review status
  if they ask about it; otherwise just be helpful.
`.trim();

  return `
You are Lizt's friendly WhatsApp assistant for Property Kraft, talking to
${firstName ? `${firstName}, ` : ''}someone who has submitted a rental
application (KYC) and is waiting to hear back from the landlord.

Your job is to support them warmly while they wait: reassure them, answer their
questions about Lizt / Property Kraft, and — only when relevant — let them know
where their application stands.

${situation}

Style:
- Human, warm, concise. This is WhatsApp — keep replies short (1-4 short sentences).
- Reply in the same language/style the person uses (e.g. English or Nigerian Pidgin).
- One message per turn. Have a real conversation; don't dump everything at once.

Hard rules:
- Only state facts from the KNOWLEDGE section. Never invent prices, fees, features,
  timelines, or promises. For specifics you don't have, say the team will follow up.
- Stay on topic (Lizt / Property Kraft / property management / their application).
  Politely decline and redirect anything unrelated — you are not a general assistant.
- If asked whether you're a bot, say honestly that you're Lizt's automated
  assistant. Don't pretend to be a specific named person.
- You reply in PLAIN TEXT only — this is a WhatsApp chat with no buttons.

Tools (call them, don't just talk about them):
- handoff_to_team: when the person asks to speak to a human, is upset/confused, or
  you can't help — flag it for a human and let them know someone will reach out.

KNOWLEDGE:
${UNKNOWNS_KNOWLEDGE}

${OTP_GUARDRAIL}
`.trim();
}

/**
 * AI assistant for tenant *applicants* (people with a PENDING/REJECTED KYC
 * application waiting on a landlord decision). Mirrors UnknownsAiService: runs a
 * tool-calling conversation via the configured LLM provider, reassures the
 * applicant, answers Lizt questions from the shared knowledge base, and — only
 * when they ask — tells them whether the property is still available.
 *
 * Entry point is tryHandle(): returns true if it handled the turn, false to tell
 * the caller to fall back to the static handleKYCApplicantMessage reply (flag
 * off, client unconfigured, empty text, or anything throws).
 */
@Injectable()
export class ApplicantAiService {
  private readonly logger = new Logger(ApplicantAiService.name);

  constructor(
    private readonly llm: LlmService,
    private readonly cache: CacheService,
    private readonly utilService: UtilService,
    private readonly chatLogService: ChatLogService,
    private readonly templateSender: TemplateSenderService,
    @InjectRepository(Waitlist)
    private readonly waitlistRepo: Repository<Waitlist>,
    @InjectRepository(PropertyTenant)
    private readonly propertyTenantRepo: Repository<PropertyTenant>,
    @InjectRepository(Property)
    private readonly propertyRepo: Repository<Property>,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * @returns true if the AI handled the message; false if the caller should run
   * the static fallback reply instead.
   */
  async tryHandle(
    from: string,
    rawUserText: string,
    application: KYCApplication,
  ): Promise<boolean> {
    if (!this.llm.isEnabled()) return false;

    const userText = (rawUserText || '').trim();
    if (!userText) return false;

    try {
      // Abuse / cost cap — counts inbound turns per phone, window starts on first hit.
      // Shared with the unknowns flow (same person, same 24h budget).
      const phone = this.utilService.normalizePhoneNumber(from);
      const turns = await this.cache.incrementWithTtlNx(
        `ai_turns_${phone}`,
        TURN_CAP_WINDOW_SECONDS,
      );

      // Hard cap: stop calling the LLM. Hand off + notify once (setNx guard),
      // then go silent for the rest of the window so we don't spam the same line.
      if (turns > HARD_TURN_CAP) {
        const firstNotice = await this.cache.setNx(
          `ai_handoff_notified_${phone}`,
          '1',
          TURN_CAP_WINDOW_SECONDS,
        );
        if (firstNotice) {
          await this.handoff(
            from,
            application,
            'Conversation turn cap reached',
          );
          await this.templateSender.sendText(from, HANDOFF_MESSAGE);
        }
        return true; // handled — silent on repeats
      }

      const unavailable = await this.isPropertyUnavailable(application);

      // Wind-down zone: still answer, but steer toward a graceful close.
      const windDown = turns >= SOFT_TURN_CAP;
      const system = await this.buildSystem(application, unavailable, windDown);
      const messages = await this.buildHistory(from, userText);
      const body = await this.runConversationWithRetry(from, application, {
        system,
        messages,
      });

      await this.templateSender.sendText(
        from,
        body ||
          'Thanks for reaching out! Your landlord is still reviewing your application and will get back to you.',
      );
      return true;
    } catch (err) {
      this.logger.error(
        `AI applicant flow failed for ${from}; falling back to static reply: ${(err as Error).message}`,
      );
      return false;
    }
  }

  /**
   * Is the applied-for property no longer available to this applicant?
   * REJECTED -> always. PENDING -> only if an ACTIVE property_tenant exists on the
   * property (they can't be that tenant — they're not APPROVED). This is a real,
   * recurring case: only the offer-letter payment path auto-rejects competitors;
   * the other attachment paths leave applications orphaned as PENDING.
   */
  private async isPropertyUnavailable(
    application: KYCApplication,
  ): Promise<boolean> {
    if (application.status === ApplicationStatus.REJECTED) return true;
    if (!application.property_id) return false;
    const activeCount = await this.propertyTenantRepo.count({
      where: {
        property_id: application.property_id,
        status: TenantStatusEnum.ACTIVE,
      },
    });
    return activeCount > 0;
  }

  /** Build the per-turn system prompt with fresh applicant + property context. */
  private async buildSystem(
    application: KYCApplication,
    unavailable: boolean,
    windDown: boolean,
  ): Promise<string> {
    let property: Property | null = null;
    if (application.property_id) {
      property = await this.propertyRepo.findOne({
        where: { id: application.property_id },
      });
    }

    const base = buildSystemPrompt({
      firstName: (application.first_name || '').trim(),
      propertyName: property?.name?.trim(),
      propertyLocation: property?.location?.trim(),
      unavailable,
    });

    return windDown ? `${base}\n\n${WIND_DOWN_ADDENDUM}` : base;
  }

  /** Build the LLM message array from recent chat history + the current message. */
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
      // Redact OTP/verification codes before they ever enter the model context.
      const content = redactSensitiveContent(
        (row.content || '').trim(),
        (row.metadata as { template?: { name?: string } } | null)?.template
          ?.name,
      );
      // Skip empties and opaque markers (flow completions, etc.) — not readable turns.
      if (!content || content.startsWith('flow:')) continue;
      const role =
        row.direction === MessageDirection.INBOUND ? 'user' : 'assistant';
      messages.push({ role, content });
    }

    // History must start with a user turn for the API.
    while (messages.length && messages[0].role === 'assistant') {
      messages.shift();
    }

    // Append the current message unless logging already raced it in as the last turn.
    const last = messages[messages.length - 1];
    if (!(last && last.role === 'user' && last.content === userText)) {
      messages.push({ role: 'user', content: userText });
    }
    if (messages.length === 0) {
      messages.push({ role: 'user', content: userText });
    }
    return messages;
  }

  /**
   * Run one inbound turn, retrying once on failure before giving up (which lets
   * the caller fall back to the static reply). Safe to re-run: the cap counter is
   * incremented upstream and the handoff tool upserts the same waitlist row.
   */
  private async runConversationWithRetry(
    from: string,
    application: KYCApplication,
    args: { system: string; messages: AiMessage[] },
  ): Promise<string> {
    try {
      return await this.runConversation(from, application, args);
    } catch (err) {
      this.logger.warn(
        `AI applicant turn failed for ${from}, retrying once: ${(err as Error).message}`,
      );
      return await this.runConversation(from, application, args);
    }
  }

  /**
   * Run the tool-call loop for one inbound turn. Executes the handoff tool and
   * returns the assistant's final plain-text reply.
   */
  private async runConversation(
    from: string,
    application: KYCApplication,
    args: { system: string; messages: AiMessage[] },
  ): Promise<string> {
    const { text } = await this.llm.runConversation({
      system: args.system,
      history: args.messages,
      tools: TOOLS,
      maxIterations: MAX_TOOL_ITERATIONS,
      onToolUse: (call) => this.executeTool(from, application, call),
    });

    return text.trim();
  }

  /** Execute one tool call; returns a short result string fed back to the model. */
  private async executeTool(
    from: string,
    application: KYCApplication,
    call: AiToolUse,
  ): Promise<string> {
    const input = call.input || {};
    try {
      switch (call.name) {
        case 'handoff_to_team': {
          await this.handoff(from, application, asStr(input.summary));
          return 'Flagged for a human to follow up. Let them know someone will reach out.';
        }
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

  /** Flag the applicant for human follow-up + surface it on the landlord's feed. */
  private async handoff(
    from: string,
    application: KYCApplication,
    summary: string,
  ): Promise<void> {
    const wl = await this.getOrCreateWaitlist(from, application);
    wl.needs_human = true;
    if (summary) {
      // Keep both the original reason and the hand-off note (no dedicated column yet).
      wl.reason = wl.reason ? `${wl.reason} | handoff: ${summary}` : summary;
    }
    if (!wl.source) wl.source = 'applicant';
    await this.waitlistRepo.save(wl);

    await this.logHandoffToLandlordFeed(application, summary);
  }

  /**
   * Append a "needs help" item to the owning landlord's dashboard live feed.
   * Best-effort: a feed failure must never break the handoff or the reply.
   * The landlord is the applied-for property's owner (`owner_id` = Account.id).
   */
  private async logHandoffToLandlordFeed(
    application: KYCApplication,
    summary: string,
  ): Promise<void> {
    try {
      if (!application.property_id) return;
      const property = await this.propertyRepo.findOne({
        where: { id: application.property_id },
      });
      if (!property?.owner_id) return;

      const applicantName =
        `${application.first_name || ''} ${application.last_name || ''}`.trim() ||
        'An applicant';
      const propertyName = property.name?.trim();
      const description =
        `${applicantName} (applicant${
          propertyName ? ` for ${propertyName}` : ''
        }) asked to speak with someone on WhatsApp` +
        (summary ? `: ${summary}` : '.');

      await this.notificationService.create({
        date: new Date().toISOString(),
        type: NotificationType.APPLICANT_HANDOFF,
        description,
        status: 'Pending',
        property_id: application.property_id,
        user_id: property.owner_id,
      });
    } catch (err) {
      this.logger.error(
        `Failed to log applicant handoff to landlord feed: ${(err as Error).message}`,
      );
    }
  }

  /** Find this phone's waitlist row, or build a new (unsaved) one for the applicant. */
  private async getOrCreateWaitlist(
    from: string,
    application: KYCApplication,
  ): Promise<Waitlist> {
    const phone = this.utilService.normalizePhoneNumber(from);
    const existing = await this.waitlistRepo.findOne({
      where: { phone_number: phone },
    });
    if (existing) {
      existing.source = 'applicant';
      return existing;
    }
    const fullName = `${application.first_name || ''} ${
      application.last_name || ''
    }`.trim();
    return this.waitlistRepo.create({
      phone_number: phone,
      full_name: fullName,
      option: '',
      source: 'applicant',
    });
  }
}
