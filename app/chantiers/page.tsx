import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import LogoLink from '@/components/LogoLink'
import UserMenu from '@/components/UserMenu'
import ChantiersList from './chantiers-list'
import type { Profile, Chantier } from '@/lib/types'

export default async function ChantiersPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/inscription')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  // Fallback profile if trigger didn't create one
  const safeProfile: Profile = profile ? (profile as Profile) : {
    id: user.id,
    prenom: user.user_metadata?.prenom ?? '',
    nom: user.user_metadata?.nom ?? '',
    telephone: null,
    metier: null,
    entreprise: null,
    rapports_generes: 0,
    created_at: new Date().toISOString(),
  }

  const { data: chantiers } = await supabase
    .from('chantiers')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  return (
    <div className="min-h-screen-safe bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white border-b border-border px-5 py-4 pt-safe flex items-center justify-between">
        <LogoLink width={110} height={26} />
        <UserMenu
          prenom={safeProfile.prenom}
          nom={safeProfile.nom}
        />
      </header>

      {/* Content */}
      <main className="px-5 py-4 max-w-2xl mx-auto page-enter">
        <ChantiersList
          chantiers={(chantiers as Chantier[]) ?? []}
          profile={safeProfile}
        />
      </main>

      {/* Footer */}
      <footer className="px-5 pb-6 max-w-2xl mx-auto">
        <a href="https://ionnyx.fr/" className="text-xs text-primary hover:underline">
          ← Voir le site IONNYX
        </a>
      </footer>
    </div>
  )
}
