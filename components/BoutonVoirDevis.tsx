// =============================================================
// Bouton « Voir le devis » — ouvre le devis dans un NOUVEL onglet
// =============================================================
// Pendant symétrique de BoutonCompteRendu (demande d'Olivier, ticket
// « Impossible d'ouvrir les rapports », 27/07/2026). Depuis l'écran compte rendu,
// permet d'ouvrir la VISUALISATION du devis dans un nouvel onglet, pour qu'Olivier
// garde ses deux documents côte à côte sur ses 2 écrans (« rapport | devis »).
//
// Cible la visualisation /chantiers/[id]/devis/recap (le « tableau » du devis, tel
// qu'il part chez Costructor). À n'afficher QUE si un devis existe déjà pour le
// chantier (sinon /recap redirige vers la saisie). Composant pur => Server Component.

const IconeDevis = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M9 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7l-5-5z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="8" y1="13" x2="16" y2="13" />
    <line x1="8" y1="17" x2="16" y2="17" />
    <line x1="10" y1="9" x2="12" y2="9" />
  </svg>
)

const IconeLienExterne = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
)

export default function BoutonVoirDevis({
  chantierId,
  variant = 'header',
  className = '',
}: {
  chantierId: string
  /** 'header' : clair sur fond sombre · 'card' : bouton secondaire sur fond clair. */
  variant?: 'header' | 'card'
  className?: string
}) {
  const href = `/chantiers/${chantierId}/devis/recap`
  const base =
    'inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap'
  const styles =
    variant === 'card'
      ? 'rounded-lg border border-primary text-primary hover:bg-primary/5 text-sm py-2.5 px-4 font-medium'
      : 'rounded-lg text-gray-200 hover:text-white hover:bg-white/10 text-xs font-medium px-2.5 py-2'
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title="Ouvrir le devis dans un nouvel onglet"
      className={`${base} ${styles} ${className}`}
    >
      <IconeDevis />
      <span className={variant === 'card' ? '' : 'hidden sm:inline'}>
        Voir le devis
      </span>
      <IconeLienExterne />
    </a>
  )
}
