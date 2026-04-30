import Image from 'next/image'

interface LogoLinkProps {
  width?: number
  height?: number
  priority?: boolean
}

export default function LogoLink({ width = 120, height = 28, priority = false }: LogoLinkProps) {
  return (
    <a href="https://ionnyx.fr/">
      <Image src="/logo-ionnyx.png" alt="IONNYX" width={width} height={height} priority={priority} />
    </a>
  )
}
