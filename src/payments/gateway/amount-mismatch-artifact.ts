import { Repository } from 'typeorm';
import { PropertyHistory } from '../../property-history/entities/property-history.entity';

export const AMOUNT_MISMATCH_EVENT = 'payment_amount_mismatch';

/** Structural logger — satisfied by both Nest's Logger and PaystackLogger. */
interface MismatchLogger {
  error(message: string, ...meta: any[]): void;
}

export interface AmountMismatchArtifactArgs {
  /** Our merchant reference — also the dedupe key. */
  reference: string;
  /** Amount the gateway says it actually received, in naira. */
  amountNaira: number;
  /** The gateway's own status string (PARTIALLY_PAID / OVERPAID / …). */
  rawStatus: string;
  /** Adapter name that reported it. */
  gateway: string;
  /** Round-tripped init metadata — carries property_id / tenant_id. */
  metadata: Record<string, any> | null;
  /** Human label for the lane, used in the fallback log line. */
  lane: string;
  relatedEntityId?: string | null;
  relatedEntityType?: string | null;
  /** What we asked the tenant to pay, when the lane knows it. */
  expectedNaira?: number | null;
}

/**
 * Durable, deduped ops artifact for the case where a gateway confirms money
 * was received but NOT as a clean success (Monnify PARTIALLY_PAID / OVERPAID).
 *
 * This is what the `moneyReceived` contract in payment-gateway.interface.ts
 * requires: the money is REAL and sitting at the gateway, and we deliberately
 * do not credit it — so nothing else in the system records that it exists. A
 * log line alone is not enough (it needs someone to happen to read it), which
 * is why every lane routes through here to write a landlord-visible history
 * row someone can act on.
 *
 * Deduped on `reference` so a redelivered webhook and the tenant's
 * redirect-return verify — which both observe the same event — don't stack
 * duplicate rows.
 *
 * Never throws: reconciliation visibility must not break a payment path.
 */
export async function recordAmountMismatchArtifact(
  repo: Repository<PropertyHistory>,
  logger: MismatchLogger,
  args: AmountMismatchArtifactArgs,
): Promise<void> {
  const { reference, amountNaira, rawStatus, gateway, lane } = args;
  const metadata = args.metadata ?? {};
  const propertyId = metadata.property_id as string | undefined;

  if (!propertyId) {
    // Rare: metadata was absent AND hydration failed. Keep the full detail in
    // the retained error log so the money is still traceable.
    logger.error(
      `RECONCILE: ${lane} ${reference} — ${gateway} reports ${rawStatus} with ₦${amountNaira.toLocaleString()} received, but there is no property_id to attach an ops row to. Recorded in logs only.`,
    );
    return;
  }

  try {
    const existing = await repo.find({
      where: { property_id: propertyId, event_type: AMOUNT_MISMATCH_EVENT },
    });
    if (
      existing.some(
        (h) => (h.metadata as { reference?: string })?.reference === reference,
      )
    ) {
      return; // already recorded for this reference
    }

    const expectedClause =
      args.expectedNaira != null
        ? ` against ₦${args.expectedNaira.toLocaleString()} expected`
        : '';

    await repo.save(
      repo.create({
        property_id: propertyId,
        tenant_id: (metadata.tenant_id as string) ?? null,
        event_type: AMOUNT_MISMATCH_EVENT,
        event_description:
          `Payment gateway reports ₦${amountNaira.toLocaleString()} received on reference ${reference} (${rawStatus})${expectedClause}. ` +
          `This is NOT a completed payment and has NOT been credited — the funds are held at the gateway. Verify on the gateway dashboard and reconcile or refund manually.`,
        related_entity_id: args.relatedEntityId ?? null,
        related_entity_type: args.relatedEntityType ?? null,
        metadata: {
          reference,
          amount: amountNaira,
          expected: args.expectedNaira ?? null,
          raw_status: rawStatus,
          gateway,
        },
      }),
    );
    logger.error(
      `RECONCILE: ${lane} ${reference} — ${gateway} reports ${rawStatus} with ₦${amountNaira.toLocaleString()} received. Ops artifact written to property ${propertyId}.`,
    );
  } catch (err) {
    logger.error(
      `Failed to record amount-mismatch artifact for ${reference}: ${(err as Error).message}`,
    );
  }
}
