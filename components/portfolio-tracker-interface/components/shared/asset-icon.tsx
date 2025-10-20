import Image from "next/image";

interface AssetIconProps {
  src: string
  alt: string
  size?: number
}

export function AssetIcon({ src, alt, size = 32 }: AssetIconProps) {
  return (
    <div className={`h-${size / 4} w-${size / 4} rounded-full overflow-hidden`}>
      <Image src={src || "/placeholder.svg"} alt={alt} width={size} height={size} className="h-full w-full object-cover" />
    </div>
  )
}
