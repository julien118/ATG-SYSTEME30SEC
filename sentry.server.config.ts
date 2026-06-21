// Sentry — initialisation côté serveur (Node runtime). Importé par instrumentation.ts.
// Inerte tant que NEXT_PUBLIC_SENTRY_DSN n'est pas défini : aucun envoi, aucun impact.
import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN) && process.env.VERCEL_ENV === 'production',
  environment: process.env.VERCEL_ENV ?? 'development',
  // Erreurs uniquement : pas de tracing perf (coût/overhead nuls).
  tracesSampleRate: 0,
})
