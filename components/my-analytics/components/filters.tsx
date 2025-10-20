"use client"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Filter } from "lucide-react"
import type { FilterCategory, FilterItem, Filters } from "../types"

interface FiltersComponentProps {
  open: boolean
  setOpen: (open: boolean) => void
  filters: Filters
  onFilterChange: (category: FilterCategory, item: FilterItem) => void
  onResetFilters: () => void
}

export function FiltersComponent({ open, setOpen, filters, onFilterChange, onResetFilters }: FiltersComponentProps) {
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="gap-2" onClick={() => setOpen(!open)}>
          <Filter className="h-4 w-4" />
          Filters
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <div className="grid gap-4">
          <div className="space-y-2">
            <h4 className="font-medium leading-none">Profitability</h4>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="profitable"
                  checked={filters.profitability.profitable}
                  onCheckedChange={() => onFilterChange("profitability", "profitable")}
                />
                <Label htmlFor="profitable">Profitable</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="unprofitable"
                  checked={filters.profitability.unprofitable}
                  onCheckedChange={() => onFilterChange("profitability", "unprofitable")}
                />
                <Label htmlFor="unprofitable">Unprofitable</Label>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="font-medium leading-none">Status</h4>
            <div className="grid grid-cols-3 gap-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="active"
                  checked={filters.status.active}
                  onCheckedChange={() => onFilterChange("status", "active")}
                />
                <Label htmlFor="active">Active</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="paused"
                  checked={filters.status.paused}
                  onCheckedChange={() => onFilterChange("status", "paused")}
                />
                <Label htmlFor="paused">Paused</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="stopped"
                  checked={filters.status.stopped}
                  onCheckedChange={() => onFilterChange("status", "stopped")}
                />
                <Label htmlFor="stopped">Stopped</Label>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="font-medium leading-none">Timeframe</h4>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="day"
                  checked={filters.timeframe.day}
                  onCheckedChange={() => onFilterChange("timeframe", "day")}
                />
                <Label htmlFor="day">Day</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="week"
                  checked={filters.timeframe.week}
                  onCheckedChange={() => onFilterChange("timeframe", "week")}
                />
                <Label htmlFor="week">Week</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="month"
                  checked={filters.timeframe.month}
                  onCheckedChange={() => onFilterChange("timeframe", "month")}
                />
                <Label htmlFor="month">Month</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="year"
                  checked={filters.timeframe.year}
                  onCheckedChange={() => onFilterChange("timeframe", "year")}
                />
                <Label htmlFor="year">Year</Label>
              </div>
            </div>
          </div>

          <Button variant="outline" onClick={onResetFilters}>
            Reset All
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
