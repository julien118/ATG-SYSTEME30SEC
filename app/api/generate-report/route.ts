import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { anthropic } from '@/lib/anthropic'
import { SYSTEM_PROMPT, buildUserPrompt } from '@/lib/prompts'
import type { Chantier, CaptureItem, RapportContenu } from '@/lib/types'

export async function POST(request: Request) {
  try {
  const cookieStore = cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { chantierId } = await request.json()

  // Verify ownership
  const { data: chantier } = await supabase
    .from('chantiers')
    .select('*')
    .eq('id', chantierId)
    .eq('user_id', user.id)
    .single()

  if (!chantier) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Check if this is a regeneration (rapport already exists)
  const { data: existingRapport } = await supabase
    .from('rapports')
    .select('id')
    .eq('chantier_id', chantierId)
    .single()

  const isRegeneration = !!existingRapport

  // Trial limit check (only for first generation, not regeneration)
  if (!isRegeneration) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('rapports_generes')
      .eq('id', user.id)
      .single()

    if (profile && profile.rapports_generes >= 2) {
      return NextResponse.json({ error: 'trial_limit_reached' }, { status: 403 })
    }
  }

  // Get captures
  const { data: captures } = await supabase
    .from('capture_items')
    .select('*')
    .eq('chantier_id', chantierId)
    .order('position', { ascending: true })

  if (!captures || captures.length === 0) {
    return NextResponse.json({ error: 'No captures found' }, { status: 400 })
  }

  // Build prompt
  const userPrompt = buildUserPrompt(chantier as Chantier, captures as CaptureItem[])

  // Call Claude
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  })

  // Parse response
  const responseText = response.content[0].type === 'text' ? response.content[0].text : ''
  const jsonMatch = responseText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    return NextResponse.json({ error: 'Failed to parse report' }, { status: 500 })
  }

  let rapport: RapportContenu
  try {
    rapport = JSON.parse(jsonMatch[0])
  } catch {
    return NextResponse.json({ error: 'Invalid JSON in response' }, { status: 500 })
  }

  // Photo audit: ensure ALL photos appear in the report
  const capturePhotoUrls = (captures as CaptureItem[])
    .filter((c) => c.type === 'photo' && c.photo_url)
    .map((c) => c.photo_url!)

  const reportPhotoUrls = new Set(
    rapport.observations.flatMap((obs) => obs.photos.map((p) => p.url))
  )

  const missingPhotos = capturePhotoUrls.filter((url) => !reportPhotoUrls.has(url))
  if (missingPhotos.length > 0) {
    rapport.observations.push({
      titre: 'Photos supplémentaires',
      description: 'Photos capturées lors de la visite non rattachées à une observation spécifique.',
      points_vigilance: [],
      photos: missingPhotos.map((url) => ({
        url,
        legende: 'Photo supplémentaire de la visite',
      })),
    })
  }

  // Upsert rapport
  if (isRegeneration) {
    await supabase
      .from('rapports')
      .update({ contenu_json: rapport, updated_at: new Date().toISOString() })
      .eq('chantier_id', chantierId)
  } else {
    await supabase
      .from('rapports')
      .insert({ chantier_id: chantierId, contenu_json: rapport })
  }

  // Update chantier status
  await supabase
    .from('chantiers')
    .update({ statut: 'rapport_genere' })
    .eq('id', chantierId)

  // Increment counter only on first generation
  if (!isRegeneration) {
    await supabase.rpc('increment_rapports_generes', { user_id_param: user.id })
  }

  return NextResponse.json({ rapport })
  } catch {
    return NextResponse.json({ error: 'Report generation failed' }, { status: 500 })
  }
}
