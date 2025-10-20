"use client"

import { Trophy, TrendingUp } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { topPerformingAssets } from "../../data"

export function TopPerformingAssets() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trophy className="h-5 w-5" />
          Top Performers
        </CardTitle>
        <CardDescription>Assets with most successful pumps (30 days)</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {topPerformingAssets.map((asset, index) => (
          <div key={index} className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="w-6 h-6 p-0 flex items-center justify-center text-xs">
                  {index + 1}
                </Badge>
                <div>
                  <span className="font-medium">{asset.symbol}</span>
                  <span className="text-sm text-muted-foreground ml-2">{asset.name}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <TrendingUp className="h-3 w-3 text-green-500" />
                <span className="text-sm font-medium">{asset.pumps} pumps</span>
              </div>
            </div>
            <Progress value={asset.percentage} className="h-1" />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
