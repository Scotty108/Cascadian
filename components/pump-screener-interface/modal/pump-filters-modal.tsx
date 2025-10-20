"use client"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Separator } from "@/components/ui/separator"
import { useState, useEffect } from "react"

interface FilterState {
  minPriceChange?: number
  maxPriceChange?: number
  minVolumeIncrease?: number
  maxVolumeIncrease?: number
  triggers?: string[]
  profitPotentials?: string[]
}

interface PumpFiltersModalProps {
  isOpen: boolean
  onClose: () => void
  onApply: (filters: FilterState) => void
  currentFilters: FilterState
  availableTriggers: string[]
  availableProfitPotentials: string[]
}

export function PumpFiltersModal({
  isOpen,
  onClose,
  onApply,
  currentFilters,
  availableTriggers,
  availableProfitPotentials,
}: PumpFiltersModalProps) {
  const [filters, setFilters] = useState<FilterState>(currentFilters)

  useEffect(() => {
    setFilters(currentFilters)
  }, [currentFilters, isOpen])

  const handleApply = () => {
    onApply(filters)
  }

  const handleReset = () => {
    setFilters({})
  }

  const handleTriggerChange = (trigger: string, checked: boolean) => {
    setFilters((prev) => ({
      ...prev,
      triggers: checked ? [...(prev.triggers || []), trigger] : (prev.triggers || []).filter((t) => t !== trigger),
    }))
  }

  const handleProfitPotentialChange = (potential: string, checked: boolean) => {
    setFilters((prev) => ({
      ...prev,
      profitPotentials: checked
        ? [...(prev.profitPotentials || []), potential]
        : (prev.profitPotentials || []).filter((p) => p !== potential),
    }))
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Filter Historical Pumps</DialogTitle>
          <DialogDescription>Apply filters to narrow down the pump analysis results</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Price Change Range */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Price Change Range (%)</Label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="minPrice" className="text-xs text-muted-foreground">
                  Min
                </Label>
                <Input
                  id="minPrice"
                  type="number"
                  placeholder="0"
                  value={filters.minPriceChange || ""}
                  onChange={(e) =>
                    setFilters((prev) => ({
                      ...prev,
                      minPriceChange: e.target.value ? Number.parseFloat(e.target.value) : undefined,
                    }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="maxPrice" className="text-xs text-muted-foreground">
                  Max
                </Label>
                <Input
                  id="maxPrice"
                  type="number"
                  placeholder="1000"
                  value={filters.maxPriceChange || ""}
                  onChange={(e) =>
                    setFilters((prev) => ({
                      ...prev,
                      maxPriceChange: e.target.value ? Number.parseFloat(e.target.value) : undefined,
                    }))
                  }
                />
              </div>
            </div>
          </div>

          {/* Volume Increase Range */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Volume Increase Range (%)</Label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="minVolume" className="text-xs text-muted-foreground">
                  Min
                </Label>
                <Input
                  id="minVolume"
                  type="number"
                  placeholder="0"
                  value={filters.minVolumeIncrease || ""}
                  onChange={(e) =>
                    setFilters((prev) => ({
                      ...prev,
                      minVolumeIncrease: e.target.value ? Number.parseFloat(e.target.value) : undefined,
                    }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="maxVolume" className="text-xs text-muted-foreground">
                  Max
                </Label>
                <Input
                  id="maxVolume"
                  type="number"
                  placeholder="5000"
                  value={filters.maxVolumeIncrease || ""}
                  onChange={(e) =>
                    setFilters((prev) => ({
                      ...prev,
                      maxVolumeIncrease: e.target.value ? Number.parseFloat(e.target.value) : undefined,
                    }))
                  }
                />
              </div>
            </div>
          </div>

          <Separator />

          {/* Triggers */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Pump Triggers</Label>
            <div className="space-y-2 max-h-32 overflow-y-auto">
              {availableTriggers.map((trigger) => (
                <div key={trigger} className="flex items-center space-x-2">
                  <Checkbox
                    id={`trigger-${trigger}`}
                    checked={(filters.triggers || []).includes(trigger)}
                    onCheckedChange={(checked) => handleTriggerChange(trigger, checked as boolean)}
                  />
                  <Label htmlFor={`trigger-${trigger}`} className="text-sm">
                    {trigger}
                  </Label>
                </div>
              ))}
            </div>
          </div>

          <Separator />

          {/* Profit Potential */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Profit Potential</Label>
            <div className="space-y-2">
              {availableProfitPotentials.map((potential) => (
                <div key={potential} className="flex items-center space-x-2">
                  <Checkbox
                    id={`potential-${potential}`}
                    checked={(filters.profitPotentials || []).includes(potential)}
                    onCheckedChange={(checked) => handleProfitPotentialChange(potential, checked as boolean)}
                  />
                  <Label htmlFor={`potential-${potential}`} className="text-sm">
                    {potential}
                  </Label>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleReset}>
            Reset
          </Button>
          <Button onClick={handleApply}>Apply Filters</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
