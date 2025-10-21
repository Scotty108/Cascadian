import { StrategyDashboardOverview } from "@/components/strategy-dashboard-overview"
import { mockStrategies } from "@/components/strategy-dashboard/mock-data"

export default function StrategiesPage() {
  return (
    <div className="p-6">
      <StrategyDashboardOverview strategies={mockStrategies} />
    </div>
  )
}
