"use client"

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Search, Calendar, Download } from "lucide-react"
import type { FilterState } from "../../types"

interface TransactionFiltersProps {
  filters: FilterState
  onFiltersChange: (updates: Partial<FilterState>) => void
}

export function TransactionFilters({ filters, onFiltersChange }: TransactionFiltersProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center flex-wrap gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search transactions..."
            className="w-full rounded-md pl-8 md:w-[300px]"
            value={filters.search}
            onChange={(e) => onFiltersChange({ search: e.target.value })}
          />
        </div>
        <Select value={filters.transactionType} onValueChange={(value) => onFiltersChange({ transactionType: value })}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Transaction Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="buy">Buy</SelectItem>
            <SelectItem value="sell">Sell</SelectItem>
            <SelectItem value="swap">Swap</SelectItem>
            <SelectItem value="deposit">Deposit</SelectItem>
            <SelectItem value="withdraw">Withdraw</SelectItem>
            <SelectItem value="stake">Stake</SelectItem>
          </SelectContent>
        </Select>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              <Calendar className="mr-2 h-4 w-4" />
              Date Range
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-4" align="start">
            <div className="grid gap-4">
              <div className="grid gap-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor="from">From</Label>
                    <Input
                      id="from"
                      type="date"
                      className="w-full"
                      value={filters.dateRange.from}
                      onChange={(e) =>
                        onFiltersChange({
                          dateRange: { ...filters.dateRange, from: e.target.value },
                        })
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="to">To</Label>
                    <Input
                      id="to"
                      type="date"
                      className="w-full"
                      value={filters.dateRange.to}
                      onChange={(e) =>
                        onFiltersChange({
                          dateRange: { ...filters.dateRange, to: e.target.value },
                        })
                      }
                    />
                  </div>
                </div>
              </div>
              <Button>Apply Filter</Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
      <Button size="sm">
        <Download className="mr-2 h-4 w-4" />
        Export CSV
      </Button>
    </div>
  )
}
