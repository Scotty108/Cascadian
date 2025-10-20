"use client"

import { Wallet, Coins, Percent, Zap } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { formatCurrency } from "../../utils"
import { GAS_OPTIONS } from "../../constants"
import type { UserFarm } from "../../types"

interface PortfolioSummaryProps {
  totalPortfolioValue: number
  totalRewards: number
  userFarms: UserFarm[]
  gasOption: string
  onGasOptionChange: (option: string) => void
}

export function PortfolioSummary({
  totalPortfolioValue,
  totalRewards,
  userFarms,
  gasOption,
  onGasOptionChange,
}: PortfolioSummaryProps) {
  const averageApy =
    userFarms.length > 0 ? userFarms.reduce((total, farm) => total + farm.apy, 0) / userFarms.length : 0

  const gasData = GAS_OPTIONS[gasOption as keyof typeof GAS_OPTIONS]

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Value Locked</CardTitle>
          <Wallet className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatCurrency(totalPortfolioValue)}</div>
          <p className="text-xs text-muted-foreground">
            +
            {totalPortfolioValue > 0
              ? ((totalPortfolioValue / (totalPortfolioValue - totalRewards) - 1) * 100).toFixed(2)
              : 0}
            % from initial
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Rewards</CardTitle>
          <Coins className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatCurrency(totalRewards)}</div>
          <p className="text-xs text-muted-foreground">Across {userFarms.length} active farms</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Average APY</CardTitle>
          <Percent className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{averageApy.toFixed(2)}%</div>
          <p className="text-xs text-muted-foreground">Weighted by deposit value</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Gas Prices</CardTitle>
          <Zap className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{gasData.price} Gwei</div>
          <div className="mt-1 flex items-center space-x-2">
            <Button
              variant={gasOption === "slow" ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => onGasOptionChange("slow")}
            >
              Slow
            </Button>
            <Button
              variant={gasOption === "average" ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => onGasOptionChange("average")}
            >
              Average
            </Button>
            <Button
              variant={gasOption === "fast" ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => onGasOptionChange("fast")}
            >
              Fast
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
