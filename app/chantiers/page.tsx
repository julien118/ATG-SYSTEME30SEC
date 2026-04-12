import { redirect } from 'next/navigation'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/server'
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

  const { data: chantiers } = await supabase
    .from('chantiers')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white border-b border-border px-4 py-3 flex items-center justify-between">
        <Image
          src="/logo-ionnyx.png"
          alt="IONNYX"
          width={110}
          height={26}
        />
        <UserMenu
          prenom={(profile as Profile)?.prenom ?? ''}
          nom={(profile as Profile)?.nom ?? ''}
        />
      </header>

      {/* Content */}
      <main className="px-4 py-4 max-w-2xl mx-auto">
        <ChantiersList
          chantiers={(chantiers as Chantier[]) ?? []}
          profile={profile as Profile}
        />
      </main>
    </div>
  )
}
