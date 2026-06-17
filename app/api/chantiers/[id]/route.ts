import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { ATG_USER_ID } from '@/lib/atg'
import { reportError } from '@/lib/monitoring'
import { createAdminClient } from '@/lib/supabase/admin'

// Mode démo ATG : pas de check d'auth, RLS désactivée côté DB.
// On garde toutefois la vérification que le chantier appartient bien
// à ATG_USER_ID pour éviter les suppressions croisées.

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
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

  const chantierId = params.id

  // Vérifie que le chantier existe et appartient au user démo.
  const { data: chantier } = await supabase
    .from('chantiers')
    .select('id, user_id')
    .eq('id', chantierId)
    .single()

  if (!chantier || chantier.user_id !== ATG_USER_ID) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Get capture items to cleanup storage
  const { data: captures } = await supabase
    .from('capture_items')
    .select('type, photo_url, audio_url')
    .eq('chantier_id', chantierId)

  // Cleanup storage files
  if (captures && captures.length > 0) {
    const photoFiles = captures
      .filter((c) => c.type === 'photo' && c.photo_url)
      .map((c) => {
        const url = new URL(c.photo_url!)
        const path = url.pathname.split('/storage/v1/object/public/photos/')[1]
        return path
      })
      .filter(Boolean)

    const audioFiles = captures
      .filter((c) => c.type === 'vocal' && c.audio_url)
      .map((c) => {
        try {
          const url = new URL(c.audio_url!)
          const path = url.pathname.split('/storage/v1/object/sign/audio/')[1]?.split('?')[0]
            || url.pathname.split('/storage/v1/object/public/audio/')[1]
          return path
        } catch { return null }
      })
      .filter(Boolean) as string[]

    if (photoFiles.length > 0) {
      await supabase.storage.from('photos').remove(photoFiles)
    }
    if (audioFiles.length > 0) {
      await supabase.storage.from('audio').remove(audioFiles)
    }
  }

  // Nettoie le PDF du compte rendu dans le bucket `rapports` (chemin deterministe
  // `<chantierId>.pdf`, cf persistRapportPdf). La cascade DB supprime la LIGNE
  // rapports, mais pas le FICHIER storage : sans ce nettoyage, le PDF resterait
  // orphelin. On utilise le client ADMIN (service_role) car ce bucket est ecrit
  // par le service_role (l'anon n'a pas forcement le droit d'y supprimer).
  // Best-effort : un echec ici ne bloque pas la suppression du chantier.
  try {
    const admin = createAdminClient()
    await admin.storage.from('rapports').remove([`${chantierId}.pdf`])
  } catch {
    // Silencieux : le PDF orphelin n'empeche rien, on n'echoue pas la suppression.
  }

  // Delete chantier (cascades to capture_items, rapports et devis)
  const { error } = await supabase
    .from('chantiers')
    .delete()
    .eq('id', chantierId)

  if (error) {
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
  } catch (e) {
    await reportError('Suppression de chantier', e)
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }
}
