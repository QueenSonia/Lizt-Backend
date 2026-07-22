import axios from 'axios';

export type AlertLevel = 'error' | 'warn';

/**
 * Sends server alerts and WhatsApp message mirrors to a Telegram chat.
 *
 * Design notes:
 *  - Dependency-light on purpose: reads config from `process.env` and posts with
 *    axios directly, so it can be driven by the custom logger before/outside the
 *    Nest DI request lifecycle.
 *  - Fire-and-forget: nothing here throws or blocks the caller. Its own failures
 *    are written with `console.error` (NOT the Nest Logger) so a failed Telegram
 *    call can never re-enter the logger and cause an alert loop.
 *  - Two channels share one instance (see the `telegramAlerts` singleton) so the
 *    outbound queue paces *all* traffic globally:
 *      • {@link send}   — server errors/warnings, with dedup + a rate cap.
 *      • {@link mirror} — WhatsApp messages, no dedup (every message is wanted),
 *        but still queued so a reminder blast can't trip Telegram's rate limit.
 */
export class TelegramAlertService {
  private readonly token = process.env.TELEGRAM_BOT_TOKEN ?? '';
  private readonly chatId = process.env.TELEGRAM_CHAT_ID ?? '';
  private readonly env = process.env.NODE_ENV ?? 'development';

  /** Only alert in production, and only when both secrets are present. */
  public readonly enabled =
    this.env === 'production' && !!this.token && !!this.chatId;

  // ── Noise control tuning (error/warn channel only) ─────────────────
  /** Same error signature is sent at most once per this window. */
  private readonly DEDUP_WINDOW_MS = 60_000;
  /** Max error/warn alerts per rolling window. */
  private readonly RATE_LIMIT = 15;
  private readonly RATE_WINDOW_MS = 60_000;

  // ── Delivery queue tuning (both channels) ──────────────────────────
  /**
   * Telegram throttles at roughly one message per second to the same chat;
   * exceeding it returns 429 and drops traffic. Everything is funnelled through
   * one paced queue so a 200-message reminder cron arrives staggered rather
   * than being discarded.
   */
  private readonly MIN_SEND_INTERVAL_MS = 1_100;
  /** Hard ceiling on backlog so a runaway loop can't exhaust memory. */
  private readonly MAX_QUEUE = 500;

  /**
   * 4xx responses are client mistakes, not server faults: expired JWTs (401)
   * and vulnerability scanners probing for `/.env`, `/.git/config`, `/owa/`
   * etc (404). AppExceptionsFilter logs every sub-500 status as `warn`, so
   * without this gate they drown out real signal. Set
   * TELEGRAM_ALERT_INCLUDE_4XX=true to page on them anyway.
   */
  private readonly includeClientErrors =
    process.env.TELEGRAM_ALERT_INCLUDE_4XX === 'true';

  /** signature -> last-sent epoch ms */
  private readonly lastSent = new Map<string, number>();
  /** send timestamps inside the current rate window */
  private sentTimestamps: number[] = [];
  /** count of alerts dropped since the last summary flush */
  private suppressedCount = 0;
  private summaryTimer: NodeJS.Timeout | null = null;

  private queue: string[] = [];
  private draining = false;
  private droppedFromQueue = 0;

  // ── Public API ────────────────────────────────────────────────────

  /**
   * Queue a server error/warning. Deduped and rate-capped. Returns immediately.
   */
  send(level: AlertLevel, message: string, context?: string): void {
    if (!this.enabled) return;
    if (this.isClientError(message)) return;

    try {
      const signature = this.signatureFor(level, message, context);
      const now = Date.now();

      // ── Dedup: same signature within the window is dropped ──────────
      const last = this.lastSent.get(signature);
      if (last && now - last < this.DEDUP_WINDOW_MS) {
        this.suppressedCount++;
        return;
      }

      // ── Rate cap across all signatures ─────────────────────────────
      this.sentTimestamps = this.sentTimestamps.filter(
        (t) => now - t < this.RATE_WINDOW_MS,
      );
      if (this.sentTimestamps.length >= this.RATE_LIMIT) {
        this.suppressedCount++;
        this.scheduleSummary();
        return;
      }

      this.lastSent.set(signature, now);
      this.sentTimestamps.push(now);
      this.pruneDedupMap(now);

      this.enqueue(this.format(level, message, context));
    } catch (err) {
      // Never let alerting break the caller.
      console.error('[TelegramAlert] send() failed:', err);
    }
  }

  /**
   * Queue a pre-formatted WhatsApp message mirror. Intentionally skips dedup and
   * the alert rate cap — every message is wanted, including repeats — but still
   * goes through the paced queue.
   */
  mirror(text: string): void {
    if (!this.enabled) return;
    this.enqueue(text);
  }

  /**
   * One-off notification, e.g. a boot heartbeat.
   */
  notify(text: string): void {
    if (!this.enabled) return;
    this.enqueue(text);
  }

  // ── Alert formatting / filtering ──────────────────────────────────

  /**
   * True when the log line carries a 4xx status (AppExceptionsFilter attaches a
   * JSON payload containing `statusCode`). Non-HTTP logs — cron jobs, webhook
   * handlers, payment workers — have no statusCode and are never suppressed.
   */
  private isClientError(message: string): boolean {
    if (this.includeClientErrors) return false;
    const match = /"statusCode":\s*(\d{3})/.exec(message);
    if (!match) return false;
    const status = Number(match[1]);
    return status >= 400 && status < 500;
  }

  private signatureFor(
    level: AlertLevel,
    message: string,
    context?: string,
  ): string {
    // First line only — stacks/payloads vary per occurrence but describe the
    // same fault. Strip digits so id/timestamp noise collapses to one signature.
    const firstLine = String(message).split('\n')[0].slice(0, 200);
    const normalized = firstLine.replace(/\d+/g, '#');
    return `${level}|${context ?? ''}|${normalized}`;
  }

  private format(level: AlertLevel, message: string, context?: string): string {
    const icon = level === 'error' ? '🔴' : '🟠';
    const title = level === 'error' ? 'ERROR' : 'WARNING';
    const stamp = new Date().toISOString();
    const body = String(message).slice(0, 3500);

    const lines = [
      `${icon} <b>${title}</b> · <code>${escapeHtml(this.env)}</code>`,
      context ? `📍 <b>${escapeHtml(context)}</b>` : '',
      '',
      `<pre>${escapeHtml(body)}</pre>`,
      '',
      `🕒 ${stamp}`,
    ].filter(Boolean);

    // Telegram hard limit is 4096 chars.
    return lines.join('\n').slice(0, 4096);
  }

  private scheduleSummary(): void {
    if (this.summaryTimer) return;
    this.summaryTimer = setTimeout(() => {
      this.summaryTimer = null;
      const dropped = this.suppressedCount;
      this.suppressedCount = 0;
      if (dropped > 0) {
        this.enqueue(
          `⚠️ <b>${dropped}</b> further alert(s) suppressed in the last minute ` +
            `(rate cap / duplicates) on <code>${escapeHtml(this.env)}</code>.`,
        );
      }
    }, this.RATE_WINDOW_MS);
    // Don't keep the event loop alive just for the summary.
    this.summaryTimer.unref?.();
  }

  /** Drop stale dedup entries so the map can't grow unbounded. */
  private pruneDedupMap(now: number): void {
    if (this.lastSent.size < 500) return;
    for (const [sig, ts] of this.lastSent) {
      if (now - ts > this.DEDUP_WINDOW_MS) this.lastSent.delete(sig);
    }
  }

  // ── Paced delivery queue ──────────────────────────────────────────

  private enqueue(text: string): void {
    if (this.queue.length >= this.MAX_QUEUE) {
      this.droppedFromQueue++;
      return;
    }
    this.queue.push(text);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;

    try {
      while (this.queue.length || this.droppedFromQueue > 0) {
        if (!this.queue.length) {
          const n = this.droppedFromQueue;
          this.droppedFromQueue = 0;
          this.queue.push(
            `⚠️ <b>${n}</b> further message(s) dropped — Telegram queue overflowed.`,
          );
        }

        const text = this.queue.shift() as string;
        const retryAfterSec = await this.deliver(text);

        if (retryAfterSec > 0) {
          // Telegram asked us to back off — requeue and wait it out.
          this.queue.unshift(text);
          await sleep(retryAfterSec * 1000);
        } else {
          await sleep(this.MIN_SEND_INTERVAL_MS);
        }
      }
    } catch (err) {
      console.error('[TelegramAlert] queue drain failed:', err);
    } finally {
      this.draining = false;
    }
  }

  /**
   * POST one message. Returns the number of seconds Telegram asked us to wait
   * (from a 429), or 0 when no backoff is required.
   */
  private async deliver(text: string): Promise<number> {
    try {
      await axios.post(
        `https://api.telegram.org/bot${this.token}/sendMessage`,
        {
          chat_id: this.chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        },
        { timeout: 8_000 },
      );
      return 0;
    } catch (err: any) {
      const data = err?.response?.data;
      const retryAfter = data?.parameters?.retry_after;
      if (typeof retryAfter === 'number' && retryAfter > 0) {
        return Math.min(retryAfter, 60);
      }
      // Use console.* directly — routing through Nest Logger here would recurse.
      console.error(
        '[TelegramAlert] delivery failed:',
        data ?? err?.message ?? err,
      );
      return 0;
    }
  }
}

export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Shared instance. Both the logger and the WhatsApp mirror use this so all
 * outbound Telegram traffic passes through a single paced queue.
 */
export const telegramAlerts = new TelegramAlertService();
