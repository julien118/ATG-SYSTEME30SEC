import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import LogoLink from '@/components/LogoLink'
import LogoutButton from '@/components/LogoutButton'
import AssistantTicket from '@/components/AssistantTicket'
import ChantiersList from './chantiers-list'
import { ATG_USER_ID, ATG_PROFIL } from '@/lib/atg'
import { deriverStatutAffiche } from '@/lib/statut-affaire'
import type { Profile, Chantier, DevisStatut } from '@/lib/types'

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

  // Etat complet par chantier (statut du chantier + existence du compte rendu +
  // statut du devis) en UNE seule requete admin avec embedding (pas de N+1). Admin
  // car l'anon ne lit ni la table devis ni l'embed rapports (RLS). Lecture seule.
  const admin = createAdminClient()
  const { data: rows } = await admin
    .from('chantiers')
    .select('*, devis(statut, cree_le), rapports(id)')
    .eq('user_id', ATG_USER_ID)
    .order('created_at', { ascending: false })

  // Statut affiche (parmi 5) derive par chantier via la source de verite unique
  // (lib/statut-affaire). On retient le devis le plus recent si plusieurs.
  // `devis` est une relation to-many (tableau, 0..n) ; `rapports` est une relation
  // to-ONE (contrainte UNIQUE sur chantier_id) donc remontee en OBJET (ou null) par
  // PostgREST, pas en tableau.
  const chantiers = (rows ?? []).map(
    (r: Chantier & {
      devis?: { statut: DevisStatut; cree_le: string }[]
      rapports?: { id: string } | null
    }) => {
      const devisRecent = [...(r.devis ?? [])].sort((a, b) =>
        (b.cree_le ?? '').localeCompare(a.cree_le ?? ''),
      )[0]
      const statutAffiche = deriverStatutAffiche({
        chantierStatut: r.statut,
        aCompteRendu: r.rapports != null,
        devisStatut: devisRecent?.statut ?? null,
      })
      return { ...r, statutAffiche }
    },
  )

  return (
    <div className="min-h-screen-safe bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-header border-b border-white/10 px-5 py-4 pt-safe flex items-center justify-between">
        <LogoLink width={110} height={26} />
        <div className="flex items-center gap-3">
          <AssistantTicket />
          {/* Nom + déconnexion : masqués sur téléphone (gain de place), visibles
              sur ordinateur (sm:). Le bouton « ? » reste visible partout. */}
          <div className="hidden sm:flex items-center gap-3">
            <span className="text-sm text-gray-200">
              {safeProfile.prenom} {safeProfile.nom}
            </span>
            <LogoutButton />
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="px-5 py-4 max-w-2xl mx-auto page-enter">
        <ChantiersList
          chantiers={chantiers}
          profile={safeProfile}
        />
      </main>

      {/* Footer — signature produit : nom (un cran plus visible) + attribution IONNYX */}
      <footer className="px-5 pb-6 max-w-2xl mx-auto text-center">
        <p className="text-sm font-medium text-gray-500">Système 30 Secondes</p>
        <p className="mt-0.5 text-xs text-gray-400">
          par{' '}
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
