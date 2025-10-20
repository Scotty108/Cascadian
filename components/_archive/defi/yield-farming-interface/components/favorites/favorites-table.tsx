"use client"

import { Star } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { OpportunitiesTable } from "../opportunities/opportunities-table"
import type { YieldFarmingOpportunity, FilterState } from "../../types"

interface FavoritesTableProps {
  opportunities: YieldFarmingOpportunity[]
  favoriteOpportunities: number[]
  filters: FilterState
  onFiltersChange: (filters: Partial<FilterState>) => void
  onToggleFavorite: (id: number) => void
  onSelectOpportunity: (opportunity: YieldFarmingOpportunity) => void
  onBrowseFarms: () => void
}

export function FavoritesTable({
  opportunities,
  favoriteOpportunities,
  filters,
  onFiltersChange,
  onToggleFavorite,
  onSelectOpportunity,
  onBrowseFarms,
}: FavoritesTableProps) {
  if (favoriteOpportunities.length === 0) {
    return (
      <Card className="flex h-[200px] flex-col items-center justify-center">
        <div className="text-center">
          <Star className="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-medium">No Favorites Yet</h3>
          <p className="mt-2 text-sm text-muted-foreground">Add farms to your favorites for quick access.</p>
          <Button className="mt-4" onClick={onBrowseFarms}>
            Browse Farms
          </Button>
        </div>
      </Card>
    )
  }

  return (
    <OpportunitiesTable
      opportunities={opportunities}
      favoriteOpportunities={favoriteOpportunities}
      filters={filters}
      onFiltersChange={onFiltersChange}
      onToggleFavorite={onToggleFavorite}
      onSelectOpportunity={onSelectOpportunity}
    />
  )
}
