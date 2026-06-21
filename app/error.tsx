'use client'

// Error boundary de segment : ecran propre cote utilisateur (« Reessayer ») +
// remontee silencieuse de l'erreur vers /api/client-error (cote serveur, ou vit le
// token Telegram). Le fetch est fire-and-forget : il ne throw JAMAIS depuis le
// boundary. Styles inline pour ne dependre d'aucun CSS (le boundary peut s'afficher
// alors que la mise en page a echoue).

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
    try {
      fetch('/api/client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: error.message,
          stack: error.stack,
          digest: error.digest,
          url: typeof window !== 'undefined' ? window.location.href : null,
        }),
        keepalive: true,
      }).catch(() => {})
    } catch {
      /* ne jamais throw depuis un error boundary */
    }
  }, [error])

  return (
    <div
      style={{
        minHeight: '60vh',
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
  )
}
