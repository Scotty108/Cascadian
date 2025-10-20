"use client"

import Image from "next/image";
import { useState } from "react"
import { ChevronDown, Info, Calculator, ExternalLink } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Progress } from "@/components/ui/progress"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { CHAIN_ICONS, RISK_COLORS, GAS_OPTIONS } from "../../constants"
import { formatNumber, getImpermanentLossRiskValue, getRiskValue } from "../../utils"
import type { YieldFarmingOpportunity } from "../../types"

interface OpportunityDetailModalProps {
  opportunity: YieldFarmingOpportunity
  gasOption: string
  autocompoundEnabled: boolean
  harvestThreshold: number
  onClose: () => void
  onGasOptionChange: (option: string) => void
  onAutocompoundChange: (enabled: boolean) => void
  onHarvestThresholdChange: (threshold: number) => void
  onOpenIlCalculator: () => void
  onDeposit?: (amount: number) => void
  walletConnected?: boolean
  walletBalance?: number
}

export function OpportunityDetailModal({
  opportunity,
  gasOption,
  autocompoundEnabled,
  harvestThreshold,
  onClose,
  onGasOptionChange,
  onAutocompoundChange,
  onHarvestThresholdChange,
  onOpenIlCalculator,
  onDeposit,
  walletConnected = false,
  walletBalance = 0,
}: OpportunityDetailModalProps) {
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false)
  const [depositAmount, setDepositAmount] = useState<string>("")

  const gasData = GAS_OPTIONS[gasOption as keyof typeof GAS_OPTIONS] || GAS_OPTIONS.average

  const handleDeposit = () => {
    const amount = Number.parseFloat(depositAmount)
    if (amount > 0 && onDeposit) {
      onDeposit(amount)
      onClose()
    }
  }

  const handleMaxClick = () => {
    setDepositAmount(walletBalance.toString())
  }

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <div className="flex items-center">
              <Image
                src={opportunity.logo || "/placeholder.svg"}
                alt={opportunity.protocol}
                width={40}
                height={40}
                className="mr-3 h-10 w-10 rounded-full"
              />
              <div>
                <div className="text-xl">
                  {opportunity.protocol} - {opportunity.asset}
                </div>
                <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                  <div className="flex items-center">
                    <Image
                      src={CHAIN_ICONS[opportunity.chain as keyof typeof CHAIN_ICONS] || "/placeholder.svg"}
                      alt={opportunity.chain}
                      width={16}
                      height={16}
                      className="mr-1 h-4 w-4 rounded-full"
                    />
                    <span>{opportunity.chain}</span>
                  </div>
                  <span>•</span>
                  <span>{opportunity.farmType}</span>
                  <span>•</span>
                  <Badge
                    variant="outline"
                    className={`${RISK_COLORS[opportunity.risk as keyof typeof RISK_COLORS]} text-white`}
                  >
                    {opportunity.risk} Risk
                  </Badge>
                </div>
              </div>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <div className="grid gap-6 md:grid-cols-3">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Annual Percentage Yield</p>
              <p className="text-2xl font-bold">{opportunity.apy.toFixed(2)}%</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Total Value Locked</p>
              <p className="text-2xl font-bold">{formatNumber(opportunity.tvl)}</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Impermanent Loss Risk</p>
              <p className="text-2xl font-bold">{opportunity.impermanentLoss}</p>
            </div>
          </div>

          <Separator />

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-4">
              <div>
                <h4 className="mb-2 font-medium">Farm Details</h4>
                <div className="space-y-2 rounded-lg bg-muted p-4">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Deposit Fee</span>
                    <span>{opportunity.depositFee}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Withdraw Fee</span>
                    <span>{opportunity.withdrawFee}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Harvest Lockup</span>
                    <span>{opportunity.harvestLockup}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Last Harvest</span>
                    <span>{opportunity.lastHarvest}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Verified</span>
                    <span>{opportunity.verified ? "Yes" : "No"}</span>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="mb-2 font-medium">Reward Tokens</h4>
                <div className="flex flex-wrap gap-2">
                  {opportunity.rewards.map((reward: string, index: number) => (
                    <Badge key={index} className="px-3 py-1">
                      {reward}
                    </Badge>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="mb-2 font-medium">Risk Assessment</h4>
                <div className="space-y-2">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Smart Contract Risk</span>
                      <Badge
                        variant="outline"
                        className={`${RISK_COLORS[opportunity.risk as keyof typeof RISK_COLORS]} text-white`}
                      >
                        {opportunity.risk}
                      </Badge>
                    </div>
                    <Progress value={getRiskValue(opportunity.risk)} className="h-2" />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Impermanent Loss Risk</span>
                      <Badge
                        variant="outline"
                        className={`
                          ${
                            opportunity.impermanentLoss === "None"
                              ? "bg-green-500"
                              : opportunity.impermanentLoss === "Very Low"
                                ? "bg-emerald-500"
                                : opportunity.impermanentLoss === "Low"
                                  ? "bg-emerald-500"
                                  : opportunity.impermanentLoss === "Medium"
                                    ? "bg-yellow-500"
                                    : opportunity.impermanentLoss === "High"
                                      ? "bg-orange-500"
                                      : "bg-red-500"
                          } 
                          text-white
                        `}
                      >
                        {opportunity.impermanentLoss}
                      </Badge>
                    </div>
                    <Progress value={getImpermanentLossRiskValue(opportunity.impermanentLoss)} className="h-2" />
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <h4 className="mb-2 font-medium">Deposit</h4>
                <Card>
                  <CardContent className="pt-6">
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>Amount to Deposit</Label>
                        <div className="flex items-center space-x-2">
                          <Input
                            placeholder="0.00"
                            type="number"
                            value={depositAmount}
                            onChange={(e) => setDepositAmount(e.target.value)}
                          />
                          <Button variant="outline" onClick={handleMaxClick}>
                            Max
                          </Button>
                        </div>
                        {walletConnected && (
                          <p className="text-xs text-muted-foreground">Available: ${walletBalance.toFixed(2)}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label>Gas Price (Gwei)</Label>
                          <span className="text-sm">
                            {gasData.price} - {gasData.time}
                          </span>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Button
                            variant={gasOption === "slow" ? "default" : "outline"}
                            size="sm"
                            className="flex-1"
                            onClick={() => onGasOptionChange("slow")}
                          >
                            Slow
                          </Button>
                          <Button
                            variant={gasOption === "average" ? "default" : "outline"}
                            size="sm"
                            className="flex-1"
                            onClick={() => onGasOptionChange("average")}
                          >
                            Average
                          </Button>
                          <Button
                            variant={gasOption === "fast" ? "default" : "outline"}
                            size="sm"
                            className="flex-1"
                            onClick={() => onGasOptionChange("fast")}
                          >
                            Fast
                          </Button>
                        </div>
                      </div>

                      <Collapsible open={showAdvancedSettings} onOpenChange={setShowAdvancedSettings}>
                        <div className="flex items-center justify-between">
                          <Label>Advanced Settings</Label>
                          <CollapsibleTrigger asChild>
                            <Button variant="ghost" size="sm">
                              <ChevronDown className="h-4 w-4" />
                            </Button>
                          </CollapsibleTrigger>
                        </div>
                        <CollapsibleContent className="space-y-2 pt-2">
                          <div className="flex items-center justify-between">
                            <Label htmlFor="autocompound" className="flex items-center space-x-2">
                              <span>Auto-compound Rewards</span>
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger>
                                    <Info className="h-4 w-4 text-muted-foreground" />
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>Automatically reinvest rewards to maximize yield</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </Label>
                            <Switch
                              id="autocompound"
                              checked={autocompoundEnabled}
                              onCheckedChange={onAutocompoundChange}
                            />
                          </div>

                          {autocompoundEnabled && (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <Label>Harvest Threshold ($)</Label>
                                <span className="text-sm">${harvestThreshold}</span>
                              </div>
                              <Slider
                                value={[harvestThreshold]}
                                min={10}
                                max={200}
                                step={10}
                                onValueChange={(value) => onHarvestThresholdChange(value[0])}
                              />
                              <p className="text-xs text-muted-foreground">
                                Only harvest rewards when they exceed this value to optimize gas costs
                              </p>
                            </div>
                          )}
                        </CollapsibleContent>
                      </Collapsible>

                      <Button
                        className="w-full"
                        onClick={handleDeposit}
                        disabled={!walletConnected || !depositAmount || Number.parseFloat(depositAmount) <= 0}
                      >
                        {walletConnected ? "Deposit" : "Connect Wallet to Deposit"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>

          <Separator />

          <div>
            <h4 className="mb-2 font-medium">Strategy Description</h4>
            <p className="text-sm text-muted-foreground">
              This {opportunity.farmType} farm on {opportunity.protocol} allows you to earn {opportunity.apy.toFixed(2)}
              % APY by providing liquidity to the {opportunity.asset} pool. Rewards are distributed in{" "}
              {opportunity.rewards.join(", ")} tokens, which can be harvested at any time.
              {opportunity.impermanentLoss !== "None" &&
                ` This farm has ${opportunity.impermanentLoss.toLowerCase()} impermanent loss risk due to potential price divergence between the assets in the pool.`}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t">
            <Button variant="outline" onClick={onOpenIlCalculator}>
              <Calculator className="mr-2 h-4 w-4" />
              IL Calculator
            </Button>
            <div className="flex space-x-2">
              <Button variant="outline">
                <ExternalLink className="mr-2 h-4 w-4" />
                View on {opportunity.protocol}
              </Button>
              <Button
                onClick={handleDeposit}
                disabled={!walletConnected || !depositAmount || Number.parseFloat(depositAmount) <= 0}
              >
                Deposit
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
