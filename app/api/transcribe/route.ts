import { NextResponse } from 'next/server'
import { transcrireAudio, reponctuer, nettoyerDictee } from '@/lib/transcription'
import { reportError } from '@/lib/monitoring'

// Mode démo ATG : pas de check d'auth.
// Lot 2 : transcription Whisper (prompt metier + temperature 0), puis :
//  - défaut (notes de visite / assistant) : reponctuation prudente garde-fou-protegee
//    (jamais de mot, terme technique ou mesure altere ; sinon retour au brut) ;
//  - mode=support (tickets « Demander à Julien ») : nettoyage des mots parasites
//    (« euh », « bah »...) pour un message lisible (pas de garde-fou de fidelite).
export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const audioFile = formData.get('audio') as File
    if (!audioFile) return NextResponse.json({ error: 'No audio file' }, { status: 400 })
    const url = new URL(request.url)
    const support =
      url.searchParams.get('mode') === 'support' || formData.get('mode') === 'support'

    const brut = await transcrireAudio(audioFile)
    const texte = support ? await nettoyerDictee(brut) : await reponctuer(brut)

    return NextResponse.json({ text: texte })
  } catch (e) {
    await reportError('Transcription vocale', e)
    return NextResponse.json({ error: 'Transcription failed' }, { status: 500 })
  }
}
