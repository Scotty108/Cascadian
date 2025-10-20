"use client"

import type React from "react"

import { ArrowUpDown, ChevronDown, ExternalLink, Info, Shield, Bookmark, Star, StarOff } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import type { Protocol, SortConfig } from "../types"
import { CHAINS, RISK_LEVELS } from "../constants"
import { formatCurrency, truncateText } from "../utils"

interface ProtocolsTableProps {
  protocols: Protocol[]
  favorites: string[]
  sortConfig: SortConfig
  onSortChange: (field: string) => void
  onFavoriteToggle: (id: string) => void
  onProtocolSelect: (id: string) => void
}

export function ProtocolsTable({
  protocols,
  favorites,
  sortConfig,
  onSortChange,
  onFavoriteToggle,
  onProtocolSelect,
}: ProtocolsTableProps) {
  const handleVisitWebsite = (protocol: Protocol, e: React.MouseEvent) => {
    e.stopPropagation()
    if (protocol.website) {
      window.open(protocol.website, "_blank", "noopener,noreferrer")
    } else {
      // Fallback: construct a generic website URL or show message
      const websiteUrl = `https://${protocol.name.toLowerCase().replace(/\s+/g, "")}.com`
      window.open(websiteUrl, "_blank", "noopener,noreferrer")
    }
  }

  const handleViewDetails = (protocol: Protocol, e: React.MouseEvent) => {
    e.stopPropagation()
    onProtocolSelect(protocol.id)
  }

  const handleViewAuditReports = (protocol: Protocol, e: React.MouseEvent) => {
    e.stopPropagation()
    if (protocol.auditReports && protocol.auditReports.length > 0) {
      // Open the first audit report or show a modal with all reports
      window.open(protocol.auditReports[0], "_blank", "noopener,noreferrer")
    } else if (protocol.audited) {
      // If protocol is audited but no specific reports, show a generic message
      alert(`${protocol.name} has been audited. Please visit their website for audit details.`)
    } else {
      // Show a message that no audit reports are available
      alert("No audit reports available for this protocol")
    }
  }

  const handleAddToWatchlist = (protocol: Protocol, e: React.MouseEvent) => {
    e.stopPropagation()
    // Toggle watchlist status
    onFavoriteToggle(protocol.id)

    // Show feedback to user
    const isCurrentlyFavorited = favorites.includes(protocol.id)
    const message = isCurrentlyFavorited
      ? `${protocol.name} removed from watchlist`
      : `${protocol.name} added to watchlist`

    // You could replace this with a toast notification
    console.log(message)
  }

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12"></TableHead>
              <TableHead>
                <Button
                  variant="ghost"
                  className="flex items-center gap-1 p-0 font-medium"
                  onClick={() => onSortChange("name")}
                >
                  Protocol
                  {sortConfig.field === "name" && (
                    <ArrowUpDown
                      className={cn("ml-1 h-4 w-4", sortConfig.order === "desc" ? "rotate-180" : "rotate-0")}
                    />
                  )}
                </Button>
              </TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Chains</TableHead>
              <TableHead>
                <Button
                  variant="ghost"
                  className="flex items-center gap-1 p-0 font-medium"
                  onClick={() => onSortChange("tvl")}
                >
                  TVL
                  {sortConfig.field === "tvl" && (
                    <ArrowUpDown
                      className={cn("ml-1 h-4 w-4", sortConfig.order === "desc" ? "rotate-180" : "rotate-0")}
                    />
                  )}
                </Button>
              </TableHead>
              <TableHead>
                <Button
                  variant="ghost"
                  className="flex items-center gap-1 p-0 font-medium"
                  onClick={() => onSortChange("tvlChange")}
                >
                  Change (7d)
                  {sortConfig.field === "tvlChange" && (
                    <ArrowUpDown
                      className={cn("ml-1 h-4 w-4", sortConfig.order === "desc" ? "rotate-180" : "rotate-0")}
                    />
                  )}
                </Button>
              </TableHead>
              <TableHead>
                <Button
                  variant="ghost"
                  className="flex items-center gap-1 p-0 font-medium"
                  onClick={() => onSortChange("apy")}
                >
                  APY
                  {sortConfig.field === "apy" && (
                    <ArrowUpDown
                      className={cn("ml-1 h-4 w-4", sortConfig.order === "desc" ? "rotate-180" : "rotate-0")}
                    />
                  )}
                </Button>
              </TableHead>
              <TableHead>Risk</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {protocols.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="h-24 text-center">
                  No protocols found.
                </TableCell>
              </TableRow>
            ) : (
              protocols.map((protocol) => (
                <TableRow
                  key={protocol.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => onProtocolSelect(protocol.id)}
                >
                  <TableCell className="w-12">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={(e) => {
                        e.stopPropagation()
                        onFavoriteToggle(protocol.id)
                      }}
                    >
                      {favorites.includes(protocol.id) ? (
                        <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                      ) : (
                        <StarOff className="h-4 w-4 text-muted-foreground" />
                      )}
                    </Button>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={protocol.icon || "/placeholder.svg"} alt={protocol.name} />
                        <AvatarFallback>{protocol.name.substring(0, 2)}</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium">{protocol.name}</p>
                        <p className="text-xs text-muted-foreground">{truncateText(protocol.description, 30)}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{protocol.category}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex -space-x-1">
                      {protocol.chains.slice(0, 3).map((chainId) => {
                        const chain = CHAINS.find((c) => c.id === chainId)
                        return (
                          <TooltipProvider key={chainId}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Avatar className="h-6 w-6 border border-background">
                                  <AvatarImage src={chain?.icon || "/placeholder.svg"} alt={chain?.name} />
                                  <AvatarFallback>{chain?.name.substring(0, 1)}</AvatarFallback>
                                </Avatar>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>{chain?.name}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )
                      })}
                      {protocol.chains.length > 3 && (
                        <Avatar className="flex h-6 w-6 items-center justify-center rounded-full border border-background bg-muted text-xs">
                          +{protocol.chains.length - 3}
                        </Avatar>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{formatCurrency(protocol.tvl)}</TableCell>
                  <TableCell>
                    <span className={cn(protocol.tvlChange > 0 ? "text-green-500" : "text-red-500")}>
                      {protocol.tvlChange > 0 ? "+" : ""}
                      {protocol.tvlChange}%
                    </span>
                  </TableCell>
                  <TableCell>{protocol.apy}%</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <div className={cn("h-2 w-2 rounded-full", RISK_LEVELS[protocol.risk].color)} />
                      <span className="text-xs">{RISK_LEVELS[protocol.risk].label}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={(e) => handleVisitWebsite(protocol, e)}>
                          <ExternalLink className="mr-2 h-4 w-4" />
                          <span>Visit Website</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={(e) => handleViewDetails(protocol, e)}>
                          <Info className="mr-2 h-4 w-4" />
                          <span>View Details</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={(e) => handleViewAuditReports(protocol, e)}>
                          <Shield className="mr-2 h-4 w-4" />
                          <span>View Audit Reports</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={(e) => handleAddToWatchlist(protocol, e)}>
                          <Bookmark className="mr-2 h-4 w-4" />
                          <span>{favorites.includes(protocol.id) ? "Remove from Watchlist" : "Add to Watchlist"}</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
