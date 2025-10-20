"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import { Button } from "@/components/ui/button"
import { MIN_TVL_OPTIONS, MIN_APY_OPTIONS, RISK_LEVELS, FEE_TIERS } from "../../constants"
import type { FilterState } from "../../types"

interface AdvancedFiltersProps {
  filters: FilterState
  onUpdateFilters: (updates: Partial<FilterState>) => void
  onResetFilters: () => void
}

export function AdvancedFilters({ filters, onUpdateFilters, onResetFilters }: AdvancedFiltersProps) {
  if (!filters.showAdvancedFilters) return null

  return (
    <Card>
      <CardContent className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>Min TVL</Label>
            <Select value={filters.minTvl} onValueChange={(value) => onUpdateFilters({ minTvl: value })}>
              <SelectTrigger>
                <SelectValue placeholder="Min TVL" />
              </SelectTrigger>
              <SelectContent>
                {MIN_TVL_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Min APY</Label>
            <Select value={filters.minApy} onValueChange={(value) => onUpdateFilters({ minApy: value })}>
              <SelectTrigger>
                <SelectValue placeholder="Min APY" />
              </SelectTrigger>
              <SelectContent>
                {MIN_APY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Risk Level</Label>
            <Select value={filters.riskLevel} onValueChange={(value) => onUpdateFilters({ riskLevel: value })}>
              <SelectTrigger>
                <SelectValue placeholder="Risk Level" />
              </SelectTrigger>
              <SelectContent>
                {RISK_LEVELS.map((level) => (
                  <SelectItem key={level.value} value={level.value}>
                    {level.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Token Pair</Label>
            <Input
              placeholder="e.g., ETH, USDC"
              value={filters.tokenPair}
              onChange={(e) => onUpdateFilters({ tokenPair: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Fee Tier</Label>
            <Select value={filters.feeTier} onValueChange={(value) => onUpdateFilters({ feeTier: value })}>
              <SelectTrigger>
                <SelectValue placeholder="Fee Tier" />
              </SelectTrigger>
              <SelectContent>
                {FEE_TIERS.map((tier) => (
                  <SelectItem key={tier.value} value={tier.value}>
                    {tier.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Slippage Tolerance ({filters.slippageTolerance[0]}%)</Label>
            <Slider
              value={filters.slippageTolerance}
              min={0.1}
              max={5}
              step={0.1}
              onValueChange={(value) => onUpdateFilters({ slippageTolerance: value })}
            />
          </div>
        </div>
        <div className="flex justify-end mt-4">
          <Button variant="outline" className="mr-2" onClick={onResetFilters}>
            Reset
          </Button>
          <Button>Apply Filters</Button>
        </div>
      </CardContent>
    </Card>
  )
}
