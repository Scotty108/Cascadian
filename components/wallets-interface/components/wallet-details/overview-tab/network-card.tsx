import { ExternalLink, ArrowUpRight, ArrowDownLeft, RefreshCw } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { NetworkBadge } from "../../shared/network-badge"
import { formatCrypto, formatCurrency, getNetwork } from "../../../utils"
import type { NetworkBalance } from "../../../types"

interface NetworkCardProps {
  network: NetworkBalance
}

export function NetworkCard({ network }: NetworkCardProps) {
  const networkInfo = getNetwork(network.networkId)

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex items-center gap-2">
          <NetworkBadge networkId={network.networkId} />
          <CardTitle className="text-base">{networkInfo.name}</CardTitle>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <ExternalLink className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        <div className="flex justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Balance</p>
            <p className="text-xl font-bold">
              {formatCrypto(network.balance)} {networkInfo.symbol}
            </p>
            <p className="text-sm text-muted-foreground">{formatCurrency(network.usdValue)}</p>
          </div>
          <div className="flex flex-col items-end">
            <p className="text-sm text-muted-foreground">Assets</p>
            <p className="text-xl font-bold">{network.assets.length}</p>
          </div>
        </div>
      </CardContent>
      <div className="bg-muted/50 px-6 py-3">
        <div className="flex justify-between">
          <Button variant="ghost" size="sm" className="h-8 px-2">
            <ArrowUpRight className="mr-1 h-4 w-4" />
            Send
          </Button>
          <Button variant="ghost" size="sm" className="h-8 px-2">
            <ArrowDownLeft className="mr-1 h-4 w-4" />
            Receive
          </Button>
          <Button variant="ghost" size="sm" className="h-8 px-2">
            <RefreshCw className="mr-1 h-4 w-4" />
            Swap
          </Button>
        </div>
      </div>
    </Card>
  )
}
