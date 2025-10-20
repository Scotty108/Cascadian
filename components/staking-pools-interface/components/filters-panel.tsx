"use client"

import Image from "next/image";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { Separator } from "@/components/ui/separator"
import { Search, Landmark, Shield, Droplets, Layers, Coins } from "lucide-react"
import { stakingPools } from "../data"
import { getRiskColor } from "../utils"
import type { FilterState } from "../types"

interface FiltersPanelProps {
  filters: FilterState
  onFiltersChange: (filters: Partial<FilterState>) => void
  onResetFilters: () => void
}

export function FiltersPanel({ filters, onFiltersChange, onResetFilters }: FiltersPanelProps) {
  const uniqueChains = Array.from(new Set(stakingPools.map((pool) => pool.chain)))
  const riskLevels = ["Low", "Medium", "High"]
  const stakingTypes = [
    { id: "PoS", label: "Proof of Stake", icon: Landmark },
    { id: "DPoS", label: "Delegated PoS", icon: Shield },
    { id: "Liquid", label: "Liquid Staking", icon: Droplets },
    { id: "Governance", label: "Governance", icon: Layers },
    { id: "LP", label: "LP Staking", icon: Coins },
  ]

  const handleChainToggle = (chain: string, checked: boolean) => {
    const newChains = checked ? [...filters.selectedChains, chain] : filters.selectedChains.filter((c) => c !== chain)
    onFiltersChange({ selectedChains: newChains })
  }

  const handleRiskToggle = (risk: string, checked: boolean) => {
    const newRisks = checked
      ? [...filters.selectedRiskLevels, risk]
      : filters.selectedRiskLevels.filter((r) => r !== risk)
    onFiltersChange({ selectedRiskLevels: newRisks })
  }

  const handleStakingTypeToggle = (type: string, checked: boolean) => {
    const newTypes = checked
      ? [...filters.selectedStakingTypes, type]
      : filters.selectedStakingTypes.filter((t) => t !== type)
    onFiltersChange({ selectedStakingTypes: newTypes })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Filters</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Search */}
        <div className="space-y-2">
          <Label htmlFor="search-pools">Search</Label>
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              id="search-pools"
              placeholder="Search pools..."
              className="pl-8"
              value={filters.searchQuery}
              onChange={(e) => onFiltersChange({ searchQuery: e.target.value })}
            />
          </div>
        </div>

        <Separator />

        {/* Blockchain */}
        <div className="space-y-2">
          <Label>Blockchain</Label>
          <div className="space-y-1">
            {uniqueChains.map((chain) => (
              <div key={chain} className="flex items-center space-x-2">
                <Checkbox
                  id={`chain-${chain}`}
                  checked={filters.selectedChains.includes(chain)}
                  onCheckedChange={(checked) => handleChainToggle(chain, !!checked)}
                />
                <Label htmlFor={`chain-${chain}`} className="flex items-center text-sm font-normal cursor-pointer">
                  <Image
                    src={`/placeholder.svg?height=16&width=16&query=${chain}`}
                    alt={chain}
                    width={16}
                    height={16}
                    className="w-4 h-4 mr-2"
                  />
                  {chain}
                </Label>
              </div>
            ))}
          </div>
        </div>

        <Separator />

        {/* Risk Level */}
        <div className="space-y-2">
          <Label>Risk Level</Label>
          <div className="space-y-1">
            {riskLevels.map((risk) => (
              <div key={risk} className="flex items-center space-x-2">
                <Checkbox
                  id={`risk-${risk}`}
                  checked={filters.selectedRiskLevels.includes(risk)}
                  onCheckedChange={(checked) => handleRiskToggle(risk, !!checked)}
                />
                <Label htmlFor={`risk-${risk}`} className="flex items-center text-sm font-normal cursor-pointer">
                  <div className={`h-2 w-2 rounded-full mr-2 ${getRiskColor(risk)}`}></div>
                  {risk}
                </Label>
              </div>
            ))}
          </div>
        </div>

        <Separator />

        {/* Staking Type */}
        <div className="space-y-2">
          <Label>Staking Type</Label>
          <div className="space-y-1">
            {stakingTypes.map((type) => {
              const TypeIcon = type.icon
              return (
                <div key={type.id} className="flex items-center space-x-2">
                  <Checkbox
                    id={`type-${type.id}`}
                    checked={filters.selectedStakingTypes.includes(type.id)}
                    onCheckedChange={(checked) => handleStakingTypeToggle(type.id, !!checked)}
                  />
                  <Label htmlFor={`type-${type.id}`} className="flex items-center text-sm font-normal cursor-pointer">
                    <TypeIcon className="h-3 w-3 mr-2" />
                    {type.label}
                  </Label>
                </div>
              )
            })}
          </div>
        </div>

        <Separator />

        {/* Minimum APY */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="min-apy">Minimum APY</Label>
            <span className="text-sm">{filters.minApy}%</span>
          </div>
          <Slider
            id="min-apy"
            min={0}
            max={30}
            step={1}
            value={[filters.minApy]}
            onValueChange={(value) => onFiltersChange({ minApy: value[0] })}
          />
        </div>

        <Separator />

        {/* Toggle Filters */}
        <div className="space-y-2">
          <div className="flex items-center space-x-2">
            <Switch
              id="liquid-staking"
              checked={filters.showLiquidStakingOnly}
              onCheckedChange={(checked) => onFiltersChange({ showLiquidStakingOnly: checked })}
            />
            <Label htmlFor="liquid-staking" className="cursor-pointer">
              Liquid Staking Only
            </Label>
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="verified-only"
              checked={filters.showVerifiedOnly}
              onCheckedChange={(checked) => onFiltersChange({ showVerifiedOnly: checked })}
            />
            <Label htmlFor="verified-only" className="cursor-pointer">
              Verified Only
            </Label>
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="no-lock-only"
              checked={filters.showNoLockOnly}
              onCheckedChange={(checked) => onFiltersChange({ showNoLockOnly: checked })}
            />
            <Label htmlFor="no-lock-only" className="cursor-pointer">
              No Lock Period Only
            </Label>
          </div>
        </div>

        <Button variant="outline" className="w-full" onClick={onResetFilters}>
          Reset Filters
        </Button>
      </CardContent>
    </Card>
  )
}
