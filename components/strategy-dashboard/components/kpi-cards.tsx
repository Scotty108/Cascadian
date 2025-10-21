"use client"

import { TrendingDown, TrendingUp } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

import { ACCENT_COLOR, formatCurrency, formatPercentage } from "../utils"
import type { StrategyData } from "../types"

interface KpiCardsProps {
  strategyData: StrategyData
}

const SECONDARY_TEXT = "text-sm text-muted-foreground"

export function KpiCards({ strategyData }: KpiCardsProps) {
  const profitIsPositive = strategyData.performance.total >= 0

  const metrics = [
    {
      id: "portfolio",
      label: "Portfolio Value",
      primary: formatCurrency(strategyData.balance),
      helper: `${formatPercentage(strategyData.performance.total)} vs start`,
      tone: profitIsPositive ? "positive" : "negative",
      meta: `${formatPercentage(strategyData.performance.daily)} today`,
    },
    {
      id: "roi",
      label: "Total ROI",
      primary: formatPercentage(strategyData.performance.total),
      helper: `Monthly ${formatPercentage(strategyData.performance.monthly)}`,
      tone: profitIsPositive ? "positive" : "negative",
      meta: `Weekly ${formatPercentage(strategyData.performance.weekly)}`,
    },
    {
      id: "win-rate",
      label: "Win Rate",
      primary: `${strategyData.statistics.winRate}%`,
      helper: `${strategyData.statistics.winningTrades} wins • ${strategyData.statistics.losingTrades} losses`,
      tone: strategyData.statistics.winRate >= 50 ? "positive" : "neutral",
      meta: `Profit factor ${strategyData.statistics.profitFactor.toFixed(2)}`,
    },
    {
      id: "exposure",
      label: "Active Positions",
      primary: strategyData.statistics.activePositions.toString(),
      helper: `${strategyData.statistics.totalTrades} total trades`,
      tone: "neutral",
      meta: `${strategyData.statistics.closedPositions} closed`,
    },
  ] as const

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {metrics.map(metric => {
        const isPositive = metric.tone === "positive"
        const isNegative = metric.tone === "negative"

        return (
          <Card
            key={metric.id}
            className="group overflow-hidden rounded-2xl border border-border/60 bg-background/60 shadow-sm transition hover:border-[#00E0AA]/50 hover:shadow-lg"
          >
            <CardHeader className="flex flex-row items-start justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {metric.label}
              </CardTitle>
              <Badge
                variant="outline"
                className="rounded-full border border-border/60 bg-background/80 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
              >
                Live
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-3xl font-semibold tracking-tight">{metric.primary}</div>
              <div className={SECONDARY_TEXT}>{metric.helper}</div>
              <div className="flex items-center gap-2 text-xs font-medium">
                <span
                  className="inline-flex items-center gap-1 rounded-full px-3 py-1"
                  style={{
                    backgroundColor: isPositive
                      ? `${ACCENT_COLOR}1A`
                      : isNegative
                        ? "rgba(239,68,68,0.12)"
                        : "rgba(148,163,184,0.12)",
                    color: isPositive
                      ? ACCENT_COLOR
                      : isNegative
                        ? "#ef4444"
                        : "inherit",
                    boxShadow: isPositive
                      ? `inset 0 0 0 1px ${ACCENT_COLOR}33`
                      : "none",
                  }}
                >
                  {isPositive && <TrendingUp className="h-3 w-3" />}
                  {isNegative && <TrendingDown className="h-3 w-3" />}
                  {metric.meta}
                </span>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
