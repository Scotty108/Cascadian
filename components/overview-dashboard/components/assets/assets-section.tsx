"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { AssetsFilters } from "./assets-filters"
import { AssetsTable } from "./assets-table"
import { PortfolioSummary } from "./portfolio-summary"
import type { Asset, FilterState } from "../../types"

interface AssetsSectionProps {
  assets: Asset[]
  totalPortfolioValue: number
  filters: FilterState
  onFilterChange: (key: keyof FilterState, value: string) => void
}

export function AssetsSection({ assets, totalPortfolioValue, filters, onFilterChange }: AssetsSectionProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start sm:items-center justify-between gap-4">
          <div>
            <CardTitle>Assets List</CardTitle>
            <CardDescription>{assets.length} Assets</CardDescription>
          </div>
          <AssetsFilters
            search={filters.assetSearch}
            assetType={filters.assetType}
            onSearchChange={(value) => onFilterChange("assetSearch", value)}
            onAssetTypeChange={(value) => onFilterChange("assetType", value)}
          />
        </div>
      </CardHeader>
      <CardContent>
        <PortfolioSummary totalValue={totalPortfolioValue} />
        <AssetsTable assets={assets} />
      </CardContent>
    </Card>
  )
}
