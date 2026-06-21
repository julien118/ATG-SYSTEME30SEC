// Sentry — initialisation côté navigateur. Inerte tant que NEXT_PUBLIC_SENTRY_DSN
// n'est pas défini (aucun envoi). Pas de Session Replay (coût + données client).
import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN) && process.env.VERCEL_ENV === 'production',
  environment: process.env.VERCEL_ENV ?? 'development',
  tracesSampleRate: 0,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
