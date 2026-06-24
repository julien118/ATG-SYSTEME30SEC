'use client'

import { usePathname } from 'next/navigation'
import AssistantTicket from './AssistantTicket'

// Le bouton "Demander à Julien" interroge des API protégées : inutile (et
// trompeur) sur la page de connexion. On ne le monte donc pas sur /login.
export default function TicketGate() {
  const pathname = usePathname()
  if (pathname === '/login') return null
  return <AssistantTicket />
}
