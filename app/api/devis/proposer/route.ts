// =============================================================
// POST /api/devis/proposer
// =============================================================
// Body : { chantierId }
// Lit les capture_items vocaux (transcriptions) + la bibliotheque_costructor,
// appelle quote-proposer, upsert un row devis avec sections_proposees,
// retourne { devisId, sections }.

import { NextResponse } from 'next/server'
import { proposerDevis } from '@/lib/quote-proposer'
import { ATG_USER_ID } from '@/lib/atg'
import { createAdminClient } from '@/lib/supabase/admin'
import { selectionnerModele, type ModeleDevis } from '@/lib/atg-routing'
import {
  deriverSectionsDepuisModele,
  extraireMetres,
  getModeleExpand,
  listerModeles,
} from '@/lib/atg-devis-modele'
import type {
  ArticleBibliotheque,
  CaptureItem,
  ModeleSnapshot,
  MoteurDevis,
  SectionDevis,
} from '@/lib/types'

export async function POST(request: Request) {
  try {
    const { chantierId, regenerer } = (await request.json()) as {
      chantierId?: string
      regenerer?: boolean
    }
    if (!chantierId) {
      return NextResponse.json({ error: 'chantierId manquant' }, { status: 400 })
    }

    // Bypass RLS pour lire/écrire toutes les tables (mode démo, single-tenant).
    const supabase = createAdminClient()

    // Vérifie l'appartenance du chantier au user démo ATG.
    const { data: chantier, error: errC } = await supabase
      .from('chantiers')
      .select('id, user_id, client_nom')
      .eq('id', chantierId)
      .eq('user_id', ATG_USER_ID)
      .single()
    if (errC || !chantier) {
      return NextResponse.json({ error: 'Chantier introuvable' }, { status: 404 })
    }

    // GARDE ANTI-PERTE (etape C) : si un devis existe deja pour ce chantier, on NE
    // regenere PAS — sinon on ecraserait le travail d'Olivier (metres, ajustements,
    // remplacements d'articles). On renvoie le devis existant tel quel, SANS toucher
    // a sections_finales et SANS appeler Claude. La regeneration n'a lieu que si elle
    // est demandee EXPLICITEMENT (regenerer === true). Filet serveur, en plus de l'UI.
    if (!regenerer) {
      const { data: existant } = await supabase
        .from('devis')
        .select('id, sections_finales, sections_proposees')
        .eq('chantier_id', chantierId)
        .maybeSingle()
      if (existant) {
        return NextResponse.json({
          devisId: existant.id,
          sections: existant.sections_finales ?? existant.sections_proposees ?? [],
          reutilise: true,
        })
      }
    }

    // Récupère les transcriptions vocales du chantier.
    const { data: captures, error: errCap } = await supabase
      .from('capture_items')
      .select('transcription, type')
      .eq('chantier_id', chantierId)
      .eq('type', 'vocal')
      .order('position', { ascending: true })
    if (errCap) throw errCap

    const transcriptions = (captures as CaptureItem[])
      .map((c) => c.transcription)
      .filter((t): t is string => Boolean(t && t.trim()))

    if (transcriptions.length === 0) {
      return NextResponse.json(
        { error: 'Aucune observation vocale sur ce chantier' },
        { status: 400 },
      )
    }

    // ---------- Aiguillage moteur (commit 2) ----------
    // On concatene les dictees et on laisse selectionnerModele trancher la
    // famille. ITE confiant (haute/moyenne) + modele ITE exploitable -> moteur
    // de CLONAGE : on lit le modele (GET compte test, la replique du modele
    // d'Olivier ; la lecture du vrai compte Olivier viendra au commit 4), on
    // fige son snapshot, et on DERIVE des SectionDevis depuis lui. Sinon ->
    // repli sur le moteur PLAT actuel (fail-safe : ravalement, famille inconnue,
    // confiance basse, pas de modele, aucune facade detectee, ou toute erreur
    // de lecture). Le format de sortie reste SectionDevis[] dans les deux cas :
    // le recap et la saisie des metres d'Olivier ne changent pas (Approche A).
    const dicteeComplete = transcriptions.join('\n\n')
    let clonage: {
      sections: SectionDevis[]
      modeleId: string
      snapshot: ModeleSnapshot
    } | null = null
    try {
      const modelesRaw = await listerModeles()
      const modeles: ModeleDevis[] = modelesRaw.map((m: any) => ({
        id: m.id,
        name: m.name ?? null,
        description: m.description ?? null,
        total: m.total ?? null,
        model: !!m.model,
      }))
      const routage = selectionnerModele(dicteeComplete, modeles)
      // On declenche le clonage sur une famille ITE FRANCHE (forte marge de
      // famille) + un modele ITE trouve, et NON sur la confiance globale : cette
      // derniere exige un modele unique et retombe a 'basse' sur les repliques
      // identiques du compte test (piste A). margeFamille est le vrai signal de
      // securite ; le seuil franc (>= 2) evite de declencher sur un ITE incertain.
      const iteConfiant =
        routage.famille === 'ite' &&
        routage.margeFamille >= 2 &&
        !!routage.modeleId
      if (iteConfiant) {
        const modele = await getModeleExpand(routage.modeleId as string)
        // Detection des facades depuis la dictee (on n'en garde que les NOMS :
        // les quantites seront saisies par Olivier au recap, Approche A).
        const metres = await extraireMetres(dicteeComplete)
        const nomsFacades = metres.facades
          .map((f) => (f.nom ?? '').trim())
          .filter((n) => n.length > 0)
        if (nomsFacades.length > 0) {
          const sectionsClonage = deriverSectionsDepuisModele(
            modele.lines ?? [],
            nomsFacades,
          )
          if (sectionsClonage.length > 0) {
            clonage = {
              sections: sectionsClonage,
              modeleId: routage.modeleId as string,
              snapshot: {
                id: modele.id ?? null,
                subtotal: modele.subtotal ?? null,
                lines: modele.lines ?? [],
              },
            }
          }
        }
      }
      console.log(
        `[api/devis/proposer] aiguillage : famille=${routage.famille} confiance=${routage.confiance} -> ${
          clonage ? 'CLONAGE' : 'moteur plat'
        } (${routage.raison})`,
      )
    } catch (e) {
      console.warn('[api/devis/proposer] aiguillage clonage echoue, repli plat :', e)
      clonage = null
    }

    // Champs moteur a persister selon l'aiguillage (le push reste plat tant que
    // le commit 3 n'est pas la ; ces champs ne sont encore lus par aucune route).
    const champsMoteur: {
      moteur: MoteurDevis
      modele_id: string | null
      modele_snapshot: ModeleSnapshot | null
    } = clonage
      ? { moteur: 'clonage', modele_id: clonage.modeleId, modele_snapshot: clonage.snapshot }
      : { moteur: 'plat', modele_id: null, modele_snapshot: null }

    // ---------- Sections de proposition ----------
    let sections: SectionDevis[]
    if (clonage) {
      sections = clonage.sections
    } else {
      // Moteur plat (INCHANGE) : bibliotheque seedee + IA.
      const { data: biblio, error: errB } = await supabase
        .from('bibliotheque_costructor')
        .select('*')
      if (errB) throw errB

      const bibliotheque = (biblio as ArticleBibliotheque[]) ?? []
      if (bibliotheque.length === 0) {
        return NextResponse.json(
          { error: 'Bibliothèque Costructor vide en DB' },
          { status: 500 },
        )
      }

      sections = await proposerDevis(transcriptions, bibliotheque)

      if (sections.length === 0) {
        return NextResponse.json(
          { error: 'Aucune section produite par l\'IA (toutes filtrées)' },
          { status: 422 },
        )
      }
    }

    // Upsert : si un devis existe déjà pour ce chantier, on le remplace.
    const { data: existant } = await supabase
      .from('devis')
      .select('id')
      .eq('chantier_id', chantierId)
      .maybeSingle()

    let devisId: string
    if (existant) {
      const { error } = await supabase
        .from('devis')
        .update({
          sections_proposees: sections,
          sections_finales: sections,
          statut: 'sections_proposees',
          total_ht: null,
          total_ttc: null,
          costructor_devis_id: null,
          costructor_devis_url: null,
          pousse_le: null,
          erreur_push: null,
          // Moteur de generation (reset a chaque regeneration : si une dictee
          // passe d'ITE a ravalement, on repasse proprement de clonage a plat).
          ...champsMoteur,
        })
        .eq('id', existant.id)
      if (error) throw error
      devisId = existant.id
    } else {
      const { data: cree, error } = await supabase
        .from('devis')
        .insert({
          chantier_id: chantierId,
          sections_proposees: sections,
          sections_finales: sections,
          statut: 'sections_proposees',
          ...champsMoteur,
        })
        .select('id')
        .single()
      if (error || !cree) throw error
      devisId = cree.id
    }

    return NextResponse.json({ devisId, sections })
  } catch (e) {
    console.error('[api/devis/proposer]', e)
    return NextResponse.json(
      { error: (e as Error).message ?? 'Erreur proposition devis' },
      { status: 500 },
    )
  }
}
