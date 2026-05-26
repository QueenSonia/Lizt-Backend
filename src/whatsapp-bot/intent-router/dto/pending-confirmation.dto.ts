import { PrimaryIntent, SubIntent } from '../intent-taxonomy';
import { RawLlmResult } from './raw-llm-result.dto';

export interface PendingConfirmation {
  intent: PrimaryIntent;
  subIntent: SubIntent;
  extracted: RawLlmResult['extracted'];
  // Sub-intent-specific resolved IDs captured at confirmation-card creation
  // time so the executor doesn't have to re-resolve them on confirm (e.g. the
  // MR id for MR_CONFIRM_FILED_REQUEST / MR_DENY_FILED_REQUEST). Optional.
  resolved: {
    maintenanceRequestId?: string;
    propertyId?: string;
  };
  createdAt: number;
}
