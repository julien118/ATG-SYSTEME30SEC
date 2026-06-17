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

export default nextConfig
