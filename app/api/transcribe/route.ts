import { NextResponse } from 'next/server'
import { transcrireAudio, reponctuer } from '@/lib/transcription'

// Mode démo ATG : pas de check d'auth.
// Lot 2 : transcription Whisper (prompt metier + temperature 0), puis passe de
// reponctuation prudente (majuscules/ponctuation/accents) garde-fou-protegee
// (jamais de mot, terme technique ou mesure altere ; sinon retour au brut).
export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const audioFile = formData.get('audio') as File
    if (!audioFile) return NextResponse.json({ error: 'No audio file' }, { status: 400 })

    const brut = await transcrireAudio(audioFile)
    const texte = await reponctuer(brut)

    return NextResponse.json({ text: texte })
  } catch {
    return NextResponse.json({ error: 'Transcription failed' }, { status: 500 })
  }
}
