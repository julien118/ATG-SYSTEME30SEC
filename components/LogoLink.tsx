import Image from 'next/image'

interface LogoLinkProps {
  width?: number
  height?: number
  priority?: boolean
}

export default function LogoLink({ width = 120, height = 28, priority = false }: LogoLinkProps) {
  return (
    <a href="https://ionnyx.fr/" className="inline-flex flex-col items-start gap-0.5 group">
      <Image src="/logo-ionnyx.png" alt="IONNYX" width={width} height={height} priority={priority} />
      <span className="text-[10px] text-primary font-medium leading-none group-hover:underline">
        Visiter ionnyx.fr →
      </span>
    </a>
  )
}
