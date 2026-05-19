import { NextResponse } from 'next/server'
import Groq from 'groq-sdk'

// Mode démo ATG : pas de check d'auth.
export async function POST(request: Request) {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
  try {
    const formData = await request.formData()
    const audioFile = formData.get('audio') as File
    if (!audioFile) return NextResponse.json({ error: 'No audio file' }, { status: 400 })

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 25000)
    const transcription = await groq.audio.transcriptions.create(
      {
        file: audioFile,
        model: 'whisper-large-v3-turbo',
        language: 'fr',
        response_format: 'json',
      },
      { signal: controller.signal }
    )
    clearTimeout(timeout)

    return NextResponse.json({ text: transcription.text })
  } catch {
    return NextResponse.json({ error: 'Transcription failed' }, { status: 500 })
  }
}
