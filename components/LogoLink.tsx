import Link from 'next/link'
import Image from 'next/image'

// Logo ATG officiel cropped (sans le numéro de téléphone).
// Image source 128x38 (ratio ~3.37:1).
// On ignore les props width/height passées par les callers pour garantir
// un affichage uniforme et plus grand sur tout le site démo.
interface LogoLinkProps {
  width?: number
  height?: number
  priority?: boolean
}

const LOGO_RATIO = 128 / 38
const DISPLAY_HEIGHT = 44

// width/height font partie des props (passees par les callers) mais sont
// volontairement ignorees ici : on ne les destructure pas (taille uniforme).
export default function LogoLink({ priority = false }: LogoLinkProps) {
  const computedWidth = Math.round(DISPLAY_HEIGHT * LOGO_RATIO)
  return (
    <Link href="/chantiers" className="inline-flex items-center select-none">
      <Image
        src="/logo-atg.png"
        alt="ATG"
        width={computedWidth}
        height={DISPLAY_HEIGHT}
        priority={priority}
      />
    </Link>
  )
}
