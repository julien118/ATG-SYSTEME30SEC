// Helper PUR de reordonnancement des sections de la proposition technique.
// Extrait dans un module neutre (zero React) pour etre teste hors-ligne ET
// reutilise par l'editeur de devis (fleches monter/descendre + glisser-deposer).
// L'ordre des sections = ordre du tableau SectionDevis[] (aucun champ position) ;
// reordonner = deplacer un element du tableau, puis persister tel quel (JSONB).
import type { SectionDevis } from './types'

// Deplace l'element d'index `from` vers `to` (immutable). No-op si indices egaux
// ou hors bornes : on renvoie alors LE MEME tableau (reference ===), ce qui permet
// a l'appelant de detecter l'absence de changement (et d'eviter une persistance
// inutile) par simple comparaison de reference.
export function deplacerSection(
  arr: SectionDevis[],
  from: number,
  to: number,
): SectionDevis[] {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= arr.length ||
    to >= arr.length
  ) {
    return arr
  }
  const copie = arr.slice()
  const [item] = copie.splice(from, 1)
  copie.splice(to, 0, item)
  return copie
}
