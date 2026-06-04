import Link from 'next/link'
import Image from 'next/image'

// Logo ATG BLANC sans le numero de telephone (amelioration 10) : version du logo
// des rapports (logo-atg-blanc.png) rognee par le bas pour retirer la ligne du
// numero. Source 128x48 (ratio 8:3). On l'affiche un peu plus PETIT que sa
// resolution native (hauteur 40 px <= 48) pour rester net, et `w-auto` preserve
// le ratio sans rognage ni distorsion, sur mobile comme sur ordinateur. Pense
// pour s'afficher sur la banniere sombre (#1a1a1a).
// On ignore les props width/height passees par les callers (taille uniforme).
interface LogoLinkProps {
  width?: number
  height?: number
  priority?: boolean
}

export default function LogoLink({ priority = false }: LogoLinkProps) {
  return (
    <Link href="/chantiers" className="inline-flex items-center select-none">
      <Image
        src="/logo-atg-blanc-sans-numero.png"
        alt="ATG"
        width={128}
        height={48}
        priority={priority}
        className="h-10 w-auto"
      />
    </Link>
  )
}
