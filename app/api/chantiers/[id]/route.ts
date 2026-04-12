import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

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

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const chantierId = params.id

  // Verify ownership
  const { data: chantier } = await supabase
    .from('chantiers')
    .select('id, user_id')
    .eq('id', chantierId)
    .single()

  if (!chantier || chantier.user_id !== user.id) {
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

  // Delete chantier (cascades to capture_items and rapports)
  const { error } = await supabase
    .from('chantiers')
    .delete()
    .eq('id', chantierId)

  if (error) {
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }
}
