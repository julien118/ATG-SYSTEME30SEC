import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import ToastProvider from '@/components/ToastProvider'
import AssistantGate from '@/components/AssistantGate'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'ATG — Système 30 Secondes',
  description: 'Système 30 Secondes par IONNYX',
  manifest: '/manifest.json',
  openGraph: {
    title: 'ATG — Système 30 Secondes',
    description: 'Système 30 Secondes par IONNYX',
    siteName: 'ATG',
    locale: 'fr_FR',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ATG — Système 30 Secondes',
    description: 'Système 30 Secondes par IONNYX',
  },
  icons: {
    icon: [
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: '/icon-192.png',
  },
  robots: {
    index: false,
    follow: false,
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#10B981',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="fr">
      <body className={`${inter.className} h-screen-safe flex flex-col`}>
        <div className="flex-1 min-h-0 overflow-y-auto">
          <ToastProvider>{children}</ToastProvider>
        </div>
        {/* Assistant de consultation des devis (lecture seule), flottant global.
            Masqué sur /login via AssistantGate. */}
        <AssistantGate />
      </body>
    </html>
  )
}
