import { StatCard } from "./stat-card"
import { DollarSign, Activity, Zap, Bot } from "lucide-react"
import { mockStats } from "../data"

interface HeaderStatsProps {
  activeOpportunitiesCount: number
  activeBotsCount: number
  totalBotsCount: number
}

export function HeaderStats({ activeOpportunitiesCount, activeBotsCount, totalBotsCount }: HeaderStatsProps) {
  return (
    <div className="flex flex-col space-y-4 md:flex-row md:space-x-4 md:space-y-0">
      <StatCard
        title="Total Profit"
        value={`$${mockStats.totalProfit.toFixed(2)}`}
        description="All-time arbitrage profit"
        icon={DollarSign}
        trend="up"
        trendValue="+12.5% from last month"
        className="flex-1"
      />
      <StatCard
        title="Success Rate"
        value={`${mockStats.successRate}%`}
        description={`${mockStats.totalTrades} total trades`}
        icon={Activity}
        trend="up"
        trendValue="+2.3% from last month"
        className="flex-1"
      />
      <StatCard
        title="Active Opportunities"
        value={activeOpportunitiesCount}
        description="Current arbitrage opportunities"
        icon={Zap}
        trend="neutral"
        trendValue="Same as yesterday"
        className="flex-1"
      />
      <StatCard
        title="Active Bots"
        value={activeBotsCount}
        description={`${totalBotsCount} total bots configured`}
        icon={Bot}
        trend="up"
        trendValue="+1 from last week"
        className="flex-1"
      />
    </div>
  )
}
