import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { anthropic, MODELE_CLAUDE } from '@/lib/anthropic'
import { SYSTEM_PROMPT, buildUserPrompt } from '@/lib/prompts'
import { ATG_USER_ID } from '@/lib/atg'
import { persistRapportPdf } from '@/lib/rapport-pdf'
import { nettoyerRapportContenu } from '@/lib/utils'
import { reportError } from '@/lib/monitoring'
import type { Chantier, CaptureItem, RapportContenu } from '@/lib/types'

// Mode démo ATG : pas de check d'auth, pas de limite "2 rapports".
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

  // `consignes` (amelioration 11) : consignes de modification optionnelles pour
  // une regeneration. Absent/vide => generation identique a aujourd'hui.
  const { chantierId, consignes } = (await request.json()) as {
    chantierId: string
    consignes?: string | null
  }

  // Vérifie l'appartenance au user démo (RLS off, mais on garde le filtre).
  const { data: chantier } = await supabase
    .from('chantiers')
    .select('*')
    .eq('id', chantierId)
    .eq('user_id', ATG_USER_ID)
    .single()

  if (!chantier) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Détecte une régénération (rapport déjà existant).
  const { data: existingRapport } = await supabase
    .from('rapports')
    .select('id')
    .eq('chantier_id', chantierId)
    .single()

  const isRegeneration = !!existingRapport

  // Get captures
  const { data: captures } = await supabase
    .from('capture_items')
    .select('*')
    .eq('chantier_id', chantierId)
    .order('position', { ascending: true })

  if (!captures || captures.length === 0) {
    return NextResponse.json({ error: 'No captures found' }, { status: 400 })
  }

  // Build prompt (avec les consignes de modification si fournies, amelioration 11).
  const userPrompt = buildUserPrompt(chantier as Chantier, captures as CaptureItem[], consignes)

  // Call Claude
  const response = await anthropic.messages.create({
    model: MODELE_CLAUDE,
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

  // Garde-fou (lot 1.5) : on retire tout gras Markdown (**) que l'IA aurait pu
  // glisser, AVANT de stocker. Le texte stocke reste donc propre, en lecture
  // comme en edition. Prudent : ne touche qu'aux marques de gras a double
  // asterisque, pas au reste du texte.
  const rapportNettoye = nettoyerRapportContenu(rapport)

  // Upsert rapport
  if (isRegeneration) {
    await supabase
      .from('rapports')
      .update({ contenu_json: rapportNettoye, updated_at: new Date().toISOString() })
      .eq('chantier_id', chantierId)
  } else {
    await supabase
      .from('rapports')
      .insert({ chantier_id: chantierId, contenu_json: rapportNettoye })
  }

  // Le statut "Généré" (rapport_genere) n'est PLUS posé ici : il se déclenche
  // désormais a l'arrivee sur l'etape Costructor (ecran recap). Pendant le compte
  // rendu, la proposition technique et les metres, le chantier reste "termine"
  // (affiche "En cours"). Cf. lot 1.1 des ameliorations.

  // Persiste le PDF dans le Storage et stocke son URL stable (Phase G, etape 1).
  // En cas d'echec storage, on ne casse pas la generation du compte rendu : on
  // logge et on continue (le PDF reste regenerable a la volee via /api/export-pdf).
  let pdfUrl: string | null = null
  try {
    const persist = await persistRapportPdf(chantierId)
    pdfUrl = persist.url
  } catch (e) {
    console.error('[api/generate-report] persistRapportPdf:', (e as Error).message)
  }

  return NextResponse.json({ rapport: rapportNettoye, pdf_url: pdfUrl })
  } catch (e) {
    // Sans ce log, l'erreur etait avalee : invisible dans les Runtime Logs Vercel
    // (c'est ce qui a complique le diagnostic de la retraite du modele Claude).
    console.error('[api/generate-report]', e)
    await reportError('Génération de rapport', e)
    return NextResponse.json({ error: 'Report generation failed' }, { status: 500 })
  }
}
