"use client"

import { ArrowDown, ArrowUp } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { formatCurrency, getChangeColor } from "../../utils"
import { STATS_CONFIG } from "../../constants"

export function StatsCards() {
  const renderStatCard = (key: keyof typeof STATS_CONFIG) => {
    const stat = STATS_CONFIG[key]
    const isPositive = stat.change >= 0

    return (
      <Card key={key}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
          <Badge variant="outline" className={cn("text-xs", getChangeColor(stat.change))}>
            {isPositive ? "+" : ""}
            {stat.change}%
          </Badge>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatCurrency(stat.value)}</div>
          <div className="flex items-center text-xs text-muted-foreground mt-1">
            {isPositive ? (
              <ArrowUp className="mr-1 h-4 w-4 text-green-500" />
            ) : (
              <ArrowDown className="mr-1 h-4 w-4 text-red-500" />
            )}
            <span className={getChangeColor(stat.change)}>
              {isPositive ? "+" : ""}
              {formatCurrency(stat.changeValue)}
            </span>
            <span className="ml-1">{stat.period}</span>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {Object.keys(STATS_CONFIG).map((key) => renderStatCard(key as keyof typeof STATS_CONFIG))}
    </div>
  )
}
