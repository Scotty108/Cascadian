import { StrategyDashboardOverview } from "@/components/strategy-dashboard-overview"
import { mockDefaultStrategy } from "@/components/strategy-dashboard/mock-data"

export default function StrategiesPage() {
  // Only show the default template strategy
  const strategies = [mockDefaultStrategy]

  return (
    <div className="p-6">
      <StrategyDashboardOverview strategies={strategies} />
    </div>
  )
}
