"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowUpRight, Wallet, Zap, Percent } from "lucide-react"

interface PositionsStatsProps {
  totalValue: number
  totalRewards: number
  averageApy: number
}

export function PositionsStats({ totalValue, totalRewards, averageApy }: PositionsStatsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-medium">Total Value</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-3xl font-bold">${totalValue.toLocaleString()}</div>
              <div className="flex items-center text-green-500">
                <ArrowUpRight className="mr-1 h-4 w-4" />
                +3.8% (24h)
              </div>
            </div>
            <Wallet className="h-8 w-8 text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-medium">Total Rewards</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-3xl font-bold">${totalRewards}</div>
              <div className="flex items-center text-green-500">
                <ArrowUpRight className="mr-1 h-4 w-4" />
                +$12 (24h)
              </div>
            </div>
            <Zap className="h-8 w-8 text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-medium">Average APY</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-3xl font-bold">{averageApy.toFixed(1)}%</div>
              <div className="flex items-center text-green-500">
                <ArrowUpRight className="mr-1 h-4 w-4" />
                +0.3% (24h)
              </div>
            </div>
            <Percent className="h-8 w-8 text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
