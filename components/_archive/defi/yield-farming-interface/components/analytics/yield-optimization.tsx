"use client"

import { TrendingUp, Target, AlertCircle, Lightbulb } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { calculateYieldOptimization, formatPercentage, formatCurrency } from "../../utils"
import type { YieldFarmingOpportunity } from "../../types"

interface YieldOptimizationProps {
  opportunities: YieldFarmingOpportunity[]
  walletBalance: number
  currentPortfolioValue: number
}

export function YieldOptimization({ opportunities, walletBalance, currentPortfolioValue }: YieldOptimizationProps) {
  const optimization = calculateYieldOptimization(opportunities, walletBalance)
  const improvementPotential = optimization.optimizedYield - optimization.currentYield

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center">
          <Target className="mr-2 h-5 w-5" />
          Yield Optimization
        </CardTitle>
        <CardDescription>AI-powered suggestions to maximize your yield farming returns</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Current vs Optimized Yield */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Current Average APY</p>
            <p className="text-2xl font-bold">{formatPercentage(optimization.currentYield)}</p>
          </div>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Optimized APY</p>
            <div className="flex items-center space-x-2">
              <p className="text-2xl font-bold text-green-600">{formatPercentage(optimization.optimizedYield)}</p>
              {improvementPotential > 0 && (
                <Badge variant="outline" className="text-green-600 border-green-600">
                  +{formatPercentage(improvementPotential)}
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Improvement Potential */}
        {improvementPotential > 0 && (
          <div className="rounded-lg bg-green-50 p-4 border border-green-200">
            <div className="flex items-center space-x-2 mb-2">
              <TrendingUp className="h-4 w-4 text-green-600" />
              <p className="font-medium text-green-800">Optimization Opportunity</p>
            </div>
            <p className="text-sm text-green-700">
              You could potentially increase your yield by {formatPercentage(improvementPotential)}
              by following our optimization suggestions below.
            </p>
            <div className="mt-2">
              <p className="text-xs text-green-600">
                Estimated additional annual return:{" "}
                {formatCurrency((currentPortfolioValue * improvementPotential) / 100)}
              </p>
            </div>
          </div>
        )}

        <Separator />

        {/* Optimization Suggestions */}
        <div className="space-y-4">
          <div className="flex items-center space-x-2">
            <Lightbulb className="h-4 w-4 text-yellow-500" />
            <h4 className="font-medium">Optimization Suggestions</h4>
          </div>

          <div className="space-y-3">
            {optimization.suggestions.map((suggestion, index) => (
              <div key={index} className="flex items-start space-x-3 p-3 rounded-lg bg-muted/50">
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center">
                  <span className="text-xs font-medium text-blue-600">{index + 1}</span>
                </div>
                <p className="text-sm flex-1">{suggestion}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Risk Assessment */}
        <div className="space-y-3">
          <div className="flex items-center space-x-2">
            <AlertCircle className="h-4 w-4 text-orange-500" />
            <h4 className="font-medium">Risk Considerations</h4>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm">Portfolio Diversification</span>
              <Badge variant="outline" className="text-green-600 border-green-600">
                Good
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Smart Contract Risk</span>
              <Badge variant="outline" className="text-yellow-600 border-yellow-600">
                Medium
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Impermanent Loss Risk</span>
              <Badge variant="outline" className="text-orange-600 border-orange-600">
                Moderate
              </Badge>
            </div>
          </div>
        </div>

        <Separator />

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-2">
          <Button className="flex-1">
            <Target className="mr-2 h-4 w-4" />
            Apply Optimization
          </Button>
          <Button variant="outline" className="w-fit">Learn More</Button>
        </div>
      </CardContent>
    </Card>
  )
}
