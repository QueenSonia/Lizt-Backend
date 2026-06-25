/**
 * Provider-neutral LLM abstraction. UnknownsAiService (and future role flows)
 * talk only to these types + the LlmProvider interface, so swapping Anthropic ⇄
 * OpenAI ⇄ Groq is a config change, not a code change. Each provider translates
 * these neutral shapes into its own SDK's message/tool format internally.
 */

/** A prior conversation turn (text only — every provider accepts plain text). */
export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** A tool the model may call. `parameters` is a JSON Schema object. */
export interface AiTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** A single tool call the model decided to make. */
export interface AiToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface RunConversationParams {
  system: string;
  /** Prior turns (oldest-first), including the current user message as the last entry. */
  history: AiMessage[];
  tools: AiTool[];
  /** Hard bound on tool-call round-trips within this inbound turn. */
  maxIterations: number;
  /**
   * Execute a tool call and return the string result fed back to the model.
   * The provider runs the loop and re-encodes each result in its own format.
   */
  onToolUse: (call: AiToolUse) => Promise<string>;
}

/**
 * One LLM backend. Implementations: AnthropicProvider, OpenAiProvider (the
 * latter also serves Groq via a baseURL override).
 */
export interface LlmProvider {
  /** True when a client could be constructed (API key present). */
  isEnabled(): boolean;
  readonly modelId: string;
  /** Run the full tool-calling loop for one inbound turn; returns the final reply text. */
  runConversation(params: RunConversationParams): Promise<{ text: string }>;
}
