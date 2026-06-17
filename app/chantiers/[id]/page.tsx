import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import LogoLink from '@/components/LogoLink'
import ChantierForm from '@/components/ChantierForm'
import { ATG_USER_ID } from '@/lib/atg'
import type { Chantier } from '@/lib/types'

export default async function ChantierDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient()

  const { data: chantier } = await supabase
    .from('chantiers')
    .select('*')
    .eq('id', params.id)
    .eq('user_id', ATG_USER_ID)
    .single()

  if (!chantier) redirect('/chantiers')

  const statut = (chantier as Chantier).statut

  // Généré ou Terminé : on ouvre le compte rendu (pas le formulaire d'edition).
  if (statut === 'rapport_genere' || statut === 'termine') {
    redirect(`/chantiers/${params.id}/rapport`)
  }

  // Planifié ET En cours (tant que le rapport n'est pas genere, point 7) : on
  // reste ici, sur l'ecran contact. C'est le passage oblige ; le form propose
  // « Commencer » (planifie) ou « Continuer la visite » (en_cours). On NE redirige
  // PLUS « en_cours » vers /visite : sinon Olivier ne repasserait jamais par le
  // contact apres avoir commence ses notes.

  return (
    <div className="min-h-screen-safe bg-background">
      <header className="sticky top-0 z-30 bg-header border-b border-white/10 px-5 py-4 pt-safe flex items-center gap-3">
        <Link href="/chantiers" className="flex h-10 w-10 -ml-2 items-center justify-center rounded-lg text-gray-300 hover:text-white hover:bg-white/10 transition-colors">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>
        <LogoLink width={120} height={28} />
      </header>

      <main className="px-5 py-6 max-w-lg mx-auto">
        <h1 className="text-xl font-bold text-foreground mb-1">
          {statut === 'en_cours' ? 'Visite en cours' : 'Visite planifiée'}
        </h1>
        <p className="text-gray-400 text-sm mb-6">{(chantier as Chantier).client_nom}</p>
        <ChantierForm chantier={chantier as Chantier} userId={ATG_USER_ID} />
      </main>
    </div>
  )
}
