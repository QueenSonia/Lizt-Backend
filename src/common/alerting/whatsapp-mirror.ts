import { escapeHtml, telegramAlerts } from './telegram-alert.service';

export interface WhatsappMirrorInput {
  direction: 'in' | 'out';
  phoneNumber: string;
  /** Resolved contact name, or null when the phone matches no user. */
  name?: string | null;
  /** 'text' | 'interactive' | 'template' | 'image' | … */
  messageType: string;
  content: string;
  simulated?: boolean;
}

/**
 * Mirror one WhatsApp message to Telegram.
 *
 * Fire-and-forget and non-throwing: mirroring must never break message logging,
 * which in turn must never break message delivery. Delivery is paced by the
 * shared queue in {@link telegramAlerts}, so a bulk reminder run arrives
 * staggered instead of tripping Telegram's per-chat rate limit.
 */
export function mirrorWhatsappMessage(input: WhatsappMirrorInput): void {
  try {
    if (!telegramAlerts.enabled) return;

    const inbound = input.direction === 'in';
    const icon = inbound ? '📥' : '📤';
    const heading = inbound ? 'WhatsApp IN' : 'WhatsApp OUT';
    const who = inbound ? 'From' : 'To';

    const name = input.name?.trim();
    const contact = name
      ? `<b>${escapeHtml(name)}</b> · <code>${escapeHtml(input.phoneNumber)}</code>`
      : `<code>${escapeHtml(input.phoneNumber)}</code>`;

    const body = (input.content ?? '').trim() || '(no text content)';

    const tags = [
      // 'text' is the default and not worth the line noise.
      input.messageType && input.messageType !== 'text'
        ? escapeHtml(input.messageType)
        : '',
      input.simulated ? 'simulated' : '',
    ].filter(Boolean);

    const lines = [
      `${icon} <b>${heading}</b>`,
      `👤 ${who}: ${contact}`,
      '',
      `<pre>${escapeHtml(body.slice(0, 3000))}</pre>`,
      tags.length ? `🏷 ${tags.join(' · ')}` : '',
    ].filter(Boolean);

    telegramAlerts.mirror(lines.join('\n').slice(0, 4096));
  } catch (err) {
    // console.* directly — the Nest Logger would route back into alerting.
    console.error('[WhatsappMirror] failed to mirror message:', err);
  }
}

/**
 * Build a display name from a user row. Returns null when nothing usable is
 * present, so callers fall back to showing the bare phone number.
 */
export function formatContactName(
  user?: { first_name?: string | null; last_name?: string | null } | null,
): string | null {
  if (!user) return null;
  const parts = [user.first_name, user.last_name]
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase());
  return parts.length ? parts.join(' ') : null;
}
