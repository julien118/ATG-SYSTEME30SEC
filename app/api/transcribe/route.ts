import { NextResponse } from 'next/server'
import { transcrireAudio } from '@/lib/transcription'

// Mode démo ATG : pas de check d'auth.
// Lot 2.1 : transcription Whisper via le helper partage (prompt metier + temperature 0).
export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const audioFile = formData.get('audio') as File
    if (!audioFile) return NextResponse.json({ error: 'No audio file' }, { status: 400 })

    const text = await transcrireAudio(audioFile)

    return NextResponse.json({ text })
  } catch {
    return NextResponse.json({ error: 'Transcription failed' }, { status: 500 })
  }
}
