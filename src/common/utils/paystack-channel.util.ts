const CHANNEL_LABELS: Record<string, string> = {
  card: 'Card',
  bank: 'Bank Transfer',
  bank_transfer: 'Bank Transfer',
  ussd: 'USSD',
  qr: 'QR',
  mobile_money: 'Mobile Money',
  eft: 'EFT',
  apple_pay: 'Apple Pay',
};

export function formatPaymentMethod(value: string | null | undefined): string {
  if (!value) return '—';
  const key = value.toLowerCase().trim();
  if (CHANNEL_LABELS[key]) return CHANNEL_LABELS[key];
  return key
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
