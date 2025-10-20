"use client"

import { DollarSign } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Separator } from "@/components/ui/separator"
import { formatCurrency, calculateImpermanentLoss } from "../../utils"
import type { ImpermanentLossCalculatorValues } from "../../types"

interface ImpermanentLossCalculatorProps {
  values: ImpermanentLossCalculatorValues
  onValuesChange: (values: Partial<ImpermanentLossCalculatorValues>) => void
}

export function ImpermanentLossCalculator({ values, onValuesChange }: ImpermanentLossCalculatorProps) {
  const ilResult = calculateImpermanentLoss(values)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Impermanent Loss Calculator</CardTitle>
        <CardDescription>Estimate potential impermanent loss for LP positions</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Initial Investment</Label>
            <div className="flex items-center">
              <DollarSign className="mr-2 h-4 w-4 text-muted-foreground" />
              <Input
                type="number"
                value={values.initialInvestment}
                onChange={(e) =>
                  onValuesChange({
                    initialInvestment: Number.parseFloat(e.target.value) || 0,
                  })
                }
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Token 1 Price Change (%)</Label>
              <span className="text-sm">{values.token1Change}%</span>
            </div>
            <Slider
              value={[values.token1Change]}
              min={-90}
              max={500}
              step={1}
              onValueChange={(value) =>
                onValuesChange({
                  token1Change: value[0],
                })
              }
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Token 2 Price Change (%)</Label>
              <span className="text-sm">{values.token2Change}%</span>
            </div>
            <Slider
              value={[values.token2Change]}
              min={-90}
              max={500}
              step={1}
              onValueChange={(value) =>
                onValuesChange({
                  token2Change: value[0],
                })
              }
            />
          </div>

          <Separator />

          <div className="rounded-lg bg-muted p-4">
            <div className="mb-2 text-sm font-medium">Impermanent Loss Estimate</div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-sm text-muted-foreground">Percentage</div>
                <div className="text-xl font-bold">{ilResult.percentage.toFixed(2)}%</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Value</div>
                <div className="text-xl font-bold">{formatCurrency(ilResult.value)}</div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
