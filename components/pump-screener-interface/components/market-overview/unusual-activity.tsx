"use client"

import { AlertTriangle, TrendingUp, Volume2, Users, Zap } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { mockUnusualActivity } from "../../data"
import { getAnomalyTypeColor } from "../../utils"

export function UnusualActivity() {
  const getAnomalyIcon = (type: string) => {
    switch (type.toLowerCase()) {
      case "volume spike":
        return Volume2
      case "price surge":
        return TrendingUp
      case "social spike":
        return Users
      case "whale activity":
        return Zap
      default:
        return AlertTriangle
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5" />
          Unusual Activity
        </CardTitle>
        <CardDescription>Assets showing abnormal trading patterns</CardDescription>
      </CardHeader>
     <div className="overflow-x-auto">
     <CardContent className="space-y-4 min-w-[450px]">
        {mockUnusualActivity.map((item, index) => {
          const IconComponent = getAnomalyIcon(item.anomalyType)
          return (
            <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-orange-500/10 rounded-lg">
                  <IconComponent className="h-4 w-4 text-orange-500" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{item.symbol}</span>
                    <Badge variant="outline" className={getAnomalyTypeColor(item.anomalyType)}>
                      {item.anomalyType}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span>{item.price}</span>
                    <span className="text-green-500">+{item.change24h}%</span>
                    <span>Vol: +{item.volumeChange}%</span>
                  </div>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium">{item.marketCap}</p>
                <p className="text-xs text-muted-foreground">Market Cap</p>
              </div>
            </div>
          )
        })}
      </CardContent>
     </div>
    </Card>
  )
}
