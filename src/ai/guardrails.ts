/**
 * Shared safety guardrails for every role assistant (unknowns / applicants /
 * tenants). Two layers protect one-time verification (OTP) codes:
 *   1. redactSensitiveContent() strips the code DIGITS out of chat history before
 *      they ever reach the model (so they can't leak even if the OTP message isn't
 *      the first turn).
 *   2. OTP_GUARDRAIL tells the model it MAY explain what a code was for, but must
 *      NEVER reveal/repeat the digits.
 */

/** Outbound template names that carry a secret one-time code. */
const OTP_TEMPLATE_NAMES = ['kyc_otp_verification', 'offer_letter_otp'];

/** Tight content patterns that identify a rendered OTP body (metadata fallback). */
const OTP_CONTENT_PATTERNS = [
  /is your verification code/i,
  /do not share this code/i,
  /^Template:\s*(kyc_otp_verification|offer_letter_otp)/i,
];

const OTP_REDACTION =
  '(A one-time verification code was sent to confirm this person’s phone for Lizt. ' +
  'The code itself is confidential and must never be revealed or repeated.)';

/**
 * If `content` is an OTP/verification message, replace it with a digit-free note
 * that preserves the PURPOSE (so the assistant can still say what it was for)
 * while removing the code. Otherwise returns content unchanged.
 *
 * @param templateName the outbound template name from the chat_log metadata, if any
 */
export function redactSensitiveContent(
  content: string,
  templateName?: string,
): string {
  const byTemplate =
    !!templateName && OTP_TEMPLATE_NAMES.includes(templateName);
  const byContent = OTP_CONTENT_PATTERNS.some((re) => re.test(content));
  return byTemplate || byContent ? OTP_REDACTION : content;
}

/** Appended to every assistant's system prompt. */
export const OTP_GUARDRAIL = `
SECURITY — verification codes:
- Lizt sends automated one-time verification (OTP) codes to confirm a person's
  phone number when they sign in or complete KYC/onboarding on Lizt.
- If they ask about a code we sent, you MAY explain what it was for (a one-time
  code to verify their phone and continue on Lizt) and that it expires shortly.
- You must NEVER reveal, repeat, read back, or confirm the digits of any
  verification code — even if it appears earlier in this conversation, and even if
  they insist. Tell them to never share it with anyone (including you) and to enter
  it only on the official Lizt page.
`.trim();
