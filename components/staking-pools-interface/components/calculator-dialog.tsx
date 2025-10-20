"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Progress } from "@/components/ui/progress"
import { DollarSign, Percent, Clock } from "lucide-react"
import { calculateRewards } from "../utils"
import type { CalculatorState } from "../types"

interface CalculatorDialogProps {
  isOpen: boolean
  onClose: () => void
  calculatorState: CalculatorState
  onCalculatorChange: (state: Partial<CalculatorState>) => void
  onDiscoverPools: () => void
}

export function CalculatorDialog({
  isOpen,
  onClose,
  calculatorState,
  onCalculatorChange,
  onDiscoverPools,
}: CalculatorDialogProps) {
  const calculatedRewards = calculateRewards(
    Number.parseFloat(calculatorState.amount) || 0,
    Number.parseFloat(calculatorState.apy) || 0,
    Number.parseInt(calculatorState.period) || 365,
    calculatorState.compounding,
  )

  const principal = Number.parseFloat(calculatorState.amount) || 0
  const finalBalance = principal + calculatedRewards

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Staking Calculator</DialogTitle>
          <DialogDescription>
            Calculate potential staking returns based on amount, APY, and time period
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="calculator-amount">Investment Amount</Label>
              <div className="relative">
                <DollarSign className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="calculator-amount"
                  placeholder="1000"
                  value={calculatorState.amount}
                  onChange={(e) => onCalculatorChange({ amount: e.target.value })}
                  className="pl-8"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="calculator-apy">Annual APY (%)</Label>
              <div className="relative">
                <Percent className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="calculator-apy"
                  placeholder="5"
                  value={calculatorState.apy}
                  onChange={(e) => onCalculatorChange({ apy: e.target.value })}
                  className="pl-8"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="calculator-period">Time Period (days)</Label>
              <div className="relative">
                <Clock className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="calculator-period"
                  placeholder="365"
                  value={calculatorState.period}
                  onChange={(e) => onCalculatorChange({ period: e.target.value })}
                  className="pl-8"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="calculator-compounding">Compounding Frequency</Label>
              <Select
                value={calculatorState.compounding}
                onValueChange={(value) => onCalculatorChange({ compounding: value })}
              >
                <SelectTrigger id="calculator-compounding">
                  <SelectValue placeholder="Select frequency" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (Simple Interest)</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="yearly">Yearly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Initial Investment</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">${principal.toFixed(2)}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Estimated Rewards</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-500">${calculatedRewards.toFixed(2)}</div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Final Balance</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">${finalBalance.toFixed(2)}</div>
                <Progress
                  value={finalBalance > 0 ? (calculatedRewards / finalBalance) * 100 : 0}
                  className="h-2 mt-2"
                />
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>Principal</span>
                  <span>Rewards</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={onDiscoverPools}>Find Staking Opportunities</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
