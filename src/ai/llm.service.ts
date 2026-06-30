import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmProvider, RunConversationParams } from './ai.types';
import { AnthropicProvider } from './providers/anthropic.provider';
import { OpenAiProvider } from './providers/openai.provider';

/**
 * Public entry point for the AI assistant. Picks the active LLM backend from
 * LLM_PROVIDER ('anthropic' | 'openai' | 'groq') and applies the global
 * AI_ASSISTANT_ENABLED gate. Consumers inject THIS, never a specific provider.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly enabled: boolean;
  private readonly active: LlmProvider;
  private readonly providerName: string;

  constructor(
    private readonly config: ConfigService,
    anthropic: AnthropicProvider,
    openai: OpenAiProvider,
  ) {
    this.enabled = this.config.get<string>('AI_ASSISTANT_ENABLED') === 'true';
    this.providerName = (
      this.config.get<string>('LLM_PROVIDER') || 'openai'
    ).toLowerCase();

    // 'openai' and 'groq' both use the OpenAI-compatible provider.
    this.active =
      this.providerName === 'openai' || this.providerName === 'groq'
        ? openai
        : anthropic;

    if (this.enabled && !this.active.isEnabled()) {
      this.logger.error(
        `AI_ASSISTANT_ENABLED=true with LLM_PROVIDER=${this.providerName}, but that provider has no API key — AI replies will fall back until the key is added.`,
      );
    }
  }

  /** True only when the flag is on AND the active provider is configured. */
  isEnabled(): boolean {
    return this.enabled && this.active.isEnabled();
  }

  get modelId(): string {
    return this.active.modelId;
  }

  runConversation(params: RunConversationParams): Promise<{ text: string }> {
    return this.active.runConversation(params);
  }
}
