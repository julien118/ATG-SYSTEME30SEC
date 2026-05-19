import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import VisiteClient from './visite-client'
import { ATG_USER_ID, ATG_PROFIL } from '@/lib/atg'
import type { Chantier, CaptureItem, Profile } from '@/lib/types'

export default async function VisitePage({ params }: { params: { id: string } }) {
  const supabase = createClient()

  const { data: chantier } = await supabase
    .from('chantiers')
    .select('*')
    .eq('id', params.id)
    .eq('user_id', ATG_USER_ID)
    .single()

  if (!chantier) redirect('/chantiers')

  const { data: captures } = await supabase
    .from('capture_items')
    .select('*')
    .eq('chantier_id', params.id)
    .order('position', { ascending: true })

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', ATG_USER_ID)
    .single()

  const safeProfile: Profile = profile ? (profile as Profile) : ATG_PROFIL

  return (
    <VisiteClient
      chantier={chantier as Chantier}
      initialCaptures={(captures as CaptureItem[]) ?? []}
      profile={safeProfile}
      userId={ATG_USER_ID}
    />
  )
}
