"use client"

import { BarChart3, TrendingUp, Clock, Target } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

export function PumpStatistics() {
  const stats = [
    {
      icon: BarChart3,
      label: "Total Pumps Detected",
      value: "1,247",
      change: "+12%",
      period: "vs last month",
    },
    {
      icon: TrendingUp,
      label: "Average Pump Size",
      value: "34.2%",
      change: "+5.8%",
      period: "vs last month",
    },
    {
      icon: Clock,
      label: "Average Duration",
      value: "2h 45m",
      change: "-15m",
      period: "vs last month",
    },
    {
      icon: Target,
      label: "Success Rate",
      value: "73.4%",
      change: "+2.1%",
      period: "vs last month",
    },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pump Statistics</CardTitle>
        <CardDescription>Historical pump analysis and trends</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {stats.map((stat, index) => {
          const IconComponent = stat.icon
          return (
            <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <IconComponent className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                  <p className="text-lg font-semibold">{stat.value}</p>
                </div>
              </div>
              <div className="text-right">
                <Badge variant="outline" className="text-green-600 border-green-500/30">
                  {stat.change}
                </Badge>
                <p className="text-xs text-muted-foreground mt-1">{stat.period}</p>
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
