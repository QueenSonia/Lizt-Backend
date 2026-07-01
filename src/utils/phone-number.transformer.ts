import { Transform } from 'class-transformer';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

/**
 * Default region used to interpret a locally-typed number that carries no
 * explicit country code (e.g. Nigerian `0803...` or bare `803...`). An explicit
 * `+`/country code always wins over this default.
 */
const DEFAULT_REGION = 'NG';

/**
 * Parse any reasonable phone input to a canonical E.164 string WITH the leading
 * `+`, or return null if it isn't a valid number.
 *
 * Strategy (order matters — see phone i18n plan §0):
 *   1. Treat the input as international first. This catches `+44...`, an
 *      already-stored canonical `2348031234567`, and inbound WhatsApp `from`
 *      values which Meta delivers as country-code digits with NO `+`
 *      (e.g. `447911123456`). Prefixing `+` and parsing makes this branch
 *      idempotent for anything already in E.164 shape.
 *   2. Otherwise interpret it as a local number in DEFAULT_REGION. This catches
 *      Nigerian `0803...` and bare national `803...` forms.
 *
 * Foreign national numbers that collide with a country-calling-code prefix
 * (e.g. NG bare `7012345678` vs +7) are NOT mis-parsed in step 1 because the
 * colliding country's national-number length doesn't match — the international
 * parse fails and we correctly fall through to the NG interpretation.
 */
export function toE164(phoneNumber?: string | null): string | null {
  if (!phoneNumber) return null;
  const cleaned = String(phoneNumber).trim().replace(/[^\d+]/g, '');
  if (!cleaned) return null;

  // 1. Already-international (explicit + or bare country-code digits)
  const international = parsePhoneNumberFromString(
    cleaned.startsWith('+') ? cleaned : '+' + cleaned,
  );
  if (international && international.isValid()) {
    return international.number; // E.164 with leading '+'
  }

  // 2. Local number in the default region
  const local = parsePhoneNumberFromString(
    cleaned.replace(/\+/g, ''),
    DEFAULT_REGION,
  );
  if (local && local.isValid()) {
    return local.number;
  }

  return null;
}

/**
 * Returns true if the input can be understood as a valid phone number.
 *
 * IMPORTANT: this mirrors {@link toE164}, so it accepts BOTH the user-entered
 * `+44...` form AND the already-normalized digits-only `447911123456` form.
 * The validator must accept the post-`@NormalizePhoneNumber()` value because
 * the transform runs before validation in the global ValidationPipe.
 */
export function isValidPhone(phoneNumber?: string | null): boolean {
  return toE164(phoneNumber) !== null;
}

/**
 * Format a stored phone number for human display in templates/notifications.
 * Nigerian numbers render in local `0xxx` form (matching existing templates);
 * every other country renders in full international `+CC ...` form so the
 * number stays dialable. Returns the `missing` placeholder when empty and the
 * raw value untouched when it can't be parsed.
 */
export function formatPhoneForDisplay(
  phoneNumber?: string | null,
  missing = '—',
): string {
  if (!phoneNumber) return missing;
  const e164 = toE164(phoneNumber);
  if (!e164) return phoneNumber;
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return phoneNumber;
  if (parsed.country === 'NG') {
    return '0' + parsed.nationalNumber;
  }
  return parsed.formatInternational();
}

/**
 * Decorator to automatically normalize phone numbers in DTOs.
 * Converts any accepted form to canonical `<countrycode>XXXXXXXXXX` (digits
 * only, no `+`). Nigerian `0803...` -> `2348031234567`; UK `+44...` -> `447...`.
 *
 * Usage:
 * @NormalizePhoneNumber()
 * phone_number: string;
 */
export function NormalizePhoneNumber() {
  return Transform(({ value }) => {
    if (!value) return value;
    return normalizePhoneNumber(value);
  });
}

/**
 * Standalone function to normalize phone numbers.
 * Normalizes to format: `<countrycode>XXXXXXXXXX` (digits only, no `+`).
 * NG stays `234XXXXXXXXXX`; other countries store their own E.164 digits.
 * Idempotent: normalizePhoneNumber(normalizePhoneNumber(x)) === normalizePhoneNumber(x).
 */
export function normalizePhoneNumber(phoneNumber: string): string {
  if (!phoneNumber) return '';

  const e164 = toE164(phoneNumber);
  if (e164) return e164.slice(1); // strip the leading '+'

  // Fallback: never throw on an unparseable value. Preserve the legacy
  // Nigerian behaviour so odd-but-NG inputs don't regress. Invalid numbers are
  // rejected upstream by @IsValidPhoneNumber, so this rarely runs.
  const cleaned = phoneNumber.replace(/\D/g, '');
  if (!cleaned) return '';
  if (cleaned.startsWith('234')) return cleaned;
  if (cleaned.startsWith('0')) return '234' + cleaned.slice(1);
  return cleaned.length === 10 ? '234' + cleaned : cleaned;
}
