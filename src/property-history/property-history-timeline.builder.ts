import { PropertyHistory } from './entities/property-history.entity';
import {
  OfferLetter,
  OfferLetterStatus,
} from 'src/offer-letters/entities/offer-letter.entity';
import { Payment } from 'src/payments/entities/payment.entity';
import { ServiceRequest } from 'src/service-requests/entities/service-request.entity';
import { offerLetterToFees, sumAll } from 'src/common/billing/fees';

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
  serviceRequests?: ServiceRequest[];
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

/**
 * Build a chronologically-sorted, de-duplicated TimelineEvent[] from the
 * property_histories table plus related offer letters, payments and service
 * requests. Used by both the tenant detail endpoint and the KYC application
 * timeline endpoint so the two views are visually identical and seamlessly
 * continuous across the applicant→tenant transition.
 */
export function buildTimelineEvents(ctx: BuildTimelineContext): TimelineEvent[] {
  const {
    propertyHistories,
    serviceRequests = [],
    offerLetters = [],
    payments = [],
    tenantName = 'Tenant',
  } = ctx;

  const tenancyEvents: TimelineEvent[] = [];

  if (propertyHistories && propertyHistories.length > 0) {
    propertyHistories.forEach((ph) => {
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
        const rentFrequency = frequencyMatch
          ? frequencyMatch[1].trim()
          : null;
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
        const meta = (ph.metadata ?? {}) as {
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
          recurring_changes?: { label: string; before: boolean; after: boolean }[];
        };
        // Prefer a rich description built from before/after metadata (which
        // captures rental_price too). Fall back to the stored
        // event_description (which only covers dates + frequency) for rows
        // written before the metadata shape was finalized.
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
        if (Array.isArray(meta.recurring_changes) && meta.recurring_changes.length > 0) {
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
          description: `Tenant moved out of ${prop?.name || 'property'} on ${moveOutDate}.`,
          details: prop?.name || undefined,
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

      if (ph.event_type === 'service_request_created') {
        const prop = ph.property;
        const issueDescription = ph.event_description || 'Service Request';
        const eventDate = new Date(ph.created_at || new Date());
        tenancyEvents.push({
          id: `service-created-${ph.id}`,
          type: 'maintenance',
          title: 'Service Request Created',
          description: `Issue: "${issueDescription}" — Status: pending`,
          details: prop?.name || undefined,
          date: eventDate.toISOString(),
          time: formatTime(eventDate),
          relatedEntityId: ph.related_entity_id || undefined,
          relatedEntityType: 'service_request',
        });
      }

      if (ph.event_type === 'service_request_updated') {
        let status = 'updated';
        let previousStatus = '';
        let issueDescription = 'Service Request';

        if (ph.event_description) {
          try {
            const parsed = JSON.parse(ph.event_description);
            status = parsed.status || 'updated';
            previousStatus = parsed.previous_status || '';
            issueDescription = parsed.description || 'Service Request';
          } catch {
            const parts = ph.event_description.split('|||');
            status = parts[0] || 'updated';
            issueDescription = parts[1] || 'Service Request';
          }
        }

        const prop = ph.property;
        const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
        let title = `Service Request ${statusLabel}`;

        if (status.toLowerCase() === 'resolved') {
          title = 'Service Request Resolved';
        } else if (status.toLowerCase() === 'closed') {
          title = 'Service Request Closed';
        } else if (status.toLowerCase() === 'reopened') {
          title = 'Service Request Reopened';
        } else if (status.toLowerCase() === 'in_progress') {
          title = 'Service Request In Progress';
        } else if (status.toLowerCase() === 'open') {
          title = 'Service Request Opened';
        }

        const statusTransition = previousStatus
          ? `${previousStatus} → ${status}`
          : status;

        const eventDate = new Date(ph.created_at || new Date());
        tenancyEvents.push({
          id: `service-update-${ph.id}`,
          type: 'maintenance',
          title,
          description: `Issue: "${issueDescription}" — Status: ${statusTransition}`,
          details: prop?.name || undefined,
          date: eventDate.toISOString(),
          time: formatTime(eventDate),
          relatedEntityId: ph.related_entity_id || undefined,
          relatedEntityType: 'service_request',
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
          title: titleMap[ph.event_type],
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
          title: titleMap[ph.event_type] || 'Payment',
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

      if (ph.event_type === 'renewal_payment_made') {
        const prop = ph.property;
        const eventDate = new Date(ph.created_at || new Date());
        tenancyEvents.push({
          id: `renewal-payment-made-${ph.id}`,
          type: 'payment',
          title: 'Renewal Payment Made',
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
          title: 'Renewal Payment Initiated',
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
          title: 'Renewal Payment Cancelled',
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
        tenancyEvents.push({
          id: `user-added-${ph.id}`,
          type: 'general',
          title: `${parsedData.displayType || 'Custom Event'} — ${prop?.name || 'property'} — ${parsedData.description || ''}`,
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
          amount: parsedData.totalAmount ? String(parsedData.totalAmount) : null,
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
        tenancyEvents.push({
          id: `user-added-payment-${ph.id}`,
          type: 'general',
          title: `Payment received`,
          description: `Payment of ₦${Number(parsedData.paymentAmount || 0).toLocaleString()} on ${paymentDate}`,
          details: prop?.name || undefined,
          metadata: JSON.stringify({
            paymentAmount: parsedData.paymentAmount || 0,
            paymentDate,
            rawPaymentDate:
              parsedData.paymentDate ||
              (ph.move_in_date
                ? new Date(ph.move_in_date).toISOString()
                : null),
            propertyId: ph.property_id,
            propertyName: prop?.name || '',
            tenantName: parsedData.tenantName || '',
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
          parsedData.feeDate ||
            ph.move_in_date ||
            ph.created_at ||
            new Date(),
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
    });
  }

  // Add service request events (only for SRs that don't already have a
  // service_request_created property_history event, to avoid duplicates)
  const srIdsWithHistoryEvent = new Set(
    tenancyEvents
      .filter(
        (e) =>
          e.relatedEntityType === 'service_request' &&
          e.id.startsWith('service-created-'),
      )
      .map((e) => e.relatedEntityId),
  );
  const serviceRequestEvents: TimelineEvent[] = serviceRequests
    .filter((sr) => !srIdsWithHistoryEvent.has(sr.id))
    .map((sr) => {
      const eventDate = new Date(sr.date_reported);
      const prop = sr.property;
      const issueTitle = sr.description || 'Service Request';
      return {
        id: `service-${sr.id}`,
        type: 'maintenance',
        title: 'Service Request Created',
        description: `Issue: "${issueTitle}" — Status: ${sr.status || 'pending'}`,
        details: prop?.name || undefined,
        date: eventDate.toISOString(),
        time: formatTime(eventDate),
        relatedEntityId: sr.id,
        relatedEntityType: 'service_request',
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
        reference: payment.paystack_reference,
        paidAt: payment.paid_at?.toISOString(),
        isPartPayment,
      },
    };
  });

  // Combine all events and sort by date (newest first), dedupe by id.
  const allEvents: TimelineEvent[] = [
    ...tenancyEvents,
    ...serviceRequestEvents,
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
