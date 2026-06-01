import type { ChantierStatut } from '@/lib/types'

// Trois statuts affiches : Planifié (bleu), En cours (ambre), Généré (vert).
// `termine` (visite finie mais devis pas encore arrive a l'etape Costructor) est
// rendu a l'identique de `en_cours` : pour Olivier, c'est toujours "En cours".
const CONFIG: Record<ChantierStatut, { label: string; icon: string; className: string }> = {
  planifie: {
    label: 'Planifié',
    icon: '📅',
    className: 'bg-blue-50 text-blue-700',
  },
  en_cours: {
    label: 'En cours',
    icon: '🔨',
    className: 'bg-amber-50 text-amber-700',
  },
  termine: {
    label: 'En cours',
    icon: '🔨',
    className: 'bg-amber-50 text-amber-700',
  },
  rapport_genere: {
    label: 'Généré',
    icon: '✅',
    className: 'bg-emerald-50 text-emerald-700',
  },
}

export default function StatusBadge({ statut }: { statut: ChantierStatut }) {
  const { label, icon, className } = CONFIG[statut]

  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${className}`}>
      <span>{icon}</span>
      {label}
    </span>
  )
}
