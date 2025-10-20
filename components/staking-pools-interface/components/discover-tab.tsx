"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ArrowUpDown, Search } from "lucide-react"
import { FiltersPanel } from "./filters-panel"
import { PoolCard } from "./pool-card"
import { PoolDetailsModal } from "./pool-details-modal"
import { useState } from "react"
import type { StakingPool, FilterState } from "../types"

interface DiscoverTabProps {
  pools: StakingPool[]
  filters: FilterState
  onFiltersChange: (filters: Partial<FilterState>) => void
  onResetFilters: () => void
  onStakePool: (pool: StakingPool) => void
  onToggleFavorite: (poolId: string) => void
}

export function DiscoverTab({
  pools,
  filters,
  onFiltersChange,
  onResetFilters,
  onStakePool,
  onToggleFavorite,
}: DiscoverTabProps) {
  const [selectedPool, setSelectedPool] = useState<StakingPool | null>(null)
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false)

  const handleShowDetails = (pool: StakingPool) => {
    setSelectedPool(pool)
    setIsDetailsModalOpen(true)
  }

  const handleSortOrderToggle = () => {
    onFiltersChange({
      sortOrder: filters.sortOrder === "asc" ? "desc" : "asc",
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col xl:flex-row gap-4">
        <div className="w-full xl:w-64 space-y-4">
          <FiltersPanel filters={filters} onFiltersChange={onFiltersChange} onResetFilters={onResetFilters} />
        </div>

        <div className="flex-1">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <CardTitle>Available Staking Pools</CardTitle>
                <div className="flex items-center space-x-2">
                  <Label htmlFor="sort-by" className="text-sm">
                    Sort by:
                  </Label>
                  <Select value={filters.sortBy} onValueChange={(value) => onFiltersChange({ sortBy: value })}>
                    <SelectTrigger id="sort-by" className="w-[120px]">
                      <SelectValue placeholder="Sort by" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="apy">APY</SelectItem>
                      <SelectItem value="tvl">TVL</SelectItem>
                      <SelectItem value="name">Name</SelectItem>
                    </SelectContent>
                  </Select>

                  <Button variant="ghost" size="icon" onClick={handleSortOrderToggle}>
                    <ArrowUpDown className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {pools.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Search className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium">No pools found</h3>
                  <p className="text-muted-foreground">Try adjusting your filters or search query</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {pools.map((pool) => (
                    <PoolCard
                      key={pool.id}
                      pool={pool}
                      onStake={onStakePool}
                      onToggleFavorite={onToggleFavorite}
                      onShowDetails={handleShowDetails}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Pool Details Modal */}
      <PoolDetailsModal
        pool={selectedPool}
        isOpen={isDetailsModalOpen}
        onClose={() => setIsDetailsModalOpen(false)}
        onStake={onStakePool}
      />
    </div>
  )
}
