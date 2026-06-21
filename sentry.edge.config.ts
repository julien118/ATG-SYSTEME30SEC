// Sentry — initialisation côté edge runtime (middleware). Importé par instrumentation.ts.
// Inerte tant que NEXT_PUBLIC_SENTRY_DSN n'est pas défini.
import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN) && process.env.VERCEL_ENV === 'production',
  environment: process.env.VERCEL_ENV ?? 'development',
  tracesSampleRate: 0,
})
