import { withSentryConfig } from '@sentry/nextjs'

// En-têtes de sécurité appliqués à toutes les routes (durcissement défense-en-profondeur).
// frame-ancestors 'self' + X-Frame-Options SAMEORIGIN : bloquent le clickjacking tiers
// tout en laissant l'app cadrer ses propres ressources same-origin (ex. aperçu PDF).
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
  // L'app A BESOIN de la caméra et du micro (photo + observation vocale) : on les
  // AUTORISE en same-origin et on refuse tout le reste qu'on n'utilise pas.
  {
    key: 'Permissions-Policy',
    value: 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), browsing-topics=()',
  },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

// Sentry n'enveloppe la config que si org + project sont définis : tant que ce
// n'est pas le cas, le build et le comportement restent strictement identiques
// (en-têtes de sécurité préservés).
const sentryEnabled = Boolean(process.env.SENTRY_ORG && process.env.SENTRY_PROJECT)

export default sentryEnabled
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN, // facultatif : source maps lisibles
      tunnelRoute: '/monitoring', // contourne les bloqueurs de pub (same-origin)
      widenClientFileUpload: true,
      silent: !process.env.CI,
      disableLogger: true,
    })
  : nextConfig
