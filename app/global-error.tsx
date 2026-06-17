'use client'

// Error boundary RACINE : remplace entierement app/layout.tsx quand le layout
// racine lui-meme echoue. Doit donc rendre ses propres <html> et <body>. N'est
// actif qu'en PRODUCTION (en dev, l'overlay Next prend le dessus — normal).
// Comme app/error.tsx : ecran propre + remontee silencieuse vers /api/client-error.

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    try {
      fetch('/api/client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: error.message,
          stack: error.stack,
          digest: error.digest,
          url: typeof window !== 'undefined' ? window.location.href : null,
          scope: 'global',
        }),
        keepalive: true,
      }).catch(() => {})
    } catch {
      /* ne jamais throw depuis un error boundary */
    }
  }, [error])

  return (
    <html lang="fr">
      <body style={{ margin: 0 }}>
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            padding: 24,
            textAlign: 'center',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 600, color: '#111827', margin: 0 }}>
            Une erreur est survenue
          </h2>
          <p style={{ color: '#6b7280', margin: 0, maxWidth: 320 }}>
            Désolé, quelque chose s&apos;est mal passé. Vous pouvez réessayer.
          </p>
          <button
            onClick={() => reset()}
            style={{
              marginTop: 8,
              padding: '12px 24px',
              background: '#10B981',
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              fontSize: 16,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Réessayer
          </button>
        </div>
      </body>
    </html>
  )
}
