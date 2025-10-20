"use client"

import Image from "next/image";
import { Search, Filter } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { ProtocolFilters } from "../types"
import { PROTOCOL_CATEGORIES, CHAINS, RISK_LEVELS } from "../constants"

interface ProtocolFiltersProps {
  filters: ProtocolFilters
  onFiltersChange: (filters: Partial<ProtocolFilters>) => void
  onRiskFilterToggle: (risk: string) => void
}

export function ProtocolFiltersComponent({ filters, onFiltersChange, onRiskFilterToggle }: ProtocolFiltersProps) {
  return (
    <div className="flex flex-col flex-wrap gap-4 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search protocols..."
            className="w-full pl-8"
            value={filters.searchQuery}
            onChange={(e) => onFiltersChange({ searchQuery: e.target.value })}
          />
        </div>
        <Select value={filters.chain} onValueChange={(value) => onFiltersChange({ chain: value })}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue placeholder="All Chains" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Chains</SelectItem>
            {CHAINS.map((chain) => (
              <SelectItem key={chain.id} value={chain.id}>
                <div className="flex items-center gap-2">
                  <Image src={chain.icon || "/placeholder.svg"} alt={chain.name} className="h-4 w-4" width={16} height={16} />
                  <span>{chain.name}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1">
              <Filter className="h-3.5 w-3.5" />
              <span>Filters</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72" align="end">
            <div className="grid gap-4">
              <div className="space-y-2">
                <h4 className="font-medium">Risk Level</h4>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(RISK_LEVELS).map(([key, { label }]) => (
                    <Badge
                      key={key}
                      variant={filters.riskFilter.includes(key) ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => onRiskFilterToggle(key)}
                    >
                      {label}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="audited-only">Audited Only</Label>
                  <Switch
                    id="audited-only"
                    checked={filters.showOnlyAudited}
                    onCheckedChange={(checked) => onFiltersChange({ showOnlyAudited: checked })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="favorites-only">Favorites Only</Label>
                  <Switch
                    id="favorites-only"
                    checked={filters.showOnlyFavorites}
                    onCheckedChange={(checked) => onFiltersChange({ showOnlyFavorites: checked })}
                  />
                </div>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        <ScrollArea className="whitespace-nowrap">
          <div className="flex  flex-wrap gap-2 p-1">
            {PROTOCOL_CATEGORIES.map((category) => (
              <Button
                key={category}
                variant={filters.category === category ? "default" : "outline"}
                size="sm"
                className="h-8"
                onClick={() => onFiltersChange({ category })}
              >
                {category}
              </Button>
            ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
