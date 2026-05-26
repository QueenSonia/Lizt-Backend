import { PrimaryIntent, SubIntent } from '../intent-taxonomy';

export interface RawLlmResult {
  intent: PrimaryIntent;
  sub_intent: SubIntent;
  confidence: number;
  extracted: {
    // Free-form extracted strings for the model to populate. Each field is
    // optional; consumers (executors) read only the fields they need for the
    // specific sub-intent.
    description?: string;        // MR_REPORT_NEW
    reason?: string;             // MR_DENY_FILED_REQUEST, TENANCY_DISPUTE
    target_request_hint?: string;// MR_CHECK_STATUS / MR_ADD_DETAIL / MR_*_RESOLVED — text to disambiguate
    message_to_human?: string;   // HUMAN_*
    question?: string;           // *_QUESTION / INFO_*
    property_hint?: string;      // optional property selector when tenant has multiple
  };
  suggested_reply: string;
}

export interface LlmError {
  kind: 'timeout' | 'http_error' | 'parse_error' | 'unknown';
  message: string;
  http_status?: number;
}

export type LlmOutcome =
  | { ok: true; result: RawLlmResult; latencyMs: number }
  | { ok: false; error: LlmError; latencyMs: number };
