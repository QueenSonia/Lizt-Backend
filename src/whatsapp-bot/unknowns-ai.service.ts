import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { LlmService } from '../ai/llm.service';
import { UNKNOWNS_KNOWLEDGE } from '../ai/knowledge/unknowns';
import { AiMessage, AiTool, AiToolUse } from '../ai/ai.types';
import { CacheService } from 'src/lib/cache';
import { UtilService } from 'src/utils/utility-service';
import { Waitlist } from 'src/users/entities/waitlist.entity';
import { ChatLogService } from './chat-log.service';
import { MessageDirection } from './entities/message-direction.enum';
import { TemplateSenderService } from './template-sender';

/** Coerce an unknown tool-input value to a trimmed string (never "[object Object]"). */
const asStr = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * Per-phone turn caps over a rolling 24h window (starts on the first message):
 *  - < SOFT: normal conversation.
 *  - SOFT..HARD-1: "wind-down" — AI keeps replying but is told to wrap up,
 *    capture what it needs, and close gracefully (no hard cut-off).
 *  - >= HARD: stop calling the LLM. Notify once, then stay silent for the window.
 */
const SOFT_TURN_CAP = 20;
const HARD_TURN_CAP = 30;
const TURN_CAP_WINDOW_SECONDS = 24 * 60 * 60;

const HANDOFF_MESSAGE =
  "Thanks for all your messages! I've passed this to our team and someone will reach out to you shortly. You can also call us on 0803 632 2847.";

/** Appended to the system prompt during the wind-down window. */
const WIND_DOWN_ADDENDUM = `
This conversation has been going on for a while — start wrapping it up warmly.
Get to the point: if you still need their name, their reason for reaching out, or
a referral, ask for it directly now, confirm it, save it, and close the chat
politely. Do NOT open new topics or ask open-ended questions that would prolong
the conversation. If they have nothing more, thank them and let them know the
team will follow up.
`.trim();
/** Bound the tool-call back-and-forth within a single inbound turn. */
const MAX_TOOL_ITERATIONS = 5;
/** How many prior chat-log rows to feed the model as context. */
const HISTORY_LIMIT = 20;

const SYSTEM_PROMPT = `
You are Lizt's friendly WhatsApp assistant for Property Kraft, talking to someone
who is NOT yet a customer (an "unknown" contact).

Your job is to turn this chat into a captured lead. You are trying to:
1. Briefly explain what Lizt offers, tailored to what they care about (KNOWLEDGE only).
2. Collect their details: their FULL NAME, WHY they reached out (their need), and
   WHAT they're interested in (e.g. rent collection, house hunting, managing a
   property as an owner or facility manager).
3. As soon as you have at least their name and reason, read the details back, get a
   quick confirmation, then call save_lead. Don't keep chatting without capturing this.
4. After saving (or whenever it fits naturally), ask if they know anyone else who
   could use Lizt; if they share a name + phone, confirm and call save_referral.
Steps 2-3 are the primary goal — everything else exists to get you there.

Style:
- Human, warm, concise. This is WhatsApp — keep replies short (1-4 short sentences).
- Reply in the same language/style the person uses (e.g. English or Nigerian Pidgin).
- One message per turn. Don't dump everything at once; have a real conversation.
- Stay goal-directed: every reply should move toward learning who they are, why
  they reached out, or getting a referral. If they drift into small talk or
  topics that don't get us any of that, acknowledge briefly and steer back —
  don't get pulled into long back-and-forth that gives us nothing useful.

Hard rules:
- Only state facts from the KNOWLEDGE section. Never invent prices, fees, features,
  or promises. For specifics you don't have, say the team will follow up.
- Stay on topic (Lizt / Property Kraft / property management). Politely decline and
  redirect anything unrelated — you are not a general assistant.
- NEVER call save_lead, save_referral, or handoff_to_team until the person has
  explicitly confirmed (in plain words) the details you're about to save. Read the
  details back and ask them to confirm first. This applies to SAVING only — for
  ordinary questions or when giving information (e.g. a summary), just answer;
  don't ask "is that correct?".
- If asked whether you're a bot, say honestly that you're Lizt's automated
  assistant. Don't pretend to be a specific named person.

You reply in PLAIN TEXT only — this is a WhatsApp chat with no buttons. When you
need a yes/no, ask for it in words (e.g. "Want me to pass your details to our
team? (yes/no)").

Tools (call them, don't just talk about them):
- save_lead: AFTER the person confirms — record their name, why they messaged, and
  what they're interested in.
- save_referral: AFTER the person confirms — record a referral's name and phone.
- handoff_to_team: when the person asks to speak to a human, or you can't help —
  let them know a human will reach out.

KNOWLEDGE:
${UNKNOWNS_KNOWLEDGE}
`.trim();

const TOOLS: AiTool[] = [
  {
    name: 'save_lead',
    description:
      "Record this person as a lead. Call ONLY after they've confirmed the details.",
    parameters: {
      type: 'object',
      properties: {
        full_name: { type: 'string', description: "The person's full name." },
        reason: {
          type: 'string',
          description: 'Why they reached out, in a short phrase.',
        },
        interest: {
          type: 'string',
          description:
            "What they're interested in (e.g. 'rent collection', 'house hunting'). Optional.",
        },
      },
      required: ['full_name', 'reason'],
    },
  },
  {
    name: 'save_referral',
    description:
      "Record a referral the person shared. Call ONLY after they've confirmed it.",
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: "The referral's name." },
        phone: { type: 'string', description: "The referral's phone number." },
      },
      required: ['name', 'phone'],
    },
  },
  {
    name: 'handoff_to_team',
    description:
      'Flag this conversation for a human to follow up — call this when the person ' +
      'asks to speak to a human, or when you genuinely cannot help them.',
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
 * AI assistant for unknown WhatsApp contacts. Runs a tool-calling conversation
 * via the configured LLM provider (LlmService): explains Lizt, captures the lead
 * + reason, optionally a referral, all into the waitlist table.
 *
 * Entry point is tryHandle(): returns true if it handled the turn, false to tell
 * the caller to fall back to the legacy button flow (used when the flag is off,
 * the client is unconfigured, or anything throws — the lead is never stranded).
 */
@Injectable()
export class UnknownsAiService {
  private readonly logger = new Logger(UnknownsAiService.name);

  constructor(
    private readonly llm: LlmService,
    private readonly cache: CacheService,
    private readonly utilService: UtilService,
    private readonly chatLogService: ChatLogService,
    private readonly templateSender: TemplateSenderService,
    @InjectRepository(Waitlist)
    private readonly waitlistRepo: Repository<Waitlist>,
  ) {}

  /**
   * @returns true if the AI handled the message; false if the caller should run
   * the legacy button flow instead.
   */
  async tryHandle(from: string, rawUserText: string): Promise<boolean> {
    if (!this.llm.isEnabled()) return false;

    const userText = (rawUserText || '').trim();
    if (!userText) return false;

    try {
      // Abuse / cost cap — counts inbound turns per phone, window starts on first hit.
      const phone = this.utilService.normalizePhoneNumber(from);
      const turns = await this.cache.incrementWithTtlNx(
        `ai_turns_${phone}`,
        TURN_CAP_WINDOW_SECONDS,
      );

      // Hard cap: stop calling the LLM. Notify once (setNx guard), then go silent
      // for the rest of the window so the person isn't spammed the same line.
      if (turns > HARD_TURN_CAP) {
        const firstNotice = await this.cache.setNx(
          `ai_handoff_notified_${phone}`,
          '1',
          TURN_CAP_WINDOW_SECONDS,
        );
        if (firstNotice) {
          await this.handoff(from, 'Conversation turn cap reached');
          await this.templateSender.sendText(from, HANDOFF_MESSAGE);
        }
        return true; // handled — silent on repeats
      }

      // Wind-down zone: still answer, but steer toward a graceful close.
      const windDown = turns >= SOFT_TURN_CAP;
      const messages = await this.buildHistory(from, userText);
      const body = await this.runConversationWithRetry(
        from,
        messages,
        windDown,
      );

      await this.templateSender.sendText(
        from,
        body ||
          'Thanks for reaching out! Someone from our team will get back to you shortly.',
      );
      return true;
    } catch (err) {
      this.logger.error(
        `AI unknowns flow failed for ${from}; falling back to button flow: ${(err as Error).message}`,
      );
      return false;
    }
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
      const content = (row.content || '').trim();
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
   * the caller fall back to the legacy flow). Covers stochastic tool-call
   * generation errors (notably Groq/llama) and transient 5xx/timeout blips. Safe
   * to re-run: the cap counter is incremented upstream and the side-effect tools
   * upsert the same waitlist row (no duplicates).
   */
  private async runConversationWithRetry(
    from: string,
    history: AiMessage[],
    windDown: boolean,
  ): Promise<string> {
    try {
      return await this.runConversation(from, history, windDown);
    } catch (err) {
      this.logger.warn(
        `AI turn failed for ${from}, retrying once: ${(err as Error).message}`,
      );
      return await this.runConversation(from, history, windDown);
    }
  }

  /**
   * Run the tool-call loop for one inbound turn. Executes side-effect tools and
   * returns the assistant's final plain-text reply.
   */
  private async runConversation(
    from: string,
    history: AiMessage[],
    windDown = false,
  ): Promise<string> {
    const system = windDown
      ? `${SYSTEM_PROMPT}\n\n${WIND_DOWN_ADDENDUM}`
      : SYSTEM_PROMPT;

    // The provider runs the tool-call loop; we execute each tool here.
    const { text } = await this.llm.runConversation({
      system,
      history,
      tools: TOOLS,
      maxIterations: MAX_TOOL_ITERATIONS,
      onToolUse: (call) => this.executeTool(from, call),
    });

    return text.trim();
  }

  /** Execute one tool call; returns a short result string fed back to the model. */
  private async executeTool(from: string, call: AiToolUse): Promise<string> {
    const input = call.input || {};
    try {
      switch (call.name) {
        case 'save_lead': {
          const fullName = asStr(input.full_name);
          if (!fullName) {
            return 'Error: full_name is required. Ask for their name.';
          }
          const wl = await this.getOrCreateWaitlist(from);
          wl.full_name = fullName;
          wl.reason = asStr(input.reason) || wl.reason;
          if (asStr(input.interest)) wl.option = asStr(input.interest);
          if (!wl.option) wl.option = 'general';
          wl.source = 'ai';
          await this.waitlistRepo.save(wl);
          return 'Lead saved.';
        }
        case 'save_referral': {
          const name = asStr(input.name);
          const normalized = this.utilService.normalizePhoneNumber(
            asStr(input.phone),
          );
          if (!name || !normalized) {
            return 'Error: a valid name and phone number are required. Ask the person to re-share them.';
          }
          const wl = await this.getOrCreateWaitlist(from);
          wl.referral_name = name;
          wl.referral_phone_number = normalized;
          if (!wl.source) wl.source = 'ai';
          await this.waitlistRepo.save(wl);
          return 'Referral saved.';
        }
        case 'handoff_to_team': {
          await this.handoff(from, asStr(input.summary));
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

  /** Flag the lead for human follow-up (stored only — no notification this phase). */
  private async handoff(from: string, summary: string): Promise<void> {
    const wl = await this.getOrCreateWaitlist(from);
    wl.needs_human = true;
    if (summary) {
      // Keep both the original reason and the hand-off note (no dedicated column yet).
      wl.reason = wl.reason ? `${wl.reason} | handoff: ${summary}` : summary;
    }
    if (!wl.source) wl.source = 'ai';
    await this.waitlistRepo.save(wl);
  }

  /** Find this phone's waitlist row, or build a new (unsaved) one. */
  private async getOrCreateWaitlist(from: string): Promise<Waitlist> {
    const phone = this.utilService.normalizePhoneNumber(from);
    const existing = await this.waitlistRepo.findOne({
      where: { phone_number: phone },
    });
    if (existing) return existing;
    return this.waitlistRepo.create({
      phone_number: phone,
      full_name: '',
      option: '',
    });
  }
}
