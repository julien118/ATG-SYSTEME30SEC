// =============================================================
// GET /api/contacts
// =============================================================
// Liste LECTURE SEULE des contacts humains (client + lead) de Costructor,
// nettoyes pour l'autocompletion a la creation de visite (groupe C) : nom, ville,
// email, telephone, adresse. Appelle listerContactsRecherche (GET /contacts).
// AUCUNE ecriture : la creation/lien d'un contact reste au push du devis
// (trouverOuCreerContact via le garde-fou du compte test).

import { NextResponse } from 'next/server'
import { listerContactsRecherche } from '@/lib/costructor'
import { reportError } from '@/lib/monitoring'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const contacts = await listerContactsRecherche()
    return NextResponse.json({ contacts })
  } catch (e) {
    console.error('[api/contacts]', e)
    await reportError('Contacts Costructor', e)
    return NextResponse.json(
      { error: 'Impossible de charger les contacts' },
      { status: 500 },
    )
  }
}
