"use client"

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Search, Filter, ChevronDown, Plus } from "lucide-react"
import type { FilterState } from "../../types"

interface AssetFiltersProps {
  filters: FilterState
  onFiltersChange: (updates: Partial<FilterState>) => void
}

export function AssetFilters({ filters, onFiltersChange }: AssetFiltersProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search assets..."
            className="w-full rounded-md pl-8 md:w-[300px]"
            value={filters.search}
            onChange={(e) => onFiltersChange({ search: e.target.value })}
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Filter className="mr-2 h-4 w-4" />
              Filter
              <ChevronDown className="ml-2 h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[200px]">
            <DropdownMenuLabel>Filter Assets</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onFiltersChange({ assetFilter: "all" })}>All Assets</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onFiltersChange({ assetFilter: "gainers" })}>Top Gainers</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onFiltersChange({ assetFilter: "losers" })}>Top Losers</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onFiltersChange({ assetFilter: "largest" })}>
              Largest Holdings
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onFiltersChange({ assetFilter: "smallest" })}>
              Smallest Holdings
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
     
    </div>
  )
}
