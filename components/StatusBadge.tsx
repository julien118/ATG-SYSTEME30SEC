import type { StatutAffiche } from '@/lib/statut-affaire'

// Cinq statuts AFFICHES, derives via lib/statut-affaire (source de verite unique).
// Le Record est EXHAUSTIF : TypeScript impose les 5 cles, un oubli ne compile pas.
const CONFIG: Record<StatutAffiche, { label: string; icon: string; className: string }> = {
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
  rapport_genere: {
    label: 'Rapport généré',
    icon: '📄',
    className: 'bg-emerald-50 text-emerald-700',
  },
  devis_en_cours: {
    label: 'Devis en cours',
    icon: '📝',
    className: 'bg-violet-50 text-violet-700',
  },
  devis_envoye: {
    label: 'Devis envoyé',
    icon: '📤',
    className: 'bg-teal-50 text-teal-700',
  },
}

export default function StatusBadge({ statut }: { statut: StatutAffiche }) {
  const { label, icon, className } = CONFIG[statut]

  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${className}`}>
      <span>{icon}</span>
      {label}
    </span>
  )
}
