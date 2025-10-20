import { NetworkCard } from "./network-card"
import { RecentActivity } from "./recent-activity"
import { SecurityStatus } from "./security-status"
import type { Wallet } from "../../../types"

interface OverviewTabProps {
  wallet: Wallet
  onViewAllTransactions: () => void
}

export function OverviewTab({ wallet, onViewAllTransactions }: OverviewTabProps) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {wallet.networks.map((network) => (
          <NetworkCard key={network.networkId} network={network} />
        ))}
      </div>

      <RecentActivity transactions={wallet.transactions} onViewAll={onViewAllTransactions} />

      <SecurityStatus wallet={wallet} />
    </div>
  )
}
