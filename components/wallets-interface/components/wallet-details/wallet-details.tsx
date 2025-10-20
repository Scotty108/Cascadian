import { Shield, RefreshCw, ExternalLink } from "lucide-react"
import { Card, CardContent, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { WalletHeader } from "./wallet-header"
import { WalletTabs } from "./wallet-tabs"
import { getWalletType } from "../../utils"
import type { Wallet, Asset, Transaction } from "../../types"

interface WalletDetailsProps {
  wallet: Wallet
  activeTab: string
  onTabChange: (tab: string) => void
  filteredAssets: (Asset & { networkId: string })[]
  filteredTransactions: Transaction[]
  activeNetwork: string
  onNetworkChange: (network: string) => void
  onViewAllTransactions: () => void
}

export function WalletDetails({
  wallet,
  activeTab,
  onTabChange,
  filteredAssets,
  filteredTransactions,
  activeNetwork,
  onNetworkChange,
  onViewAllTransactions,
}: WalletDetailsProps) {
  const walletType = getWalletType(wallet.type)

  return (
    <Card>
      <WalletHeader wallet={wallet} />
      <CardContent className="pb-0">
        <WalletTabs
          wallet={wallet}
          activeTab={activeTab}
          onTabChange={onTabChange}
          filteredAssets={filteredAssets}
          filteredTransactions={filteredTransactions}
          activeNetwork={activeNetwork}
          onNetworkChange={onNetworkChange}
          onViewAllTransactions={onViewAllTransactions}
        />
      </CardContent>
      <CardFooter className="flex items-center gap-6 flex-wrap justify-between border-t p-4">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-green-500" />
          <span className="text-sm text-muted-foreground">Secured with {walletType.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm">
            <RefreshCw className="mr-1 h-4 w-4" />
            Refresh
          </Button>
          <Button variant="outline" size="sm">
            <ExternalLink className="mr-1 h-4 w-4" />
            View on Explorer
          </Button>
        </div>
      </CardFooter>
    </Card>
  )
}
