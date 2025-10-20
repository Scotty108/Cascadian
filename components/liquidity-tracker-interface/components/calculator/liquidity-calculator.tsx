"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import type { CalculatorState } from "../../types"

interface LiquidityCalculatorProps {
  calculator: CalculatorState
  onUpdateCalculator: (updates: Partial<CalculatorState>) => void
}

export function LiquidityCalculator({ calculator, onUpdateCalculator }: LiquidityCalculatorProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Liquidity Provision Calculator</CardTitle>
        <CardDescription>Calculate potential returns and risks for providing liquidity</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="investment-amount">Investment Amount (USD)</Label>
              <Input
                id="investment-amount"
                type="number"
                value={calculator.investmentAmount}
                onChange={(e) => onUpdateCalculator({ investmentAmount: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="token1-amount">Token 1 Amount (ETH)</Label>
                <Input
                  id="token1-amount"
                  type="number"
                  value={calculator.token1Amount}
                  onChange={(e) => onUpdateCalculator({ token1Amount: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="token2-amount">Token 2 Amount (USDC)</Label>
                <Input
                  id="token2-amount"
                  type="number"
                  value={calculator.token2Amount}
                  onChange={(e) => onUpdateCalculator({ token2Amount: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Pool Selection</Label>
              <Select
                value={calculator.selectedPool}
                onValueChange={(value) => onUpdateCalculator({ selectedPool: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select Pool" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="uniswap-v3">Uniswap V3 (0.3%)</SelectItem>
                  <SelectItem value="uniswap-v3-1">Uniswap V3 (0.05%)</SelectItem>
                  <SelectItem value="uniswap-v3-2">Uniswap V3 (1%)</SelectItem>
                  <SelectItem value="curve">Curve (0.04%)</SelectItem>
                  <SelectItem value="balancer">Balancer (0.25%)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Time Period</Label>
              <Select
                value={calculator.timePeriod}
                onValueChange={(value) => onUpdateCalculator({ timePeriod: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select Period" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">7 days</SelectItem>
                  <SelectItem value="30">30 days</SelectItem>
                  <SelectItem value="90">90 days</SelectItem>
                  <SelectItem value="180">180 days</SelectItem>
                  <SelectItem value="365">1 year</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Price Range (Uniswap V3)</Label>
              <div className="grid grid-cols-2 gap-4">
                <Input
                  placeholder="Min Price"
                  value={calculator.minPrice}
                  onChange={(e) => onUpdateCalculator({ minPrice: e.target.value })}
                />
                <Input
                  placeholder="Max Price"
                  value={calculator.maxPrice}
                  onChange={(e) => onUpdateCalculator({ maxPrice: e.target.value })}
                />
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="autocompound"
                checked={calculator.autocompound}
                onCheckedChange={(checked) => onUpdateCalculator({ autocompound: checked })}
              />
              <Label htmlFor="autocompound">Auto-compound rewards</Label>
            </div>

            <Button className="w-full">Calculate Returns</Button>
          </div>

          <div className="space-y-4 border rounded-lg p-4">
            <h3 className="text-lg font-medium">Estimated Returns</h3>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-sm text-muted-foreground">Estimated APR</div>
                <div className="text-2xl font-bold text-green-500">12.4%</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Estimated APY</div>
                <div className="text-2xl font-bold text-green-500">13.2%</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-sm text-muted-foreground">Fee APR</div>
                <div className="text-xl font-medium">8.2%</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Rewards APR</div>
                <div className="text-xl font-medium">4.2%</div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">Estimated Earnings (30 days)</div>
              <div className="text-2xl font-bold">$32.50</div>
            </div>

            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">Price Impact</div>
              <div className="text-xl font-medium text-red-500">{calculator.priceImpact}</div>
            </div>

            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">Estimated Gas Fees</div>
              <div className="text-xl font-medium">{calculator.estimatedFees}</div>
            </div>

            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">Impermanent Loss Risk</div>
              <div className="flex items-center">
                <Progress value={65} className="h-2 flex-1 mr-2" />
                <span className="text-sm font-medium">Medium</span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
