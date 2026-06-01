// =============================================================
// Idempotence du devis Costructor par chantier (Phase H)
// =============================================================
// Memorise l'id du dernier brouillon Costructor pousse pour un chantier, afin de
// le supprimer avant un re-push (chemin clone-modele) et eviter l'accumulation de
// doublons. C'est l'equivalent du devis.costructor_devis_id utilise par la route
// demo, mais utilisable par le chemin clone-modele qui ne cree pas de ligne devis.
//
// Stockage : un petit JSON par chantier dans un bucket Supabase PRIVE
// ('etat-devis'), pour ne pas dependre d'une migration de schema. Persistant
// d'un run a l'autre. A promouvoir en table dediee si besoin plus tard.

import { createAdminClient } from './supabase/admin'

const BUCKET_ETAT = 'etat-devis'

type Sb = ReturnType<typeof createAdminClient>

// Cree le bucket prive s'il n'existe pas (idempotent).
async function assurerBucket(sb: Sb): Promise<void> {
  const { data } = await sb.storage.listBuckets()
  if (!data?.some((b) => b.name === BUCKET_ETAT)) {
    await sb.storage.createBucket(BUCKET_ETAT, { public: false })
  }
}

// Lit l'id du dernier brouillon Costructor pousse pour ce chantier (ou null).
export async function lireDevisCostructorId(
  chantierId: string,
): Promise<string | null> {
  const sb = createAdminClient()
  const { data, error } = await sb.storage
    .from(BUCKET_ETAT)
    .download(`${chantierId}.json`)
  if (error || !data) return null
  try {
    const obj = JSON.parse(await data.text())
    const id = ((obj?.costructor_devis_id as string | null) ?? '').trim()
    return id || null
  } catch {
    return null
  }
}

// Memorise l'id du brouillon Costructor pousse pour ce chantier (upsert).
export async function memoriserDevisCostructorId(
  chantierId: string,
  devisId: string,
): Promise<void> {
  const sb = createAdminClient()
  await assurerBucket(sb)
  const corps = JSON.stringify({
    costructor_devis_id: devisId,
    updated_at: new Date().toISOString(),
  })
  await sb.storage
    .from(BUCKET_ETAT)
    .upload(`${chantierId}.json`, corps, {
      contentType: 'application/json',
      upsert: true,
    })
}
