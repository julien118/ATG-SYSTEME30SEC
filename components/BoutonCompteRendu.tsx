// =============================================================
// Bouton « Compte rendu » — ouvre le CR dans un NOUVEL onglet
// =============================================================
// Demande d'Olivier (ticket « Impossible d'ouvrir les rapports », 27/07/2026) :
// pouvoir garder le compte rendu affiché sur un 2e écran pendant qu'il saisit et
// finalise le devis, et le rouvrir MÊME après l'envoi sur Costructor.
//
// Jusqu'ici le CR n'était accessible que par la flèche « retour » (navigation
// in-app qui REMPLACE l'écran courant) — impossible de le garder ouvert à côté.
// Ici on ouvre un nouvel onglet, donc l'écran de saisie reste en place.
//
// Cible : le lien court /r/[id] (302 -> PDF, persisté dès la génération du
// rapport, cf. persistRapportPdf dans lib/rapport-pdf.ts). Dans le rare cas où le
// PDF n'est pas (encore) persisté, on retombe sur l'écran /rapport, toujours
// ouvrable. Composant pur (pas d'interactivité) => compatible Server Component.

const IconeDoc = () => (
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
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="8" y1="13" x2="16" y2="13" />
    <line x1="8" y1="17" x2="14" y2="17" />
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

export default function BoutonCompteRendu({
  chantierId,
  pdfPret = true,
  variant = 'header',
  className = '',
}: {
  chantierId: string
  /** true si le PDF du CR est persisté : on ouvre /r/[id] (PDF) ; sinon /rapport. */
  pdfPret?: boolean
  /** 'header' : clair sur fond sombre · 'card' : bouton secondaire sur fond clair. */
  variant?: 'header' | 'card'
  className?: string
}) {
  const href = pdfPret ? `/r/${chantierId}` : `/chantiers/${chantierId}/rapport`
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
      title="Ouvrir le compte rendu dans un nouvel onglet"
      className={`${base} ${styles} ${className}`}
    >
      <IconeDoc />
      <span className={variant === 'card' ? '' : 'hidden sm:inline'}>
        Compte rendu
      </span>
      <IconeLienExterne />
    </a>
  )
}
