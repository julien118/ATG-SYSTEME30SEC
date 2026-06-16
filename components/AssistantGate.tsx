'use client'

import { usePathname } from 'next/navigation'
import AssistantDevis from './AssistantDevis'

// L'assistant flottant interroge des API protégées : inutile (et trompeur)
// sur la page de connexion. On ne le monte donc pas sur /login.
export default function AssistantGate() {
  const pathname = usePathname()
  if (pathname === '/login') return null
  return <AssistantDevis />
}
