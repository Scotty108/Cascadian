import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DollarSign, BarChart3, Layers, Percent, ArrowUp, ArrowDown } from "lucide-react"
import type { PortfolioOverview } from "../../types"
import { formatCurrency, formatPercentage } from "../../utils"

interface KpiCardsProps {
  data: PortfolioOverview
}

export function KpiCards({ data }: KpiCardsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Portfolio Value</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">${formatCurrency(data.totalValue)}</div>
          <div className="flex items-center pt-1">
            <span className={`flex items-center text-xs ${data.dailyChange >= 0 ? "text-green-500" : "text-red-500"}`}>
              {data.dailyChange >= 0 ? <ArrowUp className="mr-1 h-3 w-3" /> : <ArrowDown className="mr-1 h-3 w-3" />}
              {Math.abs(data.dailyChange)}% today
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Portfolio Performance</CardTitle>
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground">Monthly</div>
              <div className={`text-sm font-medium ${data.monthlyChange >= 0 ? "text-green-500" : "text-red-500"}`}>
                {formatPercentage(data.monthlyChange)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Yearly</div>
              <div className={`text-sm font-medium ${data.yearlyChange >= 0 ? "text-green-500" : "text-red-500"}`}>
                {formatPercentage(data.yearlyChange)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">All Time</div>
              <div className={`text-sm font-medium ${data.allTimeChange >= 0 ? "text-green-500" : "text-red-500"}`}>
                {formatPercentage(data.allTimeChange)}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Portfolio Diversity</CardTitle>
          <Layers className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground">Assets</div>
              <div className="text-sm font-medium">{data.assets}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Chains</div>
              <div className="text-sm font-medium">{data.chains}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Protocols</div>
              <div className="text-sm font-medium">{data.protocols}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Portfolio ROI</CardTitle>
          <Percent className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{data.allTimeROI}%</div>
          <p className="text-xs text-muted-foreground">All time return on investment</p>
        </CardContent>
      </Card>
    </div>
  )
}
