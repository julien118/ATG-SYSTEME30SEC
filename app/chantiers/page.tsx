import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import LogoLink from '@/components/LogoLink'
import ChantiersList from './chantiers-list'
import { ATG_USER_ID, ATG_PROFIL } from '@/lib/atg'
import type { Profile, Chantier } from '@/lib/types'

// Mode démo ATG : pas d'auth, on lit le profile et les chantiers
// avec un user_id en dur (ATG_USER_ID).
export default async function ChantiersPage() {
  const supabase = createClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', ATG_USER_ID)
    .single()

  // Fallback : si la migration n'a pas créé le row profiles, on prend
  // celui défini en dur dans lib/atg.ts pour ne pas bloquer la démo.
  const safeProfile: Profile = profile ? (profile as Profile) : ATG_PROFIL

  // Chargement des chantiers via le client anon (inchange, fonctionne deja).
  const { data: rows } = await supabase
    .from('chantiers')
    .select('*')
    .eq('user_id', ATG_USER_ID)
    .order('created_at', { ascending: false })

  // Existence d'un devis par chantier (etape C) : le client anon NE LIT PAS la
  // table devis, on utilise donc l'admin UNIQUEMENT pour ce SELECT en lecture
  // (un seul GET de tous les chantier_id ayant un devis). Sert au routing
  // "Continuer mon devis". Aucune ecriture.
  const admin = createAdminClient()
  const { data: devisRows } = await admin.from('devis').select('chantier_id')
  const chantiersAvecDevis = new Set((devisRows ?? []).map((d) => d.chantier_id as string))

  const chantiers = (rows ?? []).map((r: Chantier) => ({
    ...r,
    aDevis: chantiersAvecDevis.has(r.id),
  }))

  return (
    <div className="min-h-screen-safe bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white border-b border-border px-5 py-4 pt-safe flex items-center justify-between">
        <LogoLink width={110} height={26} />
        <div className="text-sm text-gray-500">
          {safeProfile.prenom} {safeProfile.nom}
        </div>
      </header>

      {/* Content */}
      <main className="px-5 py-4 max-w-2xl mx-auto page-enter">
        <p className="mb-5 text-sm text-gray-500">
          Du chantier au devis, sans rien retaper.
        </p>
        <ChantiersList
          chantiers={chantiers}
          profile={safeProfile}
        />
      </main>

      {/* Footer */}
      <footer className="px-5 pb-6 max-w-2xl mx-auto">
        <p className="text-xs text-gray-400 text-center">
          Propulsé par{' '}
          <a
            href="https://ionnyx.fr"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-primary transition-colors"
          >
            IONNYX
          </a>
        </p>
      </footer>
    </div>
  )
}
