// =============================================================
// Transcode audio -> OGG/OPUS (pour un vrai message vocal Telegram)
// =============================================================
// Les navigateurs enregistrent en webm/opus (Chrome/Android) ou mp4/aac (iOS).
// Telegram n'affiche un message vocal natif (sendVoice, bulle + waveform) qu'en
// OGG/OPUS. On transcode donc côté serveur via ffmpeg-static (binaire bundlé).
// Best-effort : renvoie null sur tout échec (l'appelant retombe sur sendDocument).
//
// Importé UNIQUEMENT par app/api/tickets/route.ts pour ne pas tirer le binaire
// ffmpeg dans le bundle des autres fonctions (cf. outputFileTracingIncludes).

import ffmpegPath from 'ffmpeg-static'
import { spawn } from 'node:child_process'
import { writeFile, unlink, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export async function transcoderEnOggOpus(
  input: Buffer,
  extEntree = 'webm',
): Promise<Buffer | null> {
  if (!ffmpegPath) return null
  // Date.now/Math.random sont disponibles ici (code applicatif Node, pas workflow).
  const id = `tk-${Date.now()}-${Math.round(Math.random() * 1e9)}`
  const inPath = join(tmpdir(), `${id}.${extEntree}`)
  try {
    await writeFile(inPath, input)
    // Le binaire peut perdre le bit exécutable après bundling : on le force.
    try {
      await chmod(ffmpegPath as unknown as string, 0o755)
    } catch {
      // ignore : si chmod échoue, spawn échouera et on retombera sur null.
    }
    const args = [
      '-y',
      '-i',
      inPath,
      '-c:a',
      'libopus',
      '-b:a',
      '32k',
      '-ac',
      '1',
      '-application',
      'voip',
      '-f',
      'ogg',
      'pipe:1',
    ]
    const out = await new Promise<Buffer | null>((resolve) => {
      const ff = spawn(ffmpegPath as unknown as string, args)
      const chunks: Buffer[] = []
      ff.stdout.on('data', (d: Buffer) => chunks.push(d))
      ff.on('error', () => resolve(null))
      ff.on('close', (code) => resolve(code === 0 && chunks.length ? Buffer.concat(chunks) : null))
    })
    return out
  } catch {
    return null
  } finally {
    unlink(inPath).catch(() => {})
  }
}
