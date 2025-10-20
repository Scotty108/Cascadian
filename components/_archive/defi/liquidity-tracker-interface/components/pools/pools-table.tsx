"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Eye, Filter, Plus, RefreshCw, Search, Star } from "lucide-react"
import { useState, useEffect } from "react"
import type { LiquidityPool } from "../../types"
import { getRiskVariant } from "../../utils"
import { AddLiquidityModal } from "./add-liquidity-modal"
import { PoolDetailsModal } from "./pool-details-modal"

interface PoolsTableProps {
  pools: LiquidityPool[]
  searchTerm: string
  onSearchChange: (value: string) => void
}

export function PoolsTable({ pools, searchTerm, onSearchChange }: PoolsTableProps) {
  const [selectedPool, setSelectedPool] = useState<LiquidityPool | null>(null)
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false)
  const [isAddLiquidityModalOpen, setIsAddLiquidityModalOpen] = useState(false)
  const [favoritePoolIds, setFavoritePoolIds] = useState<Set<string>>(new Set())
  const [sortField, setSortField] = useState<string>("")
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc")
  const [localSearchTerm, setLocalSearchTerm] = useState<string>(searchTerm)
  const [filteredPools, setFilteredPools] = useState<LiquidityPool[]>(pools)

  // Update local search term when prop changes
  useEffect(() => {
    setLocalSearchTerm(searchTerm)
  }, [searchTerm])

  // Handle search input changes
  const handleSearchChange = (value: string) => {
    setLocalSearchTerm(value)
    onSearchChange(value)
  }

  // Filter and sort pools when dependencies change
  useEffect(() => {
    let result = [...pools]

    // Apply search filter
    if (localSearchTerm) {
      const searchLower = localSearchTerm.toLowerCase()
      result = result.filter(
        (pool) =>
          pool.name.toLowerCase().includes(searchLower) ||
          pool.protocol.toLowerCase().includes(searchLower) ||
          (pool.chain && pool.chain.toLowerCase().includes(searchLower)),
      )
    }

    // Apply sorting
    if (sortField) {
      result.sort((a, b) => {
        let valueA: any = a[sortField as keyof LiquidityPool]
        let valueB: any = b[sortField as keyof LiquidityPool]

        // Handle special cases for formatted values
        if (typeof valueA === "string" && valueA.startsWith("$")) {
          valueA = Number.parseFloat(valueA.replace(/[$,]/g, ""))
          valueB = Number.parseFloat((valueB as string).replace(/[$,]/g, ""))
        }

        if (typeof valueA === "string" && valueA.endsWith("%")) {
          valueA = Number.parseFloat(valueA.replace(/%/g, ""))
          valueB = Number.parseFloat((valueB as string).replace(/%/g, ""))
        }

        if (sortDirection === "asc") {
          return valueA > valueB ? 1 : -1
        } else {
          return valueA < valueB ? 1 : -1
        }
      })
    }

    setFilteredPools(result)
  }, [pools, localSearchTerm, sortField, sortDirection])

  const handleViewDetails = (pool: LiquidityPool) => {
    setSelectedPool(pool)
    setIsDetailsModalOpen(true)
  }

  const handleAddLiquidity = (pool: LiquidityPool) => {
    setSelectedPool(pool)
    setIsAddLiquidityModalOpen(true)
  }

  const handleToggleFavorite = (poolId: string) => {
    const newFavorites = new Set(favoritePoolIds)
    if (newFavorites.has(poolId)) {
      newFavorites.delete(poolId)
    } else {
      newFavorites.add(poolId)
    }
    setFavoritePoolIds(newFavorites)
  }

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc")
    } else {
      setSortField(field)
      setSortDirection("desc")
    }
  }

  const handleRefresh = () => {
    // Refresh data logic here
    console.log("Refreshing pool data...")
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
            <div>
              <CardTitle>Liquidity Pools Explorer</CardTitle>
              <CardDescription>Explore and analyze liquidity pools across protocols</CardDescription>
            </div>
            <div className="flex gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Search pools..."
                  className="w-full md:w-[200px] pl-8"
                  value={localSearchTerm}
                  onChange={(e) => handleSearchChange(e.target.value)}
                />
              </div>
              <Button variant="outline" size="icon" onClick={handleRefresh}>
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon">
                <Filter className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead className="cursor-pointer hover:text-foreground" onClick={() => handleSort("name")}>
                    Pool {sortField === "name" && (sortDirection === "asc" ? "↑" : "↓")}
                  </TableHead>
                  <TableHead className="cursor-pointer hover:text-foreground" onClick={() => handleSort("protocol")}>
                    Protocol {sortField === "protocol" && (sortDirection === "asc" ? "↑" : "↓")}
                  </TableHead>
                  <TableHead>Chain</TableHead>
                  <TableHead className="cursor-pointer hover:text-foreground" onClick={() => handleSort("tvl")}>
                    TVL {sortField === "tvl" && (sortDirection === "asc" ? "↑" : "↓")}
                  </TableHead>
                  <TableHead className="cursor-pointer hover:text-foreground" onClick={() => handleSort("volume24h")}>
                    24h Volume {sortField === "volume24h" && (sortDirection === "asc" ? "↑" : "↓")}
                  </TableHead>
                  <TableHead>7d Volume</TableHead>
                  <TableHead className="cursor-pointer hover:text-foreground" onClick={() => handleSort("apy")}>
                    APY {sortField === "apy" && (sortDirection === "asc" ? "↑" : "↓")}
                  </TableHead>
                  <TableHead>Fee</TableHead>
                  <TableHead>IL Risk</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPools.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                      No pools found matching your search criteria
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredPools.map((pool, index) => (
                    <TableRow key={`${pool.id}-${index}`} className="hover:bg-muted/50">
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleFavorite(`${pool.id}`)}
                          className="h-8 w-8 p-0"
                        >
                          <Star
                            className={`h-4 w-4 ${favoritePoolIds.has(`${pool.id}`) ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`}
                          />
                        </Button>
                      </TableCell>
                      <TableCell className="font-medium">{pool.name}</TableCell>
                      <TableCell>{pool.protocol}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {pool.chain || (index % 2 === 0 ? "Ethereum" : index % 3 === 0 ? "Polygon" : "BSC")}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">{pool.tvl}</TableCell>
                      <TableCell>{pool.volume24h}</TableCell>
                      <TableCell>
                        {pool.volume7d ||
                          `$${(Number.parseFloat(pool.volume24h.replace(/[^0-9.]/g, "")) * 5.2).toFixed(1)}M`}
                      </TableCell>
                      <TableCell className="text-green-600 font-medium">{pool.apy}</TableCell>
                      <TableCell>{pool.fee}</TableCell>
                      <TableCell className="text-red-500">{pool.impermanentLoss}</TableCell>
                      <TableCell>
                        <Badge variant={getRiskVariant(pool.risk)}>{pool.risk}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleViewDetails(pool)}
                            className="h-8 px-2"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleAddLiquidity(pool)}
                            className="h-8 px-2"
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Modals */}
      <PoolDetailsModal
        pool={selectedPool}
        isOpen={isDetailsModalOpen}
        onClose={() => setIsDetailsModalOpen(false)}
        onAddLiquidity={handleAddLiquidity}
        onToggleFavorite={handleToggleFavorite}
        isFavorite={selectedPool ? favoritePoolIds.has(`${selectedPool.id}`) : false}
      />

      <AddLiquidityModal
        pool={selectedPool}
        isOpen={isAddLiquidityModalOpen}
        onClose={() => setIsAddLiquidityModalOpen(false)}
      />
    </>
  )
}
