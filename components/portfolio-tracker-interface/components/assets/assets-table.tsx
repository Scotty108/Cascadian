"use client"

import Image from "next/image";
import type React from "react"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ArrowUpDown, Star, TrendingUp, TrendingDown } from "lucide-react"
import { formatCurrency, formatHoldings, formatPercentage, getChangeColor } from "../../utils"
import type { Asset } from "../../types"

interface AssetsTableProps {
  assets: Asset[]
  onAssetClick?: (asset: Asset) => void
}

type SortField = "name" | "value" | "holdings" | "price" | "pnl" | "allocation"
type SortDirection = "asc" | "desc"

export function AssetsTable({ assets, onAssetClick }: AssetsTableProps) {
  const [sortField, setSortField] = useState<SortField>("value")
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc")
  const [favorites, setFavorites] = useState<Set<number>>(new Set())

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc")
    } else {
      setSortField(field)
      setSortDirection("desc")
    }
  }

  const toggleFavorite = (assetId: number, e: React.MouseEvent) => {
    e.stopPropagation()
    const newFavorites = new Set(favorites)
    if (favorites.has(assetId)) {
      newFavorites.delete(assetId)
    } else {
      newFavorites.add(assetId)
    }
    setFavorites(newFavorites)
  }

  const sortedAssets = [...assets].sort((a, b) => {
    let aValue: number | string
    let bValue: number | string

    switch (sortField) {
      case "name":
        aValue = a.name
        bValue = b.name
        break
      case "value":
        aValue = a.value
        bValue = b.value
        break
      case "holdings":
        aValue = a.holdings
        bValue = b.holdings
        break
      case "price":
        aValue = a.price
        bValue = b.price
        break
      case "pnl":
        aValue = a.pnl
        bValue = b.pnl
        break
      case "allocation":
        aValue = a.allocation
        bValue = b.allocation
        break
      default:
        aValue = a.value
        bValue = b.value
    }

    if (typeof aValue === "string" && typeof bValue === "string") {
      return sortDirection === "asc" ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue)
    }

    return sortDirection === "asc" ? (aValue as number) - (bValue as number) : (bValue as number) - (aValue as number)
  })

  const SortButton = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <Button variant="ghost" size="sm" className="h-auto p-0 font-medium" onClick={() => handleSort(field)}>
      {children}
      <ArrowUpDown className="ml-1 h-3 w-3" />
    </Button>
  )

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="overflow-x-auto" style={{ maxHeight: '600px', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <table className="w-full whitespace-nowrap caption-bottom text-sm border-collapse">
          <thead className="sticky top-0 z-40 bg-background border-b border-border">
            <tr>
              <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground w-[50px]"></th>
              <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground">
                <SortButton field="name">Asset</SortButton>
              </th>
              <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground">
                <SortButton field="price">Price</SortButton>
              </th>
              <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground">
                <SortButton field="holdings">Holdings</SortButton>
              </th>
              <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground">
                <SortButton field="value">Value</SortButton>
              </th>
              <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground">
                <SortButton field="allocation">Allocation</SortButton>
              </th>
              <th className="px-2 py-3 text-right align-middle font-medium text-muted-foreground">
                <SortButton field="pnl">P&L</SortButton>
              </th>
              <th className="px-2 py-3 text-left align-middle font-medium text-muted-foreground">Chain</th>
            </tr>
          </thead>
          <tbody>
            {sortedAssets.map((asset) => (
              <tr
                key={asset.id}
                className="border-b border-border hover:bg-muted/30 transition cursor-pointer"
                onClick={() => onAssetClick?.(asset)}
              >
                <td className="px-2 py-1.5 align-middle">
                  <Button variant="ghost" size="sm" className="h-auto p-1" onClick={(e) => toggleFavorite(asset.id, e)}>
                    <Star
                      className={`h-4 w-4 ${
                        favorites.has(asset.id) ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"
                      }`}
                    />
                  </Button>
                </td>
                <td className="px-2 py-1.5 align-middle">
                  <div className="flex items-center gap-3">
                    <Image src={asset.icon || "/placeholder.svg"} alt={asset.name} className="w-8 h-8 rounded-full" width={32} height={32} />
                    <div>
                      <div className="font-medium">{asset.name}</div>
                      <div className="text-sm text-muted-foreground">{asset.symbol}</div>
                    </div>
                  </div>
                </td>
                <td className="px-2 py-1.5 align-middle text-right">
                  <div className="space-y-1">
                    <div className="font-medium">${formatCurrency(asset.price)}</div>
                    <div className={`text-sm flex items-center justify-end gap-1 ${getChangeColor(2.5)}`}>
                      {2.5 > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                      {formatPercentage(2.5)}
                    </div>
                  </div>
                </td>
                <td className="px-2 py-1.5 align-middle text-right font-medium">
                  {formatHoldings(asset.holdings)} {asset.symbol}
                </td>
                <td className="px-2 py-1.5 align-middle text-right font-medium">${formatCurrency(asset.value)}</td>
                <td className="px-2 py-1.5 align-middle text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-16 bg-muted rounded-full h-2">
                      <div
                        className="bg-primary h-2 rounded-full"
                        style={{ width: `${Math.min(asset.allocation, 100)}%` }}
                      />
                    </div>
                    <span className="text-sm font-medium">{asset.allocation}%</span>
                  </div>
                </td>
                <td className="px-2 py-1.5 align-middle text-right">
                  <div className={`font-medium ${getChangeColor(asset.pnl)}`}>
                    {asset.pnl >= 0 ? "+" : ""}${formatCurrency(Math.abs(asset.pnl))}
                  </div>
                  <div className={`text-sm ${getChangeColor(asset.pnl)}`}>
                    {formatPercentage((asset.pnl / asset.cost) * 100)}
                  </div>
                </td>
                <td className="px-2 py-1.5 align-middle">
                  <Badge variant="outline">{asset.chain}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
