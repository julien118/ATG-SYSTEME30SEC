import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import ToastProvider from '@/components/ToastProvider'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'IONNYX — Générez vos rapports de visite en 30 secondes',
  description: 'Prenez des photos, dictez vos observations sur le chantier. L\'IA génère automatiquement un rapport de visite professionnel. Testez gratuitement.',
  manifest: '/manifest.json',
  metadataBase: new URL('https://demo.ionnyx.fr'),
  openGraph: {
    title: 'IONNYX — Assistant de Visite Terrain',
    description: 'Prenez des photos, dictez vos observations. L\'IA génère votre rapport de visite en 30 secondes. 2 rapports gratuits pour tester.',
    url: 'https://demo.ionnyx.fr',
    siteName: 'IONNYX',
    locale: 'fr_FR',
    type: 'website',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'IONNYX — Assistant de Visite Terrain',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'IONNYX — Rapports de visite IA en 30 secondes',
    description: 'Photos + observations vocales → rapport professionnel automatique. Testez gratuitement.',
    images: ['/og-image.png'],
  },
  icons: {
    icon: [
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: '/icon-192.png',
  },
  robots: {
    index: true,
    follow: true,
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
      <body className={inter.className}>
        <div className="w-full bg-primary text-white text-center text-sm font-medium sticky top-0 z-50" style={{padding: '10px 16px'}}>
          Version de démo. Ce n&apos;est pas un logiciel. Sur mesure pour chaque entreprise.
        </div>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  )
}
