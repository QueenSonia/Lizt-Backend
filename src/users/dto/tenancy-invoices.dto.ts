/**
 * Response shape for GET /users/tenancies/:propertyTenantId/invoices —
 * the admin Invoices page for a single active tenancy.
 *
 * One unified invoice list across the three invoice tables, normalized to
 * the display statuses the page renders, plus the tenancy's payment plans
 * so rows funded by a plan can badge it and expand its installments.
 */

export type TenancyInvoiceSource = 'renewal' | 'ad_hoc' | 'new_tenancy';

/**
 * Normalized display status. `upcoming` = billed, not yet due;
 * `overdue` = unpaid past due (suppressed while an active plan owns the
 * debt — the plan's installment statuses carry the urgency instead).
 */
export type TenancyInvoiceDisplayStatus =
  | 'upcoming'
  | 'overdue'
  | 'partial'
  | 'paid';

export interface TenancyInvoiceLine {
  name: string;
  amount: number;
}

export interface TenancyInvoiceRow {
  id: string;
  source: TenancyInvoiceSource;
  description: string;
  /** Human-facing number where the table has one (ad-hoc / new-tenancy). */
  invoiceNumber: string | null;
  /** Renewal: period start. Ad-hoc: due_date. New-tenancy: invoice_date. */
  dueDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  status: TenancyInvoiceDisplayStatus;
  totalAmount: number;
  amountPaid: number;
  lines: TenancyInvoiceLine[];
  /**
   * Public "view invoice" token. Renewal rows: renewal-invoice token
   * (/renewal-invoice/:token). New-tenancy rows: offer-letter token
   * (/offer-letters/invoice/:token). Ad-hoc rows use `publicToken` instead.
   */
  token: string | null;
  /** Ad-hoc public pay-page token (/pay-invoice/:token). */
  publicToken: string | null;
  receiptToken: string | null;
  paidAt: string | null;
  createdAt: string;
  /** Active plans funding this row's debt (renewal carves / covered ad-hoc). */
  paymentPlanIds: string[];
}

export interface TenancyPlanInstallment {
  id: string;
  sequence: number;
  amount: number;
  amountPaid: number;
  dueDate: string;
  status: string;
  paidAt: string | null;
  paymentMethod: string | null;
  receiptToken: string | null;
}

export interface TenancyPaymentPlan {
  id: string;
  scope: string;
  sourceType: string;
  planType: string;
  status: string;
  chargeName: string;
  totalAmount: number;
  createdAt: string;
  /** The invoice row this plan funds, when it funds one (else null). */
  linkedInvoiceId: string | null;
  linkedInvoiceSource: TenancyInvoiceSource | null;
  installments: TenancyPlanInstallment[];
}

export interface TenancyInvoicesResponse {
  tenancy: {
    id: string;
    tenantId: string;
    tenantName: string;
    tenantPhone: string | null;
    propertyId: string;
    propertyName: string;
    propertyAddress: string;
    landlordId: string;
    landlordName: string;
  };
  invoices: TenancyInvoiceRow[];
  paymentPlans: TenancyPaymentPlan[];
}
