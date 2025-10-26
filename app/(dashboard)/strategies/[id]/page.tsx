"use client"

import { StrategyDashboard } from "@/components/strategy-dashboard"
import { useStrategyDashboard } from "@/hooks/use-strategy-dashboard"
import { useParams } from "next/navigation"
import { Loader2 } from "lucide-react"

export default function StrategyPage() {
  const params = useParams()
  const strategyId = params.id as string

  const { data, loading, error, refresh } = useStrategyDashboard(strategyId)

  const handleToggleStatus = async () => {
    try {
      const response = await fetch(`/api/strategies/${strategyId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_active: data?.status === 'active' ? false : true,
        }),
      })

      if (response.ok) {
        refresh()
      }
    } catch (err) {
      console.error('Failed to toggle strategy status:', err)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-[#00E0AA]" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <p className="text-red-500">Error: {error || 'Strategy not found'}</p>
          <button
            onClick={refresh}
            className="mt-4 px-4 py-2 bg-[#00E0AA] text-black rounded hover:bg-[#00E0AA]/90"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6">
      <StrategyDashboard
        strategyData={data}
        onToggleStatus={handleToggleStatus}
        onRefresh={refresh}
      />
    </div>
  )
}
