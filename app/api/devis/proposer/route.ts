// =============================================================
// POST /api/devis/proposer
// =============================================================
// Body : { chantierId }
// Lit les capture_items vocaux (transcriptions) + la bibliotheque_costructor,
// appelle quote-proposer, upsert un row devis avec sections_proposees,
// retourne { devisId, sections }.

import { NextResponse } from 'next/server'
import { proposerDevis } from '@/lib/quote-proposer'
import { listerArticlesBibliotheque } from '@/lib/costructor'
import { ATG_USER_ID } from '@/lib/atg'
import { createAdminClient } from '@/lib/supabase/admin'
import { choisirModele, type ModeleDevis } from '@/lib/atg-routing'
import {
  compteCibleCostructor,
  deriverSectionsDepuisModele,
  extraireMetres,
  lireModeleExpand,
  listerModelesCible,
} from '@/lib/atg-devis-modele'
import type {
  CaptureItem,
  ModeleSnapshot,
  MoteurDevis,
  SectionDevis,
} from '@/lib/types'

export async function POST(request: Request) {
  try {
    const { chantierId, regenerer, modeleId: modeleIdChoisi } = (await request.json()) as {
      chantierId?: string
      regenerer?: boolean
      // Modèle imposé par Olivier via le sélecteur (override de l'auto-détection).
      modeleId?: string
    }
    if (!chantierId) {
      return NextResponse.json({ error: 'chantierId manquant' }, { status: 400 })
    }

    // Bypass RLS pour lire/écrire toutes les tables (mode démo, single-tenant).
    const supabase = createAdminClient()

    // Vérifie l'appartenance du chantier au user démo ATG.
    const { data: chantier, error: errC } = await supabase
      .from('chantiers')
      .select('id, user_id, client_nom, objet_travaux')
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
    // Switch de modèle explicite (modeleIdChoisi) = re-dérivation volontaire
    // (l'UI confirme côté Olivier avant d'écraser d'éventuels métrés).
    if (!regenerer && !modeleIdChoisi) {
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

    // ---------- Sélection + clonage du modèle (généralisé à TOUTES les typologies) ----------
    // On ne réplique plus seulement l'ITE : pour CHAQUE type de travaux, on
    // reconnaît le modèle d'Olivier correspondant (choisirModele, score sur le
    // NOM/description — robuste à ses renommages) et on le CLONE fidèlement : son
    // ORDRE, ses postes systématiques (lavage, algicide/fongicide...), descriptions
    // et TVA ligne par ligne. Le modèle est lu EN DIRECT (GET sur le compte cible),
    // donc toute modif d'Olivier dans Costructor est reflétée au prochain devis,
    // sans rien à synchroniser. L'override `modeleIdChoisi` (sélecteur hybride)
    // prime sur l'auto-détection. L'IA générique (moteur plat) ne sert plus que de
    // DERNIER filet si AUCUN modèle ne correspond. Format de sortie inchangé
    // (SectionDevis[]) : récap, métrés et édition d'Olivier ne changent pas.
    const dicteeComplete = transcriptions.join('\n\n')
    const signal = `${chantier.objet_travaux ?? ''}\n${dicteeComplete}`

    let clonage: {
      sections: SectionDevis[]
      modeleId: string
      libelle: string | null
      snapshot: ModeleSnapshot
    } | null = null
    let modelesDisponibles: Array<{ id: string; libelle: string }> = []
    try {
      const modelesRaw = await listerModelesCible()
      const modeles: ModeleDevis[] = modelesRaw.map((m: any) => ({
        id: m.id,
        name: m.name ?? null,
        description: m.description ?? null,
        total: m.total ?? null,
        model: !!m.model,
      }))
      const choix = choisirModele(signal, modeles)
      modelesDisponibles = choix.modelesDisponibles

      // Modèle effectif : l'override explicite d'Olivier prime sur l'auto-détection
      // (et on vérifie qu'il fait bien partie des modèles exploitables).
      const modeleEffectifId =
        modeleIdChoisi && modelesDisponibles.some((m) => m.id === modeleIdChoisi)
          ? modeleIdChoisi
          : choix.modeleId

      if (modeleEffectifId) {
        const modele = await lireModeleExpand(modeleEffectifId)
        // Noms de façades depuis la dictée (quantités saisies ensuite par Olivier).
        // À défaut, une façade générique : on clone le modèle plutôt que de
        // retomber sur l'IA (Olivier renomme/duplique ensuite si besoin).
        const metres = await extraireMetres(dicteeComplete)
        let nomsFacades = metres.facades
          .map((f) => (f.nom ?? '').trim())
          .filter((n) => n.length > 0)
        if (nomsFacades.length === 0) nomsFacades = ['Façade']

        const sectionsClonage = deriverSectionsDepuisModele(modele.lines ?? [], nomsFacades)
        if (sectionsClonage.length > 0) {
          clonage = {
            sections: sectionsClonage,
            modeleId: modeleEffectifId,
            libelle:
              modelesDisponibles.find((m) => m.id === modeleEffectifId)?.libelle ?? null,
            snapshot: {
              id: modele.id ?? null,
              subtotal: modele.subtotal ?? null,
              lines: modele.lines ?? [],
              // Compte source (garde de cohérence au push) : la cible de lecture.
              compte: compteCibleCostructor(),
            },
          }
        }
      }
      console.log(
        `[api/devis/proposer] modèle="${clonage?.libelle ?? '—'}" ` +
          `(auto="${choix.libelle ?? '—'}"${modeleIdChoisi ? `, override=${modeleIdChoisi}` : ''}) ` +
          `-> ${clonage ? 'CLONAGE' : 'moteur plat'}`,
      )
    } catch (e) {
      console.warn('[api/devis/proposer] sélection/clonage échouée, repli plat :', e)
      clonage = null
    }

    // Champs moteur à persister selon la sélection (lus par le push).
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
      // Moteur plat (option B) : bibliotheque lue EN DIRECT du compte cible (la
      // cle d'ecriture = le compte vers lequel on poussera), via /products. Prix
      // et ids produits toujours a jour ; la bascule (clé d'ecriture = Olivier)
      // suffit a faire sortir les bons prix d'Olivier. On lit deliberement via la
      // cle d'ecriture et NON la cle GET d'Olivier : les product.id doivent venir
      // du meme compte que le push, sinon ils sont invalides a l'ecriture.
      const bibliotheque = await listerArticlesBibliotheque()
      if (bibliotheque.length === 0) {
        return NextResponse.json(
          { error: 'Bibliothèque Costructor vide (lecture /products)' },
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

    return NextResponse.json({
      devisId,
      sections,
      moteur: clonage ? 'clonage' : 'plat',
      modeleChoisi: clonage ? { id: clonage.modeleId, libelle: clonage.libelle } : null,
      modelesDisponibles,
    })
  } catch (e) {
    console.error('[api/devis/proposer]', e)
    return NextResponse.json(
      { error: (e as Error).message ?? 'Erreur proposition devis' },
      { status: 500 },
    )
  }
}
