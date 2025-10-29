"use client"

import { StrategyDashboard } from "@/components/strategy-dashboard"
import { useStrategyDashboard } from "@/hooks/use-strategy-dashboard"
import { useParams } from "next/navigation"
import { Loader2, AlertCircle } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

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
      <Card className="shadow-sm rounded-2xl border-0 dark:bg-[#18181b]">
        <div className="px-6 py-12">
          <div className="flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-[#00E0AA]" />
          </div>
          <p className="text-center text-sm text-muted-foreground mt-4">Loading strategy...</p>
        </div>
      </Card>
    )
  }

  if (error || !data) {
    return (
      <Card className="shadow-sm rounded-2xl border-0 dark:bg-[#18181b]">
        <div className="px-6 py-12">
          <div className="flex flex-col items-center justify-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10 mb-4">
              <AlertCircle className="h-6 w-6 text-red-500" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Unable to Load Strategy</h3>
            <p className="text-sm text-muted-foreground mb-6">
              {error || 'Strategy not found'}
            </p>
            <Button onClick={refresh} className="bg-[#00E0AA] text-slate-950 hover:bg-[#00E0AA]/90">
              Retry
            </Button>
          </div>
        </div>
      </Card>
    )
  }

  return (
    <StrategyDashboard
      strategyData={data}
      onToggleStatus={handleToggleStatus}
      onRefresh={refresh}
    />
  )
}
