import { ConsoleLogger } from '@nestjs/common';
import { telegramAlerts } from './telegram-alert.service';

/**
 * Drop-in replacement for the default Nest logger.
 *
 * Extends {@link ConsoleLogger} so all normal console output is preserved, then
 * mirrors every `error()` / `warn()` call to Telegram. Installing this via
 * `app.useLogger(new TelegramLogger())` makes it the delegate for *every*
 * `new Logger(context)` instance in the app — so it captures the global
 * exception filter, cron jobs, webhook handlers and payment workers alike,
 * without touching any of them.
 */
export class TelegramLogger extends ConsoleLogger {
  private readonly alerts = telegramAlerts;

  /** True when prod + both Telegram secrets are configured. */
  get alertsEnabled(): boolean {
    return this.alerts.enabled;
  }

  /** One-off message (e.g. a boot heartbeat), bypassing dedup/rate limits. */
  notify(text: string): void {
    this.alerts.notify(text);
  }

  error(message: any, ...rest: any[]): void {
    super.error(message, ...rest);
    this.forward('error', message, rest);
  }

  warn(message: any, ...rest: any[]): void {
    super.warn(message, ...rest);
    this.forward('warn', message, rest);
  }

  private forward(
    level: 'error' | 'warn',
    message: any,
    rest: any[],
  ): void {
    if (!this.alerts.enabled) return;

    // Nest calls loggers positionally, e.g.
    //   logger.error(message, stack, context)
    //   logger.warn(message, context)
    // The context (logger name) is the last string arg; anything before it
    // (a stack or a JSON payload) is useful detail to include in the alert.
    const context = this.extractContext(rest);
    const detail = rest
      .filter((r) => r !== context)
      .map((r) => (typeof r === 'string' ? r : safeStringify(r)))
      .join('\n');

    const text = detail
      ? `${stringify(message)}\n${detail}`
      : stringify(message);

    this.alerts.send(level, text, context);
  }

  /** The context is the trailing string arg (a short identifier, no newlines). */
  private extractContext(rest: any[]): string | undefined {
    const last = rest[rest.length - 1];
    if (
      typeof last === 'string' &&
      last.length > 0 &&
      last.length <= 80 &&
      !last.includes('\n')
    ) {
      return last;
    }
    return undefined;
  }
}

function stringify(v: any): string {
  if (typeof v === 'string') return v;
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  return safeStringify(v);
}

function safeStringify(v: any): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
