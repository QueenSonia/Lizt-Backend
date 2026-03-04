// IMPORTANT: This file must be imported at the very top of main.ts
// before any other imports, so Sentry can instrument everything.
import * as Sentry from '@sentry/nestjs';

Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',

    // Capture 10% of transactions in production, 100% in dev
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

    // Send default PII (IP addresses, etc.) for better debugging
    sendDefaultPii: true,
});
