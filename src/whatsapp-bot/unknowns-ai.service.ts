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
import { TemplateSenderService, ButtonDefinition } from './template-sender';

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
- NEVER save a lead, save a referral, or hand off to a human until the person has
  explicitly confirmed the details you're about to save. Read the details back and
  ask them to confirm first.
- If asked whether you're a bot, say honestly that you're Lizt's automated
  assistant. Don't pretend to be a specific named person.

Tools (use them, don't just talk about them):
- offer_buttons: use ONLY when your reply is a small set of fixed choices or a
  yes/no confirmation — e.g. "Are you a property owner, a property manager, or a
  house hunter?" or "Save these details? [Yes] [No]". Put the message text in the
  tool's "body" field and the choices as buttons (max 3, each <= 20 characters).
  Do NOT use buttons when you need the person to type something in their own words
  (their name, their reason, a referral's name or phone, or any open question) —
  in those cases reply with plain text and no buttons.
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
    name: 'offer_buttons',
    description:
      'Reply with up to 3 tappable quick-reply buttons. Use for clear choices. ' +
      'You MUST provide the message text (body) shown above the buttons. When you ' +
      'use this tool, the body here is what gets sent — not your separate text.',
    parameters: {
      type: 'object',
      properties: {
        body: {
          type: 'string',
          description:
            'The message text shown above the buttons (required, non-empty).',
        },
        buttons: {
          type: 'array',
          items: { type: 'string' },
          description: 'Up to 3 short button labels (<= 20 chars each).',
        },
      },
      required: ['body', 'buttons'],
    },
  },
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
      const { body, buttons } = await this.runConversation(
        from,
        messages,
        windDown,
      );

      const reply =
        body ||
        'Thanks for reaching out! Someone from our team will get back to you shortly.';
      if (buttons.length) {
        await this.templateSender.sendButtons(from, reply, buttons);
      } else {
        await this.templateSender.sendText(from, reply);
      }
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
   * Run the tool-call loop for one inbound turn. Executes side-effect tools,
   * collects the final text and any quick-reply buttons.
   */
  private async runConversation(
    from: string,
    history: AiMessage[],
    windDown = false,
  ): Promise<{ body: string; buttons: ButtonDefinition[] }> {
    let buttons: ButtonDefinition[] = [];
    let buttonBody = '';

    const system = windDown
      ? `${SYSTEM_PROMPT}\n\n${WIND_DOWN_ADDENDUM}`
      : SYSTEM_PROMPT;

    // The provider runs the tool-call loop; we execute each tool here and capture
    // side data (buttons / button body) via the closure.
    const { text } = await this.llm.runConversation({
      system,
      history,
      tools: TOOLS,
      maxIterations: MAX_TOOL_ITERATIONS,
      onToolUse: async (call) => {
        const result = await this.executeTool(from, call);
        if (call.name === 'offer_buttons') {
          buttons = result.buttons ?? buttons;
          if (result.body) buttonBody = result.body;
        }
        return result.message;
      },
    });

    const body = text.trim();
    // When buttons are present, their own body is the message text (atomic with
    // the buttons); otherwise the assistant's free-text reply is the body.
    return { body: buttons.length ? buttonBody || body : body, buttons };
  }

  /** Execute one tool call; returns a short result string for the model. */
  private async executeTool(
    from: string,
    call: AiToolUse,
  ): Promise<{ message: string; buttons?: ButtonDefinition[]; body?: string }> {
    const input = call.input || {};
    try {
      switch (call.name) {
        case 'offer_buttons': {
          const raw = Array.isArray(input.buttons) ? input.buttons : [];
          const buttons: ButtonDefinition[] = raw
            .slice(0, 3)
            .map((label, i) => ({
              id: `ai_opt_${i}`,
              title: String(label).slice(0, 20),
            }))
            .filter((b) => b.title.trim().length > 0);
          const body = typeof input.body === 'string' ? input.body.trim() : '';
          return {
            message: 'Buttons sent with your body text.',
            buttons,
            body,
          };
        }
        case 'save_lead': {
          const fullName = asStr(input.full_name);
          if (!fullName) {
            return {
              message: 'Error: full_name is required. Ask for their name.',
            };
          }
          const wl = await this.getOrCreateWaitlist(from);
          wl.full_name = fullName;
          wl.reason = asStr(input.reason) || wl.reason;
          if (asStr(input.interest)) wl.option = asStr(input.interest);
          if (!wl.option) wl.option = 'general';
          wl.source = 'ai';
          await this.waitlistRepo.save(wl);
          return { message: 'Lead saved.' };
        }
        case 'save_referral': {
          const name = asStr(input.name);
          const normalized = this.utilService.normalizePhoneNumber(
            asStr(input.phone),
          );
          if (!name || !normalized) {
            return {
              message:
                'Error: a valid name and phone number are required. Ask the person to re-share them.',
            };
          }
          const wl = await this.getOrCreateWaitlist(from);
          wl.referral_name = name;
          wl.referral_phone_number = normalized;
          if (!wl.source) wl.source = 'ai';
          await this.waitlistRepo.save(wl);
          return { message: 'Referral saved.' };
        }
        case 'handoff_to_team': {
          await this.handoff(from, asStr(input.summary));
          return {
            message:
              'Flagged for a human to follow up. Let them know someone will reach out.',
          };
        }
        default:
          return { message: `Unknown tool: ${call.name}` };
      }
    } catch (err) {
      this.logger.error(
        `Tool ${call.name} failed for ${from}: ${(err as Error).message}`,
      );
      return { message: `Error running ${call.name}. Continue gracefully.` };
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
