"use client"

import { StrategyDashboard } from "@/components/strategy-dashboard"
import { mockStrategies } from "@/components/strategy-dashboard/mock-data"
import { useParams } from "next/navigation"
import { notFound } from "next/navigation"

export default function StrategyPage() {
  const params = useParams()
  const strategyId = params.id as string

  const strategy = mockStrategies.find(s => s.id === strategyId)

  if (!strategy) {
    notFound()
  }

  const handleToggleStatus = () => {
    console.log("Toggle strategy status")
    // TODO: Implement status toggle
  }

  const handleRefresh = async () => {
    console.log("Refresh strategy data")
    // TODO: Implement data refresh
  }

  return (
    <div className="p-6">
      <StrategyDashboard
        strategyData={strategy}
        onToggleStatus={handleToggleStatus}
        onRefresh={handleRefresh}
      />
    </div>
  )
}
