import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export type RentChangeIssueSeverity = 'blocker' | 'warning' | 'info';

export type RentChangeIssueKind =
  | 'stale_renewal_invoice'
  | 'sent_public_token'
  | 'reminder_replay'
  | 'amount_mismatch'
  | 'ledger_narrative'
  | 'payment_plan_drift'
  | 'history_audit';

export type RentChangeSuggestedAction =
  | 'adjust_amount'
  | 'acknowledge_only'
  | 'update_reminder_dedup'
  | 'realign_invoice_period';

export class RentChangeSuggestedFixDto {
  @ApiProperty({ example: 'Acknowledge desync' })
  label: string;

  @ApiProperty({
    description:
      'Machine-readable action hint the frontend can map to a button style. adjust_amount = auto-fix; acknowledge_only = just record & move on; update_reminder_dedup = bump last_reminder_sent_on; realign_invoice_period = open confirm modal then call POST /tenancies/renewal-invoice/:id/realign-period.',
    enum: [
      'adjust_amount',
      'acknowledge_only',
      'update_reminder_dedup',
      'realign_invoice_period',
    ],
  })
  action: RentChangeSuggestedAction;

  @ApiPropertyOptional({
    description:
      'Opaque payload the backend needs if this fix is applied. E.g. { deltaMinor: -2500000 } for adjust_amount; { renewalInvoiceId } for realign_invoice_period.',
  })
  payload?: Record<string, unknown>;
}

export class RentChangeIssueDto {
  @ApiProperty({
    description:
      'Stable ID derived from kind + affected entity. Frontend passes this back in acknowledged_issue_ids to bypass a blocker.',
    example: 'stale_renewal_invoice:7d4e...',
  })
  id: string;

  @ApiProperty({ enum: ['blocker', 'warning', 'info'] })
  severity: RentChangeIssueSeverity;

  @ApiProperty({
    enum: [
      'stale_renewal_invoice',
      'sent_public_token',
      'reminder_replay',
      'amount_mismatch',
      'ledger_narrative',
      'payment_plan_drift',
      'history_audit',
    ],
  })
  kind: RentChangeIssueKind;

  @ApiProperty({ example: 'Renewal invoice start date (2026-01-01) no longer matches new rent end (2026-03-31).' })
  description: string;

  @ApiPropertyOptional({ type: () => RentChangeSuggestedFixDto, nullable: true })
  suggestedFix: RentChangeSuggestedFixDto | null;

  @ApiPropertyOptional({
    type: () => [RentChangeSuggestedFixDto],
    description:
      'Additional fixes the user can pick instead of the primary suggestedFix. Frontend renders these as secondary buttons. Currently only set on stale_renewal_invoice issues, where the user can either acknowledge-only or realign the invoice period.',
  })
  alternativeFixes?: RentChangeSuggestedFixDto[];
}

export class RentChangeComputedDto {
  @ApiProperty({
    enum: ['monthly', 'quarterly', 'bi-annually', 'annually'],
    description:
      'The standard frequency that period-aware logic (reminders, auto-renewal) will use. Equal to the user-selected frequency for standard choices; bucketed nearest-going-up for custom.',
  })
  effectiveFrequency: 'monthly' | 'quarterly' | 'bi-annually' | 'annually';

  @ApiProperty({ example: '2026-04-22' })
  nextPeriodStart: string;

  @ApiProperty({ example: '2027-04-21' })
  nextPeriodEnd: string;

  @ApiProperty({
    example: 125000,
    description:
      'Outstanding balance (minor→major units inherited from ledger) AFTER any proposed ledger reversal would apply. Zero if no reversal is proposed.',
  })
  newOutstanding: number;
}

export class RentChangeImpactDto {
  @ApiProperty({ type: () => [RentChangeIssueDto] })
  issues: RentChangeIssueDto[];

  @ApiProperty({ type: () => RentChangeComputedDto })
  computed: RentChangeComputedDto;
}
