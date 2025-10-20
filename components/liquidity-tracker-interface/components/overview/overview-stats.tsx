"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowUpRight, ArrowDownRight, BarChart3, Activity, Layers } from "lucide-react"

export function OverviewStats() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-medium">Total Value Locked</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-3xl font-bold">$4.35B</div>
              <div className="flex items-center text-sm text-green-500">
                <ArrowUpRight className="mr-1 h-4 w-4" />
                +5.2% (24h)
              </div>
            </div>
            <BarChart3 className="h-8 w-8 text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-medium">24h Volume</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-3xl font-bold">$892.7M</div>
              <div className="flex items-center text-red-500">
                <ArrowDownRight className="mr-1 h-4 w-4" />
                -2.8% (24h)
              </div>
            </div>
            <Activity className="h-8 w-8 text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-medium">Active Pools</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-3xl font-bold">1,248</div>
              <div className="flex items-center text-green-500">
                <ArrowUpRight className="mr-1 h-4 w-4" />
                +12 (24h)
              </div>
            </div>
            <Layers className="h-8 w-8 text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
