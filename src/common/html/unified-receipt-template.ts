import { formatPaymentMethod } from '../utils/paystack-channel.util';

export interface UnifiedReceiptTemplateData {
  receiptNumber: string;
  tenantName: string;
  tenantPhone?: string | null;
  propertyName: string;
  paymentDate: string | Date | null;
  paymentMethod: string | null | undefined;
  landlord: {
    logoUrl?: string | null;
    businessName?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
  };
  descriptionRows: Array<{ label: string; amount: number }>;
  amountPaid: number;
  /** Pass a number (incl. 0) to render the row; undefined hides it. */
  remainingBalance?: number;
  extras?: Array<{ label: string; value: string }>;
}

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(text: string | null | undefined): string {
  if (text === null || text === undefined) return '';
  return String(text).replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);
}

function formatCurrency(amount: number): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '&#8358;0';
  return `&#8358;${n.toLocaleString('en-NG')}`;
}

function formatDateLong(input: string | Date | null): string {
  if (!input) return '—';
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return String(input);
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Single source of truth for server-rendered receipt PDFs. The visual
 * design mirrors the React `<UnifiedReceipt />` component on the frontend.
 */
export function renderUnifiedReceiptHTML(
  data: UnifiedReceiptTemplateData,
  options: { liztLogoSrc?: string } = {},
): string {
  const total = data.descriptionRows.reduce(
    (sum, r) => sum + (Number(r.amount) || 0),
    0,
  );
  const showRemaining = typeof data.remainingBalance === 'number';
  const remainingPositive = (data.remainingBalance ?? 0) > 0;
  const liztLogo =
    options.liztLogoSrc ??
    'https://www.lizt.ng/lizt.svg'; // public domain fallback

  const landlordLogoBlock = data.landlord.logoUrl
    ? `<img src="${escapeHtml(data.landlord.logoUrl)}" alt="${escapeHtml(
        data.landlord.businessName ?? 'Landlord',
      )}" class="landlord-logo" />`
    : `<div class="landlord-name">${escapeHtml(
        data.landlord.businessName ?? '',
      )}</div>`;

  const descriptionRowsHTML = data.descriptionRows
    .map(
      (row, i) => `
      <div class="row ${i % 2 === 0 ? 'row-alt' : ''}">
        <span class="row-label">${escapeHtml(row.label)}</span>
        <span class="row-amount">${formatCurrency(row.amount)}</span>
      </div>`,
    )
    .join('');

  const extrasBlock =
    data.extras && data.extras.length > 0
      ? `<div class="extras">${data.extras
          .map(
            (e) => `
              <div class="extras-item">
                <p class="extras-label">${escapeHtml(e.label)}</p>
                <p class="extras-value">${escapeHtml(e.value)}</p>
              </div>`,
          )
          .join('')}</div>`
      : '';

  const remainingHTML = showRemaining
    ? `<div class="summary-row">
         <span class="summary-label-strong">Remaining Balance</span>
         <span class="summary-amount-strong ${
           remainingPositive ? 'remaining-due' : ''
         }">${formatCurrency(data.remainingBalance ?? 0)}</span>
       </div>`
    : '';

  const footerLines = [
    data.landlord.phone,
    data.landlord.email,
    data.landlord.address,
  ]
    .filter(Boolean)
    .map((line) => `<p class="footer-line">${escapeHtml(line)}</p>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Payment Receipt — ${escapeHtml(data.receiptNumber)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
      background: #f9fafb;
      color: #1a1b23;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .lizt-bar { padding: 16px 24px; }
    .lizt-bar img { height: 40px; width: auto; }
    .card-wrap { display: flex; justify-content: center; padding: 0 16px 32px; }
    .card {
      background: #ffffff;
      max-width: 800px;
      width: 100%;
      padding: 64px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 24px;
      margin-bottom: 80px;
    }
    .landlord-logo { height: 50px; width: auto; object-fit: contain; }
    .landlord-name { font-size: 16px; font-weight: 600; color: #1a1b23; }
    .title { font-size: 28px; font-weight: 700; color: #1a1b23; letter-spacing: -0.02em; margin-bottom: 8px; text-align: right; }
    .receipt-num { font-size: 12px; color: #4b5563; text-align: right; }
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 64px;
      margin-bottom: 64px;
    }
    .info-group { margin-bottom: 24px; }
    .info-group:last-child { margin-bottom: 0; }
    .info-label { font-size: 11px; color: #6b7280; margin-bottom: 8px; }
    .info-value { font-size: 14px; color: #1a1b23; line-height: 1.5; }
    .info-value-strong { font-weight: 500; }

    .extras {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px 32px;
      margin-bottom: 64px;
      font-size: 13px;
    }
    .extras-label { color: #6b7280; margin-bottom: 4px; }
    .extras-value { color: #1a1b23; }

    .table { margin-bottom: 64px; }
    .table-head {
      background: #111827;
      color: #ffffff;
      padding: 14px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    }
    .th { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
    .row {
      padding: 18px 20px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
    }
    .row-alt { background: #f9fafb; }
    .row-label { font-size: 14px; color: #374151; flex: 1; line-height: 1.5; }
    .row-amount { font-size: 14px; color: #1a1b23; font-weight: 500; white-space: nowrap; }
    .total-row {
      border-top: 2px solid #d1d5db;
      margin-top: 8px;
      padding: 12px 20px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
    }
    .total-label, .total-amount { font-size: 14px; font-weight: 700; color: #1a1b23; white-space: nowrap; }
    .total-label { flex: 1; white-space: normal; }

    .summary-row {
      padding: 8px 20px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
    }
    .summary-label-paid { font-size: 16px; font-weight: 700; color: #15803d; flex: 1; }
    .summary-amount-paid { font-size: 18px; font-weight: 700; color: #15803d; white-space: nowrap; }
    .summary-label-strong { font-size: 16px; font-weight: 700; color: #1a1b23; flex: 1; }
    .summary-amount-strong { font-size: 18px; font-weight: 700; color: #1a1b23; white-space: nowrap; }
    .remaining-due { color: #ea580c; }

    .footer {
      margin-top: 80px;
      padding-top: 40px;
      border-top: 1px solid #e5e7eb;
    }
    .footer-thanks {
      font-size: 12px;
      color: #6b7280;
      line-height: 1.6;
      margin-bottom: 48px;
    }
    .footer-contact { text-align: center; }
    .footer-line { font-size: 11px; color: #6b7280; margin-bottom: 4px; }
  </style>
</head>
<body>
  <div class="lizt-bar"><img src="${escapeHtml(liztLogo)}" alt="Lizt" /></div>
  <div class="card-wrap">
    <div class="card">
      <div class="header">
        ${landlordLogoBlock}
        <div>
          <h1 class="title">PAYMENT RECEIPT</h1>
          <p class="receipt-num">Receipt #${escapeHtml(data.receiptNumber)}</p>
        </div>
      </div>

      <div class="info-grid">
        <div>
          <div class="info-group">
            <p class="info-label">Tenant</p>
            <p class="info-value info-value-strong">${escapeHtml(data.tenantName)}</p>
          </div>
          ${
            data.tenantPhone
              ? `<div class="info-group">
                   <p class="info-label">Phone</p>
                   <p class="info-value">${escapeHtml(data.tenantPhone)}</p>
                 </div>`
              : ''
          }
          <div class="info-group">
            <p class="info-label">Property</p>
            <p class="info-value">${escapeHtml(data.propertyName)}</p>
          </div>
        </div>
        <div>
          <div class="info-group">
            <p class="info-label">Date</p>
            <p class="info-value">${formatDateLong(data.paymentDate)}</p>
          </div>
          <div class="info-group">
            <p class="info-label">Mode of Payment</p>
            <p class="info-value">${escapeHtml(formatPaymentMethod(data.paymentMethod))}</p>
          </div>
        </div>
      </div>

      ${extrasBlock}

      <div class="table">
        <div class="table-head">
          <span class="th">Description</span>
          <span class="th">Amount</span>
        </div>
        ${descriptionRowsHTML}
        <div class="total-row">
          <span class="total-label">Total</span>
          <span class="total-amount">${formatCurrency(total)}</span>
        </div>
      </div>

      <div>
        <div class="summary-row">
          <span class="summary-label-paid">Amount Paid</span>
          <span class="summary-amount-paid">${formatCurrency(data.amountPaid)}</span>
        </div>
        ${remainingHTML}
      </div>

      <div class="footer">
        <p class="footer-thanks">
          Thank you for your payment. This receipt confirms your transaction
          for the period specified above.
        </p>
        <div class="footer-contact">${footerLines}</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}
