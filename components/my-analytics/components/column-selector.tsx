"use client"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SlidersHorizontal } from "lucide-react"
import type { ColumnKey, ColumnVisibility } from "../types"

interface ColumnSelectorProps {
  open: boolean
  setOpen: (open: boolean) => void
  visibleColumns: ColumnVisibility
  onColumnChange: (column: ColumnKey) => void
  onResetColumns: () => void
}

export function ColumnSelector({ open, setOpen, visibleColumns, onColumnChange, onResetColumns }: ColumnSelectorProps) {
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="gap-2" onClick={() => setOpen(!open)}>
          <SlidersHorizontal className="h-4 w-4" />
          Columns
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <div className="grid gap-4">
          <div className="space-y-2">
            <h4 className="font-medium leading-none">Show/Hide Columns</h4>
            <ScrollArea className="h-72">
              <div className="grid gap-2">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="col-name"
                    checked={visibleColumns.name}
                    onCheckedChange={() => onColumnChange("name")}
                  />
                  <Label htmlFor="col-name">Name</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="col-status"
                    checked={visibleColumns.status}
                    onCheckedChange={() => onColumnChange("status")}
                  />
                  <Label htmlFor="col-status">Status</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="col-trades"
                    checked={visibleColumns.trades}
                    onCheckedChange={() => onColumnChange("trades")}
                  />
                  <Label htmlFor="col-trades">Trades</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="col-winRate"
                    checked={visibleColumns.winRate}
                    onCheckedChange={() => onColumnChange("winRate")}
                  />
                  <Label htmlFor="col-winRate">Win Rate</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="col-profit"
                    checked={visibleColumns.profit}
                    onCheckedChange={() => onColumnChange("profit")}
                  />
                  <Label htmlFor="col-profit">Profit</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="col-profitPercent"
                    checked={visibleColumns.profitPercent}
                    onCheckedChange={() => onColumnChange("profitPercent")}
                  />
                  <Label htmlFor="col-profitPercent">Profit %</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="col-volume"
                    checked={visibleColumns.volume}
                    onCheckedChange={() => onColumnChange("volume")}
                  />
                  <Label htmlFor="col-volume">Volume</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="col-timeframe"
                    checked={visibleColumns.timeframe}
                    onCheckedChange={() => onColumnChange("timeframe")}
                  />
                  <Label htmlFor="col-timeframe">Timeframe</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="col-actions"
                    checked={visibleColumns.actions}
                    onCheckedChange={() => onColumnChange("actions")}
                  />
                  <Label htmlFor="col-actions">Actions</Label>
                </div>
              </div>
            </ScrollArea>
          </div>

          <Button variant="outline" onClick={onResetColumns}>
            Reset Columns
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
