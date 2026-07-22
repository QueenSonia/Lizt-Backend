import axios from 'axios';

export type AlertLevel = 'error' | 'warn';

/**
 * Sends server error/warning alerts to a Telegram chat.
 *
 * Design notes:
 *  - Dependency-light on purpose: reads config from `process.env` and posts with
 *    axios directly, so it can be driven by the custom logger before/outside the
 *    Nest DI request lifecycle.
 *  - Fire-and-forget: `send()` never throws and never blocks the caller. Its own
 *    failures are written with `console.error` (NOT the Nest Logger) so a failed
 *    Telegram call can never re-enter the logger and cause an alert loop.
 *  - Noise control: per-signature dedup window + a rolling per-minute rate cap.
 *    When the cap is exceeded, individual messages are suppressed and a single
 *    rolled-up summary is flushed at the end of the window.
 */
export class TelegramAlertService {
  private readonly token = process.env.TELEGRAM_BOT_TOKEN ?? '';
  private readonly chatId = process.env.TELEGRAM_CHAT_ID ?? '';
  private readonly env = process.env.NODE_ENV ?? 'development';

  /** Only alert in production, and only when both secrets are present. */
  public readonly enabled =
    this.env === 'production' && !!this.token && !!this.chatId;

  // ── Noise control tuning ──────────────────────────────────────────
  /** Same error signature is sent at most once per this window. */
  private readonly DEDUP_WINDOW_MS = 60_000;
  /** Max Telegram messages sent per rolling window. */
  private readonly RATE_LIMIT = 15;
  private readonly RATE_WINDOW_MS = 60_000;

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
  /** count of messages dropped since the last summary flush */
  private suppressedCount = 0;
  private summaryTimer: NodeJS.Timeout | null = null;

  /**
   * Queue an alert. Safe to call from anywhere; returns immediately.
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

      void this.post(this.format(level, message, context));
    } catch (err) {
      // Never let alerting break the caller.
      console.error('[TelegramAlert] send() failed:', err);
    }
  }

  /**
   * Optional one-off notification, e.g. a boot heartbeat. Bypasses dedup/rate
   * logic but still respects the enabled gate.
   */
  notify(text: string): void {
    if (!this.enabled) return;
    void this.post(text);
  }

  // ── internals ─────────────────────────────────────────────────────

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
      `${icon} <b>${title}</b> · <code>${this.escape(this.env)}</code>`,
      context ? `📍 <b>${this.escape(context)}</b>` : '',
      '',
      `<pre>${this.escape(body)}</pre>`,
      '',
      `🕒 ${stamp}`,
    ].filter(Boolean);

    // Telegram hard limit is 4096 chars.
    return lines.join('\n').slice(0, 4096);
  }

  private async post(text: string): Promise<void> {
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
    } catch (err: any) {
      // Use console.* directly — routing through Nest Logger here would recurse.
      console.error(
        '[TelegramAlert] delivery failed:',
        err?.response?.data ?? err?.message ?? err,
      );
    }
  }

  private scheduleSummary(): void {
    if (this.summaryTimer) return;
    this.summaryTimer = setTimeout(() => {
      this.summaryTimer = null;
      const dropped = this.suppressedCount;
      this.suppressedCount = 0;
      if (dropped > 0) {
        void this.post(
          `⚠️ <b>${dropped}</b> further alert(s) suppressed in the last minute ` +
            `(rate cap / duplicates) on <code>${this.escape(this.env)}</code>.`,
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

  private escape(s: string): string {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
