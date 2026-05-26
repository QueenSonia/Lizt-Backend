import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

import { ClassifyRequest } from './dto/classify-request.dto';
import { LlmOutcome, RawLlmResult } from './dto/raw-llm-result.dto';
import {
  PrimaryIntent,
  SubIntent,
  INTENT_META,
} from './intent-taxonomy';

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

@Injectable()
export class LlmClientService {
  private readonly logger = new Logger(LlmClientService.name);
  private readonly client: OpenAI | null;
  private readonly model: string;
  private readonly enabled: boolean;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('GROQ_API_KEY');
    this.model = this.config.get<string>('GROQ_MODEL') || DEFAULT_MODEL;
    this.enabled = !!apiKey;

    if (this.enabled) {
      this.client = new OpenAI({
        apiKey,
        baseURL: GROQ_BASE_URL,
      });
    } else {
      this.client = null;
      this.logger.warn(
        'LlmClientService: GROQ_API_KEY not set — classifier will return errors and the router will fall back to the menu.',
      );
    }
  }

  /**
   * Classify a tenant message. Never throws — returns a discriminated outcome
   * so the caller can decide how to fall back.
   */
  async classify(input: ClassifyRequest): Promise<LlmOutcome> {
    const startedAt = Date.now();

    if (!this.enabled || !this.client) {
      return {
        ok: false,
        error: {
          kind: 'http_error',
          message: 'GROQ_API_KEY not configured',
        },
        latencyMs: Date.now() - startedAt,
      };
    }

    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(input);

    try {
      const completion = await this.withTimeout(
        this.client.chat.completions.create({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
          max_tokens: 600,
        }),
        DEFAULT_TIMEOUT_MS,
      );

      const raw = completion.choices?.[0]?.message?.content ?? '';
      const parsed = this.parseAndValidate(raw);
      if (!parsed) {
        return {
          ok: false,
          error: {
            kind: 'parse_error',
            message: `Could not parse LLM response: ${raw.slice(0, 200)}`,
          },
          latencyMs: Date.now() - startedAt,
        };
      }
      return { ok: true, result: parsed, latencyMs: Date.now() - startedAt };
    } catch (err) {
      const e = err as Error & { status?: number };
      if (e.message === '__timeout__') {
        return {
          ok: false,
          error: { kind: 'timeout', message: `Groq call exceeded ${DEFAULT_TIMEOUT_MS}ms` },
          latencyMs: Date.now() - startedAt,
        };
      }
      return {
        ok: false,
        error: {
          kind: 'http_error',
          message: e.message,
          http_status: e.status,
        },
        latencyMs: Date.now() - startedAt,
      };
    }
  }

  private withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('__timeout__')), ms);
      p.then(
        (v) => {
          clearTimeout(t);
          resolve(v);
        },
        (e) => {
          clearTimeout(t);
          reject(e);
        },
      );
    });
  }

  private buildSystemPrompt(): string {
    const subIntents = Object.values(SubIntent)
      .map((s) => `- ${s} (${INTENT_META[s].primary})`)
      .join('\n');

    return [
      'You classify tenant WhatsApp messages for a property-management bot.',
      'The bot is button-driven; you only see messages that fell through the bot\'s expected states.',
      'Return STRICT JSON only, matching the schema below. Do not add prose around the JSON.',
      '',
      'Schema:',
      '{',
      '  "intent": one of MAINTENANCE | TENANCY | PAYMENT | ACCOUNT_INFO | MESSAGE_TO_HUMAN | META_SOCIAL,',
      '  "sub_intent": one of the sub-intent codes below,',
      '  "confidence": number in [0,1] reflecting how sure you are,',
      '  "extracted": {',
      '     "description": optional string (for report_new),',
      '     "reason": optional string (for deny_filed_request, tenancy_dispute),',
      '     "target_request_hint": optional string (text the tenant used to refer to a specific request),',
      '     "message_to_human": optional string (the exact message to relay to landlord/FM),',
      '     "question": optional string (the question to answer for *_QUESTION / INFO_*),',
      '     "property_hint": optional string (a property name/identifier mentioned)',
      '  },',
      '  "suggested_reply": short string the bot could send back. Do not include the words "approved", "resolved", "reopened", "rejected", "denied", "pending_tenant_confirmation". Only use "pending" or "closed" for maintenance status.',
      '}',
      '',
      'Allowed sub_intent values:',
      subIntents,
      '',
      'Rules:',
      '- If the message has no clear intent, return META_SOCIAL/unclear with low confidence.',
      '- "thanks"/"ok"/"👍" → META_SOCIAL/acknowledgement.',
      '- "hi"/"hello"/"good morning" → META_SOCIAL/greeting.',
      '- A clear maintenance description like "my roof is leaking" → MAINTENANCE/report_new with description extracted.',
      '- A reply like "yes that\'s mine" or "no I never reported that" makes sense ONLY when the prior bot message asked the tenant to confirm/deny an FM-filed request — choose MAINTENANCE/confirm_filed_request or MAINTENANCE/deny_filed_request. For deny, also extract the reason.',
      '- "give me till weekend" / "let me check later" after a resolution-confirmation prompt → MAINTENANCE/postpone_confirmation.',
      '- "tell my landlord X" / "ask the FM Y" → MESSAGE_TO_HUMAN/to_landlord or to_fm with the relayable text in message_to_human.',
      '- The tenant may use Nigerian English or pidgin. That does not change classification rules.',
      '- Never invent maintenance request IDs, amounts, dates, or names. Only quote what the tenant actually said.',
    ].join('\n');
  }

  private buildUserPrompt(input: ClassifyRequest): string {
    const parts: string[] = [];
    if (input.priorBotMessage) {
      parts.push(`Most recent bot message (type=${input.priorBotType ?? 'unknown'}):`);
      parts.push(`"""${input.priorBotMessage.slice(0, 600)}"""`);
      parts.push('');
    }
    parts.push(`Tenant ${input.tenant.name} (${input.tenant.propertyCount} properties) just said:`);
    parts.push(`"""${input.text.slice(0, 600)}"""`);
    return parts.join('\n');
  }

  private parseAndValidate(raw: string): RawLlmResult | null {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return null;
    }
    if (typeof json !== 'object' || json === null) return null;

    const obj = json as Record<string, unknown>;
    const intent = obj.intent as PrimaryIntent;
    const subIntent = obj.sub_intent as SubIntent;
    const confidence = obj.confidence as number;

    if (!Object.values(PrimaryIntent).includes(intent)) return null;
    if (!Object.values(SubIntent).includes(subIntent)) return null;
    if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) return null;
    // Catch the model claiming a sub-intent that doesn't match the primary.
    if (INTENT_META[subIntent].primary !== intent) return null;

    const extracted = (obj.extracted as RawLlmResult['extracted']) ?? {};
    const suggestedReply = typeof obj.suggested_reply === 'string'
      ? obj.suggested_reply
      : '';

    return {
      intent,
      sub_intent: subIntent,
      confidence,
      extracted,
      suggested_reply: suggestedReply,
    };
  }
}
