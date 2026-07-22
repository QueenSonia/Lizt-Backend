import { PropertyHistory } from './entities/property-history.entity';
import {
  OfferLetter,
  OfferLetterStatus,
} from 'src/offer-letters/entities/offer-letter.entity';
import { Payment } from 'src/payments/entities/payment.entity';
import { MaintenanceRequest } from 'src/maintenance-requests/entities/maintenance-request.entity';
import { offerLetterToFees, sumAll } from 'src/common/billing/fees';
import {
  PAYMENT_HISTORY_EVENT_TYPES,
  resolveHistoryAmount,
  withAmountInTitle,
} from './history-amount.util';
import {
  HistoryCategory,
  categoryForEventType,
} from './history-category.util';

export interface TimelineEvent {
  id: string;
  type:
    | 'payment'
    | 'maintenance'
    | 'notice'
    | 'general'
    | 'offer_letter'
    | 'invoice'
    | 'receipt';
  /**
   * Filter category (badge + activity filter on the person timeline).
   * Derived from the source row's event_type; merged rows that have no
   * property_histories record get a fixed category per source table.
   */
  category?: HistoryCategory;
  title: string;
  description: string;
  date: string;
  time: string;
  details?: string;
  /**
   * Serialized JSON payload for event types whose detail modal needs
   * structured data (user-added tenancy/payment/fee). The timeline row
   * never renders this — only `title`, `details`, and (for maintenance)
   * `description` are shown to the user.
   */
  metadata?: string;
  /**
   * Optional muted second line rendered under the title row (e.g. property
   * name + address for a payment-plan installment payment). Distinct from
   * `description`, which the timeline only renders for maintenance events.
   */
  secondaryText?: string;
  offerLetterData?: {
    id: string;
    token: string;
    propertyName: string;
    propertyId: string;
    rentAmount: number;
    rentFrequency: string;
    serviceCharge: number;
    cautionDeposit: number;
    legalFee: number;
    agencyFee: number;
    totalAmount: number;
    tenancyStartDate: Date;
    tenancyEndDate: Date;
    status: string;
    paymentStatus: string;
    amountPaid: number;
    outstandingBalance: number;
    creditBalance: number;
    acceptedAt?: Date;
    acceptanceOtp?: string;
    acceptedByPhone?: string;
  };
  receiptData?: {
    id: string;
    propertyName: string;
    propertyId?: string;
    amountPaid: number;
    paymentMethod: string | null;
    reference: string;
    paidAt?: string;
    isPartPayment: boolean;
  };
  amount?: string | null;
  relatedEntityId?: string;
  relatedEntityType?: string;
  tenancyData?: {
    tenantName: string;
    propertyName: string;
    rentStartDate: Date;
    rentAmount: number | null;
    rentFrequency: string | null;
    nextDueDate: string | null;
  };
  amendmentData?: {
    propertyName: string;
    changes: string[];
  };
}

export interface BuildTimelineContext {
  propertyHistories: PropertyHistory[];
  maintenanceRequests?: MaintenanceRequest[];
  offerLetters?: OfferLetter[];
  payments?: Payment[];
  tenantName?: string;
}

const formatTime = (d: Date): string =>
  d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

const formatLongDate = (d: Date): string =>
  d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

export interface RentPeriodAmendedMetadata {
  before?: {
    rent_start_date?: string | Date | null;
    expiry_date?: string | Date | null;
    payment_frequency?: string | null;
    rental_price?: number | null;
  };
  after?: {
    rent_start_date?: string | Date | null;
    expiry_date?: string | Date | null;
    payment_frequency?: string | null;
    rental_price?: number | null;
  };
  recurring_changes?: {
    label: string;
    before: boolean;
    after: boolean;
  }[];
  fee_changes?: {
    kind: string;
    externalId?: string;
    label: string;
    change: 'added' | 'removed' | 'amount';
    before: number;
    after: number;
  }[];
}

/**
 * Human-readable change list for a rent_period_amended row's metadata
 * (e.g. "expiry April 30, 2026 → April 30, 2027"). Shared by the tenant
 * and property timelines so both describe an amendment identically.
 * Returns [] for legacy rows written before the metadata shape existed.
 */
export function rentPeriodAmendedChangeParts(
  meta: RentPeriodAmendedMetadata,
): string[] {
  const parts: string[] = [];
  const b = meta.before;
  const a = meta.after;
  if (b && a) {
    const fmt = (d: string | Date | null | undefined) =>
      d ? formatLongDate(new Date(d)) : '—';
    if (fmt(b.rent_start_date) !== fmt(a.rent_start_date)) {
      parts.push(`start ${fmt(b.rent_start_date)} → ${fmt(a.rent_start_date)}`);
    }
    if (fmt(b.expiry_date) !== fmt(a.expiry_date)) {
      parts.push(`expiry ${fmt(b.expiry_date)} → ${fmt(a.expiry_date)}`);
    }
    if ((b.payment_frequency ?? null) !== (a.payment_frequency ?? null)) {
      parts.push(
        `frequency ${b.payment_frequency ?? '—'} → ${a.payment_frequency ?? '—'}`,
      );
    }
    if (Number(b.rental_price ?? 0) !== Number(a.rental_price ?? 0)) {
      parts.push(
        `rent ₦${Number(b.rental_price ?? 0).toLocaleString()} → ₦${Number(a.rental_price ?? 0).toLocaleString()}`,
      );
    }
  }
  if (Array.isArray(meta.fee_changes) && meta.fee_changes.length > 0) {
    for (const fc of meta.fee_changes) {
      if (fc.change === 'added') {
        parts.push(
          `${fc.label} added (₦${Number(fc.after ?? 0).toLocaleString()})`,
        );
      } else if (fc.change === 'removed') {
        parts.push(`${fc.label} removed`);
      } else {
        parts.push(
          `${fc.label} ₦${Number(fc.before ?? 0).toLocaleString()} → ₦${Number(fc.after ?? 0).toLocaleString()}`,
        );
      }
    }
  }
  if (
    Array.isArray(meta.recurring_changes) &&
    meta.recurring_changes.length > 0
  ) {
    const madeRecurring = meta.recurring_changes
      .filter((c) => c.after)
      .map((c) => c.label);
    const madeOneTime = meta.recurring_changes
      .filter((c) => !c.after)
      .map((c) => c.label);
    if (madeRecurring.length > 0) {
      parts.push(`${madeRecurring.join(', ')} made recurring`);
    }
    if (madeOneTime.length > 0) {
      parts.push(`${madeOneTime.join(', ')} made one-time`);
    }
  }
  return parts;
}

/**
 * Build a chronologically-sorted, de-duplicated TimelineEvent[] from the
 * property_histories table plus related offer letters, payments and service
 * requests. Used by both the tenant detail endpoint and the KYC application
 * timeline endpoint so the two views are visually identical and seamlessly
 * continuous across the applicant→tenant transition.
 */
export function buildTimelineEvents(
  ctx: BuildTimelineContext,
): TimelineEvent[] {
  const {
    propertyHistories,
    maintenanceRequests = [],
    offerLetters = [],
    payments = [],
    tenantName = 'Tenant',
  } = ctx;

  const tenancyEvents: TimelineEvent[] = [];

  // Payment-shaped history rows carry no amount column; the exact figure lives
  // on the linked payments row where there is one. Index it once so every row
  // below can resolve its amount without another pass over `payments`.
  const paymentAmountsById = new Map<string, number>(
    payments.map((p) => [p.id, Number(p.amount)]),
  );

  if (propertyHistories && propertyHistories.length > 0) {
    propertyHistories.forEach((ph) => {
      // Everything this row pushes gets the row's category stamped on it at
      // the end of the iteration (single insertion point instead of ~30).
      const eventCountBefore = tenancyEvents.length;
      // Amount to append to this row's title, when it moved money at all.
      const rowAmount = PAYMENT_HISTORY_EVENT_TYPES.has(ph.event_type)
        ? resolveHistoryAmount(ph, paymentAmountsById)
        : null;

      if (ph.event_type === 'tenancy_started') {
        const prop = ph.property;
        const moveInDate = ph.move_in_date
          ? formatLongDate(new Date(ph.move_in_date))
          : 'an unspecified date';

        const rentAmount = ph.monthly_rent
          ? ` — Rent: ₦${Number(ph.monthly_rent).toLocaleString()}`
          : '';

        const attachedDate = new Date(
          ph.created_at || ph.move_in_date || new Date(),
        );

        // Parse frequency/next-due once — used by both the "Tenant attached"
        // and "Tenancy started" events so their snapshots match.
        const ownerComment = ph.owner_comment || '';
        const frequencyMatch = ownerComment.match(/Frequency:\s*([^,]+)/);
        const nextDueMatch = ownerComment.match(/Next due:\s*(.+)$/);
        const rentFrequency = frequencyMatch ? frequencyMatch[1].trim() : null;
        const nextDueDate = nextDueMatch ? nextDueMatch[1].trim() : null;
        const tenancyDataSnapshot = {
          tenantName,
          propertyName: prop?.name || '',
          rentStartDate: ph.move_in_date as unknown as Date,
          rentAmount: ph.monthly_rent ?? null,
          rentFrequency,
          nextDueDate,
        };

        tenancyEvents.push({
          id: `tenancy-start-${ph.id}`,
          type: 'general',
          title: 'Tenant attached',
          description: `Attached to ${prop?.name || 'property'} on ${moveInDate}${rentAmount}.`,
          details: prop?.name || undefined,
          date: attachedDate.toISOString(),
          time: formatTime(attachedDate),
          tenancyData: tenancyDataSnapshot,
        });

        if (ph.move_in_date) {
          const tenancyStartDate = new Date(ph.move_in_date);

          tenancyEvents.push({
            id: `tenancy-started-${ph.id}`,
            type: 'general',
            title: 'Tenancy started',
            description: `Tenancy at ${prop?.name || 'property'} began on ${moveInDate}${rentAmount}.`,
            details: prop?.name || undefined,
            date: tenancyStartDate.toISOString(),
            time: formatTime(tenancyStartDate),
            tenancyData: tenancyDataSnapshot,
          });
        }
      }

      if (ph.event_type === 'outstanding_balance_recorded') {
        const prop = ph.property;
        let amount = 0;
        let reason: string | null = null;
        try {
          const parsed = JSON.parse(ph.event_description || '{}');
          amount = parsed.amount || 0;
          reason = parsed.reason || null;
        } catch {
          // ignore parse failure
        }
        const eventDate = new Date(ph.created_at || new Date());
        tenancyEvents.push({
          id: `outstanding-balance-${ph.id}`,
          type: 'general',
          title: 'Outstanding balance recorded',
          description: `Outstanding balance recorded — ${prop?.name || 'property'} — ₦${amount.toLocaleString()}`,
          details: reason || undefined,
          date: eventDate.toISOString(),
          time: formatTime(eventDate),
          relatedEntityId: ph.related_entity_id || undefined,
          relatedEntityType: 'outstanding_balance',
        });
      }

      if (ph.event_type === 'rent_period_amended') {
        const prop = ph.property;
        const eventDate = new Date(ph.created_at || new Date());
        // Prefer a rich description built from before/after metadata (which
        // captures rental_price too). Fall back to the stored
        // event_description (which only covers dates + frequency) for rows
        // written before the metadata shape was finalized.
        const parts = rentPeriodAmendedChangeParts(
          (ph.metadata ?? {}) as RentPeriodAmendedMetadata,
        );
        const description = parts.length
          ? `Tenancy amended: ${parts.join('; ')}`
          : ph.event_description || 'Tenancy amended.';
        tenancyEvents.push({
          id: `tenancy-amended-${ph.id}`,
          type: 'general',
          title: 'Tenancy amended',
          description,
          details: prop?.name || undefined,
          date: eventDate.toISOString(),
          time: formatTime(eventDate),
          amendmentData: {
            propertyName: prop?.name || '',
            changes: parts,
          },
        });
      }

      if (ph.event_type === 'tenancy_ended') {
        const prop = ph.property;
        const who = ph.metadata?.tenant_name || tenantName;
        const moveOutDate = ph.move_out_date
          ? formatLongDate(new Date(ph.move_out_date))
          : 'an unspecified date';

        const eventDate = new Date(
          ph.created_at || ph.move_out_date || new Date(),
        );
        tenancyEvents.push({
          id: `tenancy-end-${ph.id}`,
          type: 'general',
          title: 'Tenancy Ended',
          description: `${who} moved out of ${prop?.name || 'property'} on ${moveOutDate}.`,
          details: ph.move_out_reason
            ? `Reason: ${ph.move_out_reason.replace(/_/g, ' ')}`
            : prop?.name || undefined,
          date: eventDate.toISOString(),
          time: formatTime(eventDate),
        });
      }

      if (ph.event_type === 'renewal_deactivated') {
        const who = ph.metadata?.tenant_name || tenantName;
        const eventDate = new Date(ph.created_at || new Date());
        tenancyEvents.push({
          id: `renewal-deactivated-${ph.id}`,
          type: 'general',
          title: 'Renewal deactivated',
          description:
            ph.event_description || `Renewal deactivated for ${who}.`,
          details: ph.metadata?.end_date
            ? `Tenancy ends ${ph.metadata.end_date}`
            : undefined,
          date: eventDate.toISOString(),
          time: formatTime(eventDate),
        });
      }

      if (ph.event_type === 'removal_scheduled') {
        const who = ph.metadata?.tenant_name || tenantName;
        const eventDate = new Date(ph.created_at || new Date());
        tenancyEvents.push({
          id: `removal-scheduled-${ph.id}`,
          type: 'general',
          title: 'Removal scheduled',
          description:
            ph.event_description || `${who}'s tenancy is scheduled to end.`,
          details: ph.move_out_reason
            ? `Reason: ${ph.move_out_reason.replace(/_/g, ' ')}`
            : ph.metadata?.end_date
              ? `Ends ${ph.metadata.end_date}`
              : undefined,
          date: eventDate.toISOString(),
          time: formatTime(eventDate),
        });
      }

      if (ph.event_type === 'scheduled_end_cancelled') {
        const who = ph.metadata?.tenant_name || tenantName;
        const isLapse = ph.metadata?.kind === 'lapse';
        const eventDate = new Date(ph.created_at || new Date());
        tenancyEvents.push({
          id: `scheduled-end-cancelled-${ph.id}`,
          type: 'general',
          title: isLapse
            ? 'Renewal reactivated'
            : 'Scheduled removal cancelled',
          description:
            ph.event_description ||
            (isLapse
              ? `Renewal reactivated for ${who}.`
              : `Scheduled removal cancelled for ${who}.`),
          date: eventDate.toISOString(),
          time: formatTime(eventDate),
        });
      }

      if (ph.event_type === 'kyc_application_submitted') {
        const prop = ph.property;
        const eventDate = new Date(ph.created_at || new Date());
        tenancyEvents.push({
          id: `kyc-submitted-${ph.id}`,
          type: 'general',
          title: 'KYC Application Submitted',
          description: `KYC application submitted for ${prop?.name || 'property'}.`,
          details: prop?.name || undefined,
          date: eventDate.toISOString(),
          time: formatTime(eventDate),
          relatedEntityId: ph.related_entity_id || undefined,
          relatedEntityType: 'kyc_application',
        });
      }

      if (ph.event_type === 'maintenance_request_created') {
        const prop = ph.property;
        const issueDescription = ph.event_description || 'Maintenance Request';
        const eventDate = new Date(ph.created_at || new Date());
        tenancyEvents.push({
          id: `service-created-${ph.id}`,
          type: 'maintenance',
          title: 'Maintenance Request Created',
          description: `Issue: "${issueDescription}" — Status: pending`,
          details: prop?.name || undefined,
          date: eventDate.toISOString(),
          time: formatTime(eventDate),
          relatedEntityId: ph.related_entity_id || undefined,
          relatedEntityType: 'maintenance_request',
        });
      }

      if (ph.event_type === 'maintenance_request_updated') {
        let status = 'updated';
        let previousStatus = '';
        let issueDescription = 'Maintenance Request';

        if (ph.event_description) {
          try {
            const parsed = JSON.parse(ph.event_description);
            status = parsed.status || 'updated';
            previousStatus = parsed.previous_status || '';
            issueDescription = parsed.description || 'Maintenance Request';
          } catch {
            const parts = ph.event_description.split('|||');
            status = parts[0] || 'updated';
            issueDescription = parts[1] || 'Maintenance Request';
          }
        }

        const prop = ph.property;
        const statusChanged = !!previousStatus && previousStatus !== status;

        let title: string;
        let descriptionTail: string;

        if (statusChanged) {
          if (status.toLowerCase() === 'resolved') {
            title = 'Maintenance Request Resolved';
          } else if (status.toLowerCase() === 'closed') {
            title = 'Maintenance Request Closed';
          } else if (status.toLowerCase() === 'reopened') {
            title = 'Maintenance Request Reopened';
          } else if (status.toLowerCase() === 'approved') {
            title = 'Maintenance Request Approved';
          } else if (status.toLowerCase() === 'not_approved') {
            title = 'Maintenance Request Opened';
          } else {
            const statusLabel =
              status.charAt(0).toUpperCase() + status.slice(1);
            title = `Maintenance Request ${statusLabel}`;
          }
          descriptionTail = `Status: ${previousStatus} → ${status}`;
        } else {
          title = 'Maintenance Request Updated';
          descriptionTail = 'Request details updated';
        }

        const eventDate = new Date(ph.created_at || new Date());
        tenancyEvents.push({
          id: `service-update-${ph.id}`,
          type: 'maintenance',
          title,
          description: `Issue: "${issueDescription}" — ${descriptionTail}`,
          details: prop?.name || undefined,
          date: eventDate.toISOString(),
          time: formatTime(eventDate),
          relatedEntityId: ph.related_entity_id || undefined,
          relatedEntityType: 'maintenance_request',
        });
      }

      if (ph.event_type === 'kyc_application_approved') {
        const prop = ph.property;
        const eventDate = new Date(ph.created_at || new Date());
        tenancyEvents.push({
          id: `kyc-approved-${ph.id}`,
          type: 'general',
          title: 'KYC Application Approved',
          description:
            ph.event_description ||
            `KYC application approved for ${prop?.name || 'property'}.`,
          details: prop?.name || undefined,
          date: eventDate.toISOString(),
          time: formatTime(eventDate),
          relatedEntityId: ph.related_entity_id || undefined,
          relatedEntityType: 'kyc_application',
        });
      }

      if (ph.event_type === 'kyc_application_rejected') {
        const prop = ph.property;
        const eventDate = new Date(ph.created_at || new Date());
        tenancyEvents.push({
          id: `kyc-rejected-${ph.id}`,
          type: 'general',
          title: 'KYC Application Rejected',
          description:
            ph.event_description ||
            `KYC application rejected for ${prop?.name || 'property'}.`,
          details: prop?.name || undefined,
          date: eventDate.toISOString(),
          time: formatTime(eventDate),
          relatedEntityId: ph.related_entity_id || undefined,
          relatedEntityType: 'kyc_application',
        });
      }

      if (
        ph.event_type === 'offer_letter_sent' ||
        ph.event_type === 'offer_letter_saved' ||
        ph.event_type === 'offer_letter_accepted' ||
        ph.event_type === 'offer_letter_rejected' ||
        ph.event_type === 'offer_letter_viewed'
      ) {
        const prop = ph.property;
        const eventDate = new Date(ph.created_at || new Date());
        const titleMap: Record<string, string> = {
          offer_letter_sent: 'Offer Letter Sent',
          offer_letter_saved: 'Offer Letter Saved',
          offer_letter_accepted: 'Offer Letter Accepted',
          offer_letter_rejected: 'Offer Letter Rejected',
          offer_letter_viewed: 'Offer Letter Viewed',
        };
        tenancyEvents.push({
          id: `${ph.event_type}-${ph.id}`,
          type: 'offer_letter',
          title: titleMap[ph.event_type] || 'Offer Letter',
          description:
            ph.event_description ||
            `${titleMap[ph.event_type]} for ${prop?.name || 'property'}.`,
          details: prop?.name || undefined,
          date: eventDate.toISOString(),
          time: formatTime(eventDate),
          relatedEntityId: ph.related_entity_id || undefined,
          relatedEntityType: 'offer_letter',
        });
      }

      if (
        ph.event_type === 'invoice_generated' ||
        ph.event_type === 'invoice_sent' ||
        ph.event_type === 'invoice_viewed'
      ) {
        const prop = ph.property;
        const eventDate = new Date(ph.created_at || new Date());
        const titleMap: Record<string, string> = {
          invoice_generated: 'Invoice Generated',
          invoice_sent: 'Invoice Sent',
          invoice_viewed: 'Invoice Viewed',
        };
        tenancyEvents.push({
          id: `${ph.event_type}-${ph.id}`,
          type: 'invoice',
          title: titleMap[ph.event_type] || 'Invoice',
          description:
            ph.event_description ||
            `${titleMap[ph.event_type]} for ${prop?.name || 'property'}.`,
          details: prop?.name || undefined,
          date: eventDate.toISOString(),
          time: formatTime(eventDate),
          relatedEntityId: ph.related_entity_id || undefined,
          relatedEntityType: ph.related_entity_type || undefined,
        });
      }

      if (
        ph.event_type === 'ad_hoc_invoice_created' ||
        ph.event_type === 'ad_hoc_invoice_paid' ||
        ph.event_type === 'ad_hoc_invoice_cancelled'
      ) {
        const prop = ph.property;
        const eventDate = new Date(ph.created_at || new Date());
        const titleMap: Record<string, string> = {
          ad_hoc_invoice_created: 'Invoice Generated',
          ad_hoc_invoice_paid: 'Invoice Paid',
          ad_hoc_invoice_cancelled: 'Invoice Cancelled',
        };
        tenancyEvents.push({
          id: `${ph.event_type}-${ph.id}`,
          type: ph.event_type === 'ad_hoc_invoice_paid' ? 'receipt' : 'invoice',
          title: withAmountInTitle(titleMap[ph.event_type], rowAmount),
          description:
            ph.event_description ||
            `${titleMap[ph.event_type]} for ${prop?.name || 'property'}.`,
          details: prop?.name || undefined,
          date: eventDate.toISOString(),
          time: formatTime(eventDate),
          relatedEntityId: ph.related_entity_id || undefined,
          relatedEntityType: 'ad_hoc_invoice',
        });
      }

      if (
        ph.event_type === 'receipt_issued' ||
        ph.event_type === 'receipt_sent' ||
        ph.event_type === 'receipt_viewed'
      ) {
        const prop = ph.property;
        const eventDate = new Date(ph.created_at || new Date());
        const titleMap: Record<string, string> = {
          receipt_issued: 'Receipt Issued',
          receipt_sent: 'Receipt Sent',
          receipt_viewed: 'Receipt Viewed',
        };
        tenancyEvents.push({
          id: `${ph.event_type}-${ph.id}`,
          type: 'receipt',
          title: titleMap[ph.event_type] || 'Receipt',
          description:
            ph.event_description ||
            `${titleMap[ph.event_type]} for ${prop?.name || 'property'}.`,
          details: prop?.name || undefined,
          date: eventDate.toISOString(),
          time: formatTime(eventDate),
          relatedEntityId: ph.related_entity_id || undefined,
          relatedEntityType: ph.related_entity_type || undefined,
        });
      }

      if (
        ph.event_type === 'payment_initiated' ||
        ph.event_type === 'payment_cancelled' ||
        ph.event_type === 'payment_completed_full' ||
        ph.event_type === 'payment_completed_partial'
      ) {
        const prop = ph.property;
        const eventDate = new Date(ph.created_at || new Date());
        const titleMap: Record<string, string> = {
          payment_initiated: 'Payment Initiated',
          payment_cancelled: 'Payment Cancelled',
          payment_completed_full: 'Full Payment Received',
          payment_completed_partial: 'Partial Payment Received',
        };

        const isPaymentInitiated =
          ph.event_type === 'payment_initiated' ||
          ph.event_type === 'payment_cancelled';
        tenancyEvents.push({
          id: `${ph.event_type}-${ph.id}`,
          type: isPaymentInitiated ? 'invoice' : 'receipt',
          title: withAmountInTitle(
            titleMap[ph.event_type] || 'Payment',
            rowAmount,
          ),
          description:
            ph.event_description ||
            `${titleMap[ph.event_type]} for ${prop?.name || 'property'}.`,
          details: prop?.name || undefined,
          date: eventDate.toISOString(),
          time: formatTime(eventDate),
          relatedEntityId: ph.related_entity_id || undefined,
          relatedEntityType: ph.related_entity_type || undefined,
        });
      }

      if (
        ph.event_type === 'payment_plan_request_submitted' ||
        ph.event_type === 'payment_plan_request_approved' ||
        ph.event_type === 'payment_plan_request_declined'
      ) {
        const prop = ph.property;
        const eventDate = new Date(ph.created_at || new Date());
        const titleMap: Record<string, string> = {
          payment_plan_request_submitted: 'Payment Plan Requested',
          payment_plan_request_approved: 'Payment Plan Request Approved',
          payment_plan_request_declined: 'Payment Plan Request Declined',
        };
        tenancyEvents.push({
          id: `${ph.event_type}-${ph.id}`,
          type: 'general',
          title: titleMap[ph.event_type],
          description:
            ph.event_description ||
            `${titleMap[ph.event_type]} for ${prop?.name || 'property'}.`,
          details: prop?.name || undefined,
          date: eventDate.toISOString(),
          time: formatTime(eventDate),
          relatedEntityId: ph.related_entity_id || undefined,
          relatedEntityType: 'payment_plan_request',
        });
      }

      if (ph.event_type === 'payment_plan_installment_paid') {
        const prop = ph.property;
        // event_description is already a human-readable line written by
        // logPlanEvent, e.g. "Installment 1 paid — ₦3,531,250 (paystack)" (or
        // "Partial plan payoff — <charge> — ₦X" for a bulk early payoff). Use
        // it verbatim as the title; the property + address go on their own
        // muted line. These rows carry no move_in_date, so anchor on created_at
        // (the row is written at payment time).
        const eventDate = new Date(ph.created_at || new Date());
        const propertyLine = prop?.name
          ? `${prop.name}${prop.location ? ` at ${prop.location}` : ''}`
          : undefined;
        // Per-installment rows carry the receipt token in metadata so the
        // frontend can deep-link to the installment receipt page (view + PDF).
        // Bulk-payoff rows have no token.
        const receiptToken =
          (ph.metadata as { receiptToken?: string } | null)?.receiptToken ||
          null;
        tenancyEvents.push({
          id: `plan-installment-paid-${ph.id}`,
          type: 'payment',
          title: ph.event_description || 'Installment paid',
          description: propertyLine || '',
          secondaryText: propertyLine,
          metadata: JSON.stringify({
            receiptToken,
            installmentId: ph.related_entity_id || null,
          }),
          date: eventDate.toISOString(),
          time: formatTime(eventDate),
          relatedEntityId: ph.related_entity_id || undefined,
          relatedEntityType: ph.related_entity_type || undefined,
        });
      }

      if (ph.event_type === 'kyc_form_viewed') {
        const prop = ph.property;
        const eventDate = new Date(ph.created_at || new Date());
        tenancyEvents.push({
          id: `kyc-form-viewed-${ph.id}`,
          type: 'general',
          title: 'KYC Form Viewed',
          description:
            ph.event_description ||
            `KYC form viewed for ${prop?.name || 'property'}.`,
          details: prop?.name || undefined,
          date: eventDate.toISOString(),
          time: formatTime(eventDate),
          relatedEntityId: ph.related_entity_id || undefined,
          relatedEntityType: 'kyc_application',
        });
      }

      if (ph.event_type === 'renewal_link_sent') {
        const prop = ph.property;
        const eventDate = new Date(ph.created_at || new Date());
        tenancyEvents.push({
          id: `renewal-link-sent-${ph.id}`,
          type: 'general',
          title: 'Renewal Link Sent',
          description:
            ph.event_description ||
            `Tenancy renewal link sent for ${prop?.name || 'property'}.`,
          details: prop?.name || undefined,
          date: eventDate.toISOString(),
          time: formatTime(eventDate),
          relatedEntityId: ph.related_entity_id || undefined,
          relatedEntityType: 'renewal_invoice',
        });
      }

      if (ph.event_type === 'renewal_letter_sent') {
        const prop = ph.property;
        const eventDate = new Date(ph.created_at || new Date());
        tenancyEvents.push({
          id: `renewal-letter-sent-${ph.id}`,
          type: 'general',
          title: 'Renewal Letter Sent',
          description:
            ph.event_description ||
            `Tenancy renewal letter sent for ${prop?.name || 'property'}.`,
          details: prop?.name || undefined,
          date: eventDate.toISOString(),
          time: formatTime(eventDate),
          relatedEntityId: ph.related_entity_id || undefined,
          relatedEntityType: 'renewal_invoice',
        });
      }

      if (ph.event_type === 'renewal_letter_accepted') {
        const prop = ph.property;
        const eventDate = new Date(ph.created_at || new Date());
        tenancyEvents.push({
          id: `renewal-letter-accepted-${ph.id}`,
          type: 'general',
          title: 'Renewal Letter Accepted',
          description:
            ph.event_description ||
            `Renewal letter accepted for ${prop?.name || 'property'}.`,
          details: prop?.name || undefined,
          date: eventDate.toISOString(),
          time: formatTime(eventDate),
          relatedEntityId: ph.related_entity_id || undefined,
          relatedEntityType: 'renewal_invoice',
        });
      }

      if (ph.event_type === 'renewal_letter_declined') {
        const prop = ph.property;
        const eventDate = new Date(ph.created_at || new Date());
        tenancyEvents.push({
          id: `renewal-letter-declined-${ph.id}`,
          type: 'general',
          title: 'Renewal Letter Declined',
          description:
            ph.event_description ||
            `Renewal letter declined for ${prop?.name || 'property'}.`,
          details: prop?.name || undefined,
          date: eventDate.toISOString(),
          time: formatTime(eventDate),
          relatedEntityId: ph.related_entity_id || undefined,
          relatedEntityType: 'renewal_invoice',
        });
      }

      if (ph.event_type === 'renewal_period_started') {
        const prop = ph.property;
        // Anchor on move_in_date (the period's start) so the event lands on
        // the day the new tenancy period begins, not the cron run timestamp.
        const eventDate = new Date(
          ph.move_in_date || ph.created_at || new Date(),
        );
        const startLabel = ph.move_in_date
          ? formatLongDate(new Date(ph.move_in_date))
          : null;
        const endLabel = ph.move_out_date
          ? formatLongDate(new Date(ph.move_out_date))
          : null;
        const periodText =
          startLabel && endLabel ? ` (${startLabel} – ${endLabel})` : '';
        const rentText = ph.monthly_rent
          ? ` — Rent: ₦${Number(ph.monthly_rent).toLocaleString()}`
          : '';
        tenancyEvents.push({
          id: `renewal-period-started-${ph.id}`,
          type: 'general',
          title: 'Renewal Period Started',
          description: `New tenancy period started for ${prop?.name || 'property'}${periodText}${rentText}.`,
          details: prop?.name || undefined,
          date: eventDate.toISOString(),
          time: formatTime(eventDate),
          relatedEntityId: ph.related_entity_id || undefined,
          relatedEntityType: ph.related_entity_type || undefined,
        });
      }

      if (ph.event_type === 'renewal_payment_made') {
        const prop = ph.property;
        const eventDate = new Date(ph.created_at || new Date());
        tenancyEvents.push({
          id: `renewal-payment-made-${ph.id}`,
          type: 'payment',
          title: withAmountInTitle('Renewal Payment Made', rowAmount),
          description:
            ph.event_description ||
            `Payment made for tenancy renewal for property ${prop?.name || 'property'}.`,
          details: prop?.name || undefined,
          date: eventDate.toISOString(),
          time: formatTime(eventDate),
          relatedEntityId: ph.related_entity_id || undefined,
          relatedEntityType: 'renewal_invoice',
        });
      }

      if (ph.event_type === 'renewal_payment_initiated') {
        const prop = ph.property;
        const eventDate = new Date(ph.created_at || new Date());
        tenancyEvents.push({
          id: `renewal-payment-initiated-${ph.id}`,
          type: 'payment',
          title: withAmountInTitle('Renewal Payment Initiated', rowAmount),
          description:
            ph.event_description ||
            `Renewal payment initiated for ${prop?.name || 'property'}.`,
          details: prop?.name || undefined,
          date: eventDate.toISOString(),
          time: formatTime(eventDate),
          relatedEntityId: ph.related_entity_id || undefined,
          relatedEntityType: 'renewal_invoice',
        });
      }

      if (ph.event_type === 'renewal_payment_cancelled') {
        const prop = ph.property;
        const eventDate = new Date(ph.created_at || new Date());
        tenancyEvents.push({
          id: `renewal-payment-cancelled-${ph.id}`,
          type: 'payment',
          title: withAmountInTitle('Renewal Payment Cancelled', rowAmount),
          description:
            ph.event_description ||
            `Renewal payment cancelled for ${prop?.name || 'property'}.`,
          details: prop?.name || undefined,
          date: eventDate.toISOString(),
          time: formatTime(eventDate),
          relatedEntityId: ph.related_entity_id || undefined,
          relatedEntityType: 'renewal_invoice',
        });
      }

      if (ph.event_type === 'user_added_history') {
        const prop = ph.property;
        let parsedData: any = {};
        try {
          parsedData = JSON.parse(ph.event_description || '{}');
        } catch {
          parsedData = {
            displayType: 'Custom Event',
            description: ph.event_description || '',
          };
        }
        const eventDate = new Date(
          ph.move_in_date || ph.created_at || new Date(),
        );
        const customAmount = Number(parsedData.amount) || 0;
        tenancyEvents.push({
          id: `user-added-${ph.id}`,
          type: 'general',
          title: withAmountInTitle(
            `${parsedData.displayType || 'Custom Event'} — ${prop?.name || 'property'} — ${parsedData.description || ''}`,
            customAmount || null,
          ),
          description: parsedData.description || '',
          details: prop?.name || undefined,
          date: eventDate.toISOString(),
          time: formatTime(eventDate),
          amount: parsedData.amount || null,
        });
      }

      if (ph.event_type === 'user_added_tenancy') {
        const prop = ph.property;
        let parsedData: any = {};
        try {
          parsedData = JSON.parse(ph.event_description || '{}');
        } catch {
          parsedData = {};
        }
        const startDate = ph.move_in_date
          ? new Date(ph.move_in_date).toLocaleDateString('en-GB')
          : '';
        const endDate = ph.move_out_date
          ? new Date(ph.move_out_date).toLocaleDateString('en-GB')
          : '';
        const eventDate = new Date(
          ph.move_in_date || ph.created_at || new Date(),
        );
        tenancyEvents.push({
          id: `user-added-tenancy-${ph.id}`,
          type: 'general',
          title: `Tenancy started`,
          description: `Tenancy period: ${startDate} – ${endDate}`,
          details: prop?.name || undefined,
          metadata: JSON.stringify({
            rentAmount: parsedData.rentAmount || 0,
            serviceCharge: parsedData.serviceChargeAmount || 0,
            otherFees: parsedData.otherFees || [],
            totalAmount: parsedData.totalAmount || 0,
            startDate,
            endDate,
            rawMoveInDate: ph.move_in_date
              ? new Date(ph.move_in_date).toISOString()
              : null,
            rawMoveOutDate: ph.move_out_date
              ? new Date(ph.move_out_date).toISOString()
              : null,
            propertyId: ph.property_id,
            propertyName: prop?.name || '',
            tenantName: parsedData.tenantName || '',
          }),
          date: eventDate.toISOString(),
          time: formatTime(eventDate),
          amount: parsedData.totalAmount
            ? String(parsedData.totalAmount)
            : null,
        });
      }

      if (ph.event_type === 'user_added_payment') {
        const prop = ph.property;
        let parsedData: any = {};
        try {
          parsedData = JSON.parse(ph.event_description || '{}');
        } catch {
          parsedData = {};
        }
        const paymentDate = parsedData.paymentDate
          ? new Date(parsedData.paymentDate).toLocaleDateString('en-GB')
          : ph.move_in_date
            ? new Date(ph.move_in_date).toLocaleDateString('en-GB')
            : '';
        const eventDate = new Date(
          parsedData.paymentDate ||
            ph.move_in_date ||
            ph.created_at ||
            new Date(),
        );
        // The amount lives in the JSON body, not labelled prose, so put it in
        // the title here (the payment-amount post-pass only reads described
        // rows). Matches the "<label> — ₦X" shape used everywhere else.
        const paymentAmountNum = Number(parsedData.paymentAmount) || 0;
        tenancyEvents.push({
          id: `user-added-payment-${ph.id}`,
          type: 'general',
          title: withAmountInTitle(
            'Payment received',
            paymentAmountNum || null,
          ),
          description: `Payment of ₦${Number(parsedData.paymentAmount || 0).toLocaleString()}${parsedData.paymentDescription ? ` — ${parsedData.paymentDescription}` : ''} on ${paymentDate}`,
          details: prop?.name || undefined,
          metadata: JSON.stringify({
            paymentAmount: parsedData.paymentAmount || 0,
            paymentDescription: parsedData.paymentDescription || '',
            paymentDate,
            rawPaymentDate:
              parsedData.paymentDate ||
              (ph.move_in_date
                ? new Date(ph.move_in_date).toISOString()
                : null),
            propertyId: ph.property_id,
            propertyName: prop?.name || '',
            tenantName: parsedData.tenantName || '',
            // Lightweight receipt minted at create-time. NULL on
            // pre-feature legacy rows; the frontend hides the receipt
            // buttons in that case.
            receiptToken: ph.receipt_token || null,
            receiptNumber: ph.receipt_number || null,
          }),
          date: eventDate.toISOString(),
          time: formatTime(eventDate),
          amount: parsedData.paymentAmount
            ? String(parsedData.paymentAmount)
            : null,
        });
      }

      if (ph.event_type === 'user_added_fee') {
        const prop = ph.property;
        let parsedData: any = {};
        try {
          parsedData = JSON.parse(ph.event_description || '{}');
        } catch {
          parsedData = {};
        }
        const feeDate = parsedData.feeDate
          ? new Date(parsedData.feeDate).toLocaleDateString('en-GB')
          : ph.move_in_date
            ? new Date(ph.move_in_date).toLocaleDateString('en-GB')
            : '';
        const eventDate = new Date(
          parsedData.feeDate || ph.move_in_date || ph.created_at || new Date(),
        );
        tenancyEvents.push({
          id: `user-added-fee-${ph.id}`,
          type: 'general',
          title: `Fee added`,
          description: `Fee of ₦${Number(parsedData.feeAmount || 0).toLocaleString()}${parsedData.feeDescription ? ` — ${parsedData.feeDescription}` : ''}${feeDate ? ` on ${feeDate}` : ''}`,
          details: prop?.name || undefined,
          metadata: JSON.stringify({
            feeAmount: parsedData.feeAmount || 0,
            feeDescription: parsedData.feeDescription || '',
            feeDate,
            rawFeeDate:
              parsedData.feeDate ||
              (ph.move_in_date
                ? new Date(ph.move_in_date).toISOString()
                : null),
            propertyId: ph.property_id,
            propertyName: prop?.name || '',
            tenantName: parsedData.tenantName || '',
          }),
          date: eventDate.toISOString(),
          time: formatTime(eventDate),
          amount: parsedData.feeAmount ? String(parsedData.feeAmount) : null,
        });
      }

      const category = categoryForEventType(ph.event_type);
      for (let i = eventCountBefore; i < tenancyEvents.length; i++) {
        tenancyEvents[i].category = category;
      }
    });
  }

  // Add maintenance request events (only for SRs that don't already have a
  // maintenance_request_created property_history event, to avoid duplicates)
  const srIdsWithHistoryEvent = new Set(
    tenancyEvents
      .filter(
        (e) =>
          e.relatedEntityType === 'maintenance_request' &&
          e.id.startsWith('service-created-'),
      )
      .map((e) => e.relatedEntityId),
  );
  const maintenanceRequestEvents: TimelineEvent[] = maintenanceRequests
    .filter((sr) => !srIdsWithHistoryEvent.has(sr.id))
    .map((sr) => {
      const eventDate = new Date(sr.date_reported);
      const prop = sr.property;
      const issueTitle = sr.description || 'Maintenance Request';
      return {
        id: `service-${sr.id}`,
        type: 'maintenance',
        category: 'maintenance',
        title: 'Maintenance Request Created',
        description: `Issue: "${issueTitle}" — Status: ${sr.status || 'pending'}`,
        details: prop?.name || undefined,
        date: eventDate.toISOString(),
        time: formatTime(eventDate),
        relatedEntityId: sr.id,
        relatedEntityType: 'maintenance_request',
      };
    });

  // Add offer letter events
  const offerLetterEvents: TimelineEvent[] = offerLetters.map((offer) => {
    const eventDate = new Date(
      offer.updated_at || offer.created_at || new Date(),
    );
    // Billing v2: total = rent + service + caution + legal + agency +
    // every otherFee (recurring or one-time). Matches offer_letters.total_amount.
    const totalAmount = sumAll(offerLetterToFees(offer));

    let statusText = 'sent';
    let titleStatus = 'Sent';
    if (offer.status === OfferLetterStatus.ACCEPTED) {
      statusText = 'accepted';
      titleStatus = 'Accepted';
    } else if (offer.status === OfferLetterStatus.REJECTED) {
      statusText = 'declined';
      titleStatus = 'Declined';
    } else if (offer.status === OfferLetterStatus.SELECTED) {
      statusText = 'completed';
      titleStatus = 'Accepted';
    }

    const propertyName = offer.property?.name || 'property';
    const amountText = ` — ₦${totalAmount.toLocaleString()}`;

    return {
      id: `offer-${offer.id}`,
      type: 'offer_letter',
      category: 'tenancy',
      title: `Offer Letter ${titleStatus}`,
      description: `Offer letter ${statusText} for ${propertyName}${amountText}`,
      details: propertyName,
      date: eventDate.toISOString(),
      time: formatTime(eventDate),
      offerLetterData: {
        id: offer.id,
        token: offer.token,
        propertyName: offer.property?.name || 'Property',
        propertyId: offer.property_id,
        rentAmount: Number(offer.rent_amount || 0),
        rentFrequency: offer.rent_frequency,
        serviceCharge: Number(offer.service_charge || 0),
        cautionDeposit: Number(offer.caution_deposit || 0),
        legalFee: Number(offer.legal_fee || 0),
        agencyFee: Number(offer.agency_fee || 0),
        totalAmount,
        tenancyStartDate: offer.tenancy_start_date,
        tenancyEndDate: offer.tenancy_end_date,
        status: offer.status,
        paymentStatus: offer.payment_status,
        amountPaid: Number(offer.amount_paid || 0),
        outstandingBalance: Number(offer.outstanding_balance || 0),
        creditBalance: Number(offer.credit_balance || 0),
        acceptedAt: offer.accepted_at,
        acceptanceOtp: offer.acceptance_otp,
        acceptedByPhone: offer.accepted_by_phone,
      },
    };
  });

  // Add payment/receipt events
  const paymentEvents: TimelineEvent[] = payments.map((payment) => {
    const eventDate = new Date(payment.paid_at || payment.created_at);
    const isPartPayment = payment.payment_type === 'partial';
    const propertyName = payment.offerLetter?.property?.name || 'property';
    const amountFormatted = `₦${Number(payment.amount).toLocaleString()}`;

    return {
      id: `receipt-${payment.id}`,
      type: 'receipt',
      category: 'payments',
      title: isPartPayment ? 'Part Payment Received' : 'Payment Received',
      description: isPartPayment
        ? `Part payment of ${amountFormatted} received for ${propertyName}`
        : `Full payment of ${amountFormatted} received for ${propertyName}`,
      details: `${propertyName} — ${amountFormatted}`,
      date: eventDate.toISOString(),
      time: formatTime(eventDate),
      receiptData: {
        id: payment.id,
        propertyName,
        propertyId: payment.offerLetter?.property_id,
        amountPaid: Number(payment.amount),
        paymentMethod: payment.payment_method,
        reference: payment.gateway_reference,
        paidAt: payment.paid_at?.toISOString(),
        isPartPayment,
      },
    };
  });

  // Combine all events and sort by date (newest first), dedupe by id.
  const allEvents: TimelineEvent[] = [
    ...tenancyEvents,
    ...maintenanceRequestEvents,
    ...offerLetterEvents,
    ...paymentEvents,
  ];

  const seenIds = new Set<string>();
  return allEvents
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .filter((event) => {
      if (seenIds.has(event.id)) return false;
      seenIds.add(event.id);
      return true;
    });
}
