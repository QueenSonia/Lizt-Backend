import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { AiToolUse, LlmProvider, RunConversationParams } from '../ai.types';

/**
 * OpenAI-compatible backend. Serves both real OpenAI and Groq (OpenAI-compatible
 * API) — selected by LLM_PROVIDER:
 *   - 'openai' → api.openai.com, OPENAI_API_KEY, OPENAI_MODEL (default gpt-4o-mini)
 *   - 'groq'   → api.groq.com,   GROQ_API_KEY,   GROQ_MODEL  (default llama-3.3-70b-versatile)
 * Translates the neutral shapes into Chat Completions (tool_calls / role:'tool').
 */
@Injectable()
export class OpenAiProvider implements LlmProvider {
  private readonly logger = new Logger(OpenAiProvider.name);
  private readonly client: OpenAI | null;
  readonly modelId: string;
  private readonly maxTokens: number;

  constructor(private readonly config: ConfigService) {
    const useGroq =
      (this.config.get<string>('LLM_PROVIDER') || '').toLowerCase() === 'groq';

    let apiKey: string | undefined;
    let baseURL: string | undefined;
    if (useGroq) {
      apiKey = this.config.get<string>('GROQ_API_KEY');
      baseURL = 'https://api.groq.com/openai/v1';
      this.modelId =
        this.config.get<string>('GROQ_MODEL') || 'llama-3.3-70b-versatile';
    } else {
      apiKey = this.config.get<string>('OPENAI_API_KEY');
      this.modelId = this.config.get<string>('OPENAI_MODEL') || 'gpt-4o-mini';
    }
    this.maxTokens =
      Number(this.config.get<string>('OPENAI_MAX_TOKENS')) || 1024;
    this.client = apiKey ? new OpenAI({ apiKey, baseURL }) : null;
  }

  isEnabled(): boolean {
    return this.client !== null;
  }

  async runConversation(
    params: RunConversationParams,
  ): Promise<{ text: string }> {
    if (!this.client) {
      throw new Error('OpenAiProvider not configured (missing API key).');
    }

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: params.system },
      ...params.history.map((m) => ({ role: m.role, content: m.content })),
    ];
    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] =
      params.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));

    let text = '';
    for (let i = 0; i < params.maxIterations; i++) {
      const resp = await this.client.chat.completions.create({
        model: this.modelId,
        max_tokens: this.maxTokens,
        messages,
        ...(tools.length ? { tools, tool_choice: 'auto' } : {}),
      });

      const msg = resp.choices[0]?.message;
      if (msg?.content) text = msg.content.trim();

      const calls = msg?.tool_calls ?? [];
      if (calls.length === 0) break;

      messages.push({
        role: 'assistant',
        content: msg?.content ?? '',
        tool_calls: msg?.tool_calls,
      });
      for (const call of calls) {
        if (call.type !== 'function') continue;
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(call.function.arguments || '{}');
        } catch {
          input = {};
        }
        const toolUse: AiToolUse = {
          id: call.id,
          name: call.function.name,
          input,
        };
        const result = await params.onToolUse(toolUse);
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: result,
        });
      }
    }

    return { text };
  }
}
