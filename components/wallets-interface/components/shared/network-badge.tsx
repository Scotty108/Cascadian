import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { getNetwork } from "../../utils"

interface NetworkBadgeProps {
  networkId: string
  showName?: boolean
  size?: "sm" | "md" | "lg"
}

export function NetworkBadge({ networkId, showName = false, size = "md" }: NetworkBadgeProps) {
  const network = getNetwork(networkId)

  const sizeClasses = {
    sm: "h-4 w-4",
    md: "h-5 w-5",
    lg: "h-6 w-6",
  }

  return (
    <div className="flex items-center gap-2">
      <Avatar className={sizeClasses[size]}>
        <AvatarImage src={network.icon || "/placeholder.svg"} alt={network.name} />
        <AvatarFallback>{network.name.substring(0, 2)}</AvatarFallback>
      </Avatar>
      {showName && <span className="text-sm">{network.name}</span>}
    </div>
  )
}
