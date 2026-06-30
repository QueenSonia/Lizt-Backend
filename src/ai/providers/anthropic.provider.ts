import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { AiToolUse, LlmProvider, RunConversationParams } from '../ai.types';

/**
 * Anthropic (Claude) backend. Translates the neutral message/tool shapes into
 * the Messages API (content blocks, tool_use / tool_result) and runs the loop.
 */
@Injectable()
export class AnthropicProvider implements LlmProvider {
  private readonly logger = new Logger(AnthropicProvider.name);
  private readonly client: Anthropic | null;
  readonly modelId: string;
  private readonly maxTokens: number;

  constructor(private readonly config: ConfigService) {
    this.modelId =
      this.config.get<string>('ANTHROPIC_MODEL') || 'claude-haiku-4-5';
    this.maxTokens =
      Number(this.config.get<string>('ANTHROPIC_MAX_TOKENS')) || 1024;
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
  }

  isEnabled(): boolean {
    return this.client !== null;
  }

  async runConversation(
    params: RunConversationParams,
  ): Promise<{ text: string }> {
    if (!this.client) {
      throw new Error(
        'AnthropicProvider not configured (missing ANTHROPIC_API_KEY).',
      );
    }

    const messages: Anthropic.MessageParam[] = params.history.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    const tools: Anthropic.Tool[] = params.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool.InputSchema,
    }));

    let text = '';
    for (let i = 0; i < params.maxIterations; i++) {
      const message = await this.client.messages.create({
        model: this.modelId,
        max_tokens: this.maxTokens,
        system: params.system,
        messages,
        ...(tools.length ? { tools } : {}),
      });

      let turnText = '';
      const toolUses: AiToolUse[] = [];
      for (const block of message.content) {
        if (block.type === 'text') {
          turnText += block.text;
        } else if (block.type === 'tool_use') {
          toolUses.push({
            id: block.id,
            name: block.name,
            input: (block.input ?? {}) as Record<string, unknown>,
          });
        }
      }
      if (turnText.trim()) text = turnText.trim();

      if (toolUses.length === 0) break;

      messages.push({ role: 'assistant', content: message.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const call of toolUses) {
        const result = await params.onToolUse(call);
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: result,
        });
      }
      messages.push({ role: 'user', content: results });
    }

    return { text };
  }
}
