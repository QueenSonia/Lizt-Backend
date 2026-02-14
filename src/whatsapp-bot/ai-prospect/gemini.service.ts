import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Groq from 'groq-sdk';

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private client: Groq;
  private model: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('GROQ_API_KEY');
    this.model =
      this.configService.get<string>('GROQ_MODEL') || 'llama-3.3-70b-versatile';

    if (!apiKey) {
      this.logger.warn(
        '⚠️ GROQ_API_KEY not configured — AI responses will be disabled',
      );
      return;
    }

    this.client = new Groq({ apiKey });
    this.logger.log(`✅ Groq service initialized with model: ${this.model}`);
  }

  async generateResponse(
    systemPrompt: string,
    conversationHistory: { role: 'user' | 'model'; content: string }[],
    userMessage: string,
  ): Promise<string> {
    if (!this.client) {
      return 'I apologize, but the AI service is currently unavailable. A human agent will assist you shortly.';
    }

    try {
      const messages: Groq.Chat.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        ...conversationHistory.map((msg) => ({
          role: (msg.role === 'model' ? 'assistant' : 'user') as
            | 'assistant'
            | 'user',
          content: msg.content,
        })),
        { role: 'user', content: userMessage },
      ];

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages,
        max_tokens: 1024,
        temperature: 0.7,
        top_p: 0.9,
      });

      const text = response.choices?.[0]?.message?.content?.trim();
      if (!text) {
        this.logger.warn('Empty response from Groq');
        return 'I apologize, I had trouble processing that. Could you rephrase your question?';
      }

      return text;
    } catch (error) {
      this.logger.error('Groq API error:', error.message);
      return 'I apologize, I encountered an issue. A human agent will be notified to assist you.';
    }
  }

  /**
   * Generate a structured extraction from the conversation.
   * Returns JSON with extracted prospect info.
   */
  async extractProspectInfo(
    conversationText: string,
    existingData: Record<string, any>,
  ): Promise<Record<string, any>> {
    if (!this.client) return existingData;

    try {
      const prompt = `Analyze this conversation and extract/update prospect information. 
Return ONLY valid JSON with these fields (omit fields with no data):
{
  "prospect_name": "string or null",
  "intent": "house_hunting | property_listing | general_inquiry | viewing_request",
  "preferences": {
    "budget_min": number or null,
    "budget_max": number or null,
    "preferred_locations": ["string"] or null,
    "bedrooms": number or null,
    "move_in_date": "string" or null,
    "property_type": "string" or null,
    "other_notes": "string" or null
  },
  "schedule": {
    "requested_dates": ["string"] or null,
    "notes": "string" or null
  },
  "summary": "Brief 1-2 sentence summary of the conversation so far"
}

Existing data (merge, don't overwrite with null):
${JSON.stringify(existingData)}

Conversation:
${conversationText}`;

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 512,
        temperature: 0.1,
      });

      const text = response.choices?.[0]?.message?.content?.trim();
      if (!text) return existingData;

      // Extract JSON from response (may be wrapped in code block)
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return existingData;

      const parsed = JSON.parse(jsonMatch[0]);
      return parsed;
    } catch (error) {
      this.logger.error('Failed to extract prospect info:', error.message);
      return existingData;
    }
  }
}
