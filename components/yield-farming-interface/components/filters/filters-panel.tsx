"use client"

import Image from "next/image";
import { Card } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Slider } from "@/components/ui/slider"
import { CHAIN_ICONS, RISK_COLORS, FARM_TYPES, RISK_LEVELS, CHAINS } from "../../constants"
import { formatNumber } from "../../utils"
import type { FilterState } from "../../types"

interface FiltersPanelProps {
  filters: FilterState
  onFiltersChange: (filters: Partial<FilterState>) => void
  onResetFilters: () => void
  onClose: () => void
}

export function FiltersPanel({ filters, onFiltersChange, onResetFilters, onClose }: FiltersPanelProps) {
  const handleChainToggle = (chain: string) => {
    const newChains = filters.selectedChains.includes(chain)
      ? filters.selectedChains.filter((c) => c !== chain)
      : [...filters.selectedChains, chain]
    onFiltersChange({ selectedChains: newChains })
  }

  const handleRiskToggle = (risk: string) => {
    const newRisks = filters.selectedRisks.includes(risk)
      ? filters.selectedRisks.filter((r) => r !== risk)
      : [...filters.selectedRisks, risk]
    onFiltersChange({ selectedRisks: newRisks })
  }

  const handleFarmTypeToggle = (type: string) => {
    const newTypes = filters.selectedFarmTypes.includes(type)
      ? filters.selectedFarmTypes.filter((t) => t !== type)
      : [...filters.selectedFarmTypes, type]
    onFiltersChange({ selectedFarmTypes: newTypes })
  }

  return (
    <Card className="p-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-2">
          <Label>Chain</Label>
          <ScrollArea className="h-32 rounded-md border">
            <div className="p-2">
              {CHAINS.map((chain) => (
                <div key={chain} className="flex items-center space-x-2 py-1">
                  <input
                    type="checkbox"
                    id={`chain-${chain}`}
                    checked={filters.selectedChains.includes(chain)}
                    onChange={() => handleChainToggle(chain)}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <label htmlFor={`chain-${chain}`} className="flex items-center text-sm">
                    <Image
                      src={CHAIN_ICONS[chain as keyof typeof CHAIN_ICONS] || "/placeholder.svg"}
                      alt={chain}
                      width={16}
                      height={16}
                      className="mr-2 h-4 w-4 rounded-full"
                    />
                    {chain}
                  </label>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>

        <div className="space-y-2">
          <Label>Risk Level</Label>
          <ScrollArea className="h-32 rounded-md border">
            <div className="p-2">
              {RISK_LEVELS.map((risk) => (
                <div key={risk} className="flex items-center space-x-2 py-1">
                  <input
                    type="checkbox"
                    id={`risk-${risk}`}
                    checked={filters.selectedRisks.includes(risk)}
                    onChange={() => handleRiskToggle(risk)}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <label htmlFor={`risk-${risk}`} className="flex items-center text-sm">
                    <span
                      className={`mr-2 inline-block h-3 w-3 rounded-full ${RISK_COLORS[risk as keyof typeof RISK_COLORS]}`}
                    />
                    {risk}
                  </label>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>

        <div className="space-y-2">
          <Label>Farm Type</Label>
          <ScrollArea className="h-32 rounded-md border">
            <div className="p-2">
              {FARM_TYPES.map((type) => (
                <div key={type} className="flex items-center space-x-2 py-1">
                  <input
                    type="checkbox"
                    id={`type-${type}`}
                    checked={filters.selectedFarmTypes.includes(type)}
                    onChange={() => handleFarmTypeToggle(type)}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <label htmlFor={`type-${type}`} className="text-sm">
                    {type}
                  </label>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>APY Range</Label>
              <span className="text-xs text-muted-foreground">
                {filters.apyRange[0]}% - {filters.apyRange[1]}%
              </span>
            </div>
            <Slider
              value={filters.apyRange}
              min={0}
              max={50}
              step={1}
              onValueChange={(value) => onFiltersChange({ apyRange: value })}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>TVL Range</Label>
              <span className="text-xs text-muted-foreground">
                {formatNumber(filters.tvlRange[0])} - {formatNumber(filters.tvlRange[1])}
              </span>
            </div>
            <Slider
              value={filters.tvlRange}
              min={0}
              max={600000000}
              step={10000000}
              onValueChange={(value) => onFiltersChange({ tvlRange: value })}
            />
          </div>
        </div>
      </div>

      <div className="mt-4 flex justify-end space-x-2">
        <Button variant="outline" size="sm" onClick={onResetFilters}>
          Reset Filters
        </Button>
        <Button variant="default" size="sm" onClick={onClose}>
          Apply Filters
        </Button>
      </div>
    </Card>
  )
}
