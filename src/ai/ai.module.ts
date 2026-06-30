import { Module } from '@nestjs/common';
import { LlmService } from './llm.service';
import { AnthropicProvider } from './providers/anthropic.provider';
import { OpenAiProvider } from './providers/openai.provider';

/**
 * AI module — provides the provider-agnostic LlmService (and its backends) to
 * the WhatsApp bot. ConfigModule is global, so no imports needed here.
 * Switch backend via LLM_PROVIDER=anthropic|openai|groq.
 */
@Module({
  providers: [AnthropicProvider, OpenAiProvider, LlmService],
  exports: [LlmService],
})
export class AiModule {}
