import { Copy, ExternalLink } from "lucide-react"
import { CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { WalletBadge } from "../shared/wallet-badge"
import { formatCurrency, shortenAddress } from "../../utils"
import type { Wallet } from "../../types"

interface WalletHeaderProps {
  wallet: Wallet
}

export function WalletHeader({ wallet }: WalletHeaderProps) {
  return (
    <CardHeader className="flex flex-row gap-3 flex-wrap items-center justify-between space-y-0 pb-2">
      <div className="space-y-1">
        <CardTitle className="flex items-center gap-2 flex-wrap">
          <WalletBadge walletType={wallet.type} showName />
          {wallet.name}
        </CardTitle>
        <CardDescription className="flex items-center gap-2">
          <span>{shortenAddress(wallet.address)}</span>
          <Button variant="ghost" size="icon" className="h-4 w-4 text-muted-foreground">
            <Copy className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-4 w-4 text-muted-foreground">
            <ExternalLink className="h-3 w-3" />
          </Button>
        </CardDescription>
      </div>
      <div className="flex items-center gap-2">
        <div className="text-right">
          <p className="text-sm font-medium">Total Balance</p>
          <p className="text-2xl font-bold">{formatCurrency(wallet.totalBalance)}</p>
        </div>
      </div>
    </CardHeader>
  )
}
