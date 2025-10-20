import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { getWalletType } from "../../utils"

interface WalletBadgeProps {
  walletType: string
  showName?: boolean
  size?: "sm" | "md" | "lg"
}

export function WalletBadge({ walletType, showName = false, size = "md" }: WalletBadgeProps) {
  const wallet = getWalletType(walletType)

  const sizeClasses = {
    sm: "h-4 w-4",
    md: "h-6 w-6",
    lg: "h-8 w-8",
  }

  return (
    <div className="flex items-center gap-2">
      <Avatar className={sizeClasses[size]}>
        <AvatarImage src={wallet.icon || "/placeholder.svg"} alt={wallet.name} />
        <AvatarFallback className={wallet.color}>{wallet.name.substring(0, 1)}</AvatarFallback>
      </Avatar>
      {showName && <Badge variant="outline">{wallet.name}</Badge>}
    </div>
  )
}
