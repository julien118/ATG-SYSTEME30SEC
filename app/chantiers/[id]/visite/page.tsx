import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import VisiteClient from './visite-client'
import type { Chantier, CaptureItem, Profile } from '@/lib/types'

export default async function VisitePage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/inscription')

  const { data: chantier } = await supabase
    .from('chantiers')
    .select('*')
    .eq('id', params.id)
    .eq('user_id', user.id)
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
    .eq('id', user.id)
    .single()

  return (
    <VisiteClient
      chantier={chantier as Chantier}
      initialCaptures={(captures as CaptureItem[]) ?? []}
      profile={profile as Profile}
      userId={user.id}
    />
  )
}
