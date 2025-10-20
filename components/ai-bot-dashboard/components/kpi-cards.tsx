import { ArrowDown, ArrowUp } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatCurrency, formatPercentage } from "../utils"
import type { BotData } from "../types"

interface KpiCardsProps {
  botData: BotData
}

export function KpiCards({ botData }: KpiCardsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Portfolio Value</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatCurrency(botData.balance)}</div>
          <div className="flex items-center text-xs text-muted-foreground mt-1">
            <Badge variant={botData.profit.daily >= 0 ? "default" : "destructive"} className="mr-1">
              <span className="flex items-center">
                {botData.profit.daily >= 0 ? (
                  <ArrowUp className="mr-1 h-3 w-3" />
                ) : (
                  <ArrowDown className="mr-1 h-3 w-3" />
                )}
                {formatPercentage(botData.profit.daily)}
              </span>
            </Badge>
            <span>Today</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Total Profit</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatPercentage(botData.profit.total)}</div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
            <span>Monthly: {formatPercentage(botData.profit.monthly)}</span>
            <span>Weekly: {formatPercentage(botData.profit.weekly)}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Win Rate</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{botData.trades.winRate}%</div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
            <span>Success: {botData.trades.successful}</span>
            <span>Failed: {botData.trades.failed}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Market Condition</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold capitalize">{botData.marketConditions.overall}</div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
            <span>Volatility: {botData.marketConditions.volatility}</span>
            <span>Sentiment: {botData.marketConditions.sentiment}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
