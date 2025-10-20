"use client";

import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowUpDown, Star, StarOff } from "lucide-react";
import { CHAIN_ICONS, RISK_COLORS } from "../../constants";
import type { FilterState, YieldFarmingOpportunity } from "../../types";
import { formatNumber } from "../../utils";

interface OpportunitiesTableProps {
  opportunities: YieldFarmingOpportunity[];
  favoriteOpportunities: number[];
  filters: FilterState;
  onFiltersChange: (filters: Partial<FilterState>) => void;
  onToggleFavorite: (id: number) => void;
  onSelectOpportunity: (opportunity: YieldFarmingOpportunity) => void;
}

export function OpportunitiesTable({ opportunities, favoriteOpportunities, filters, onFiltersChange, onToggleFavorite, onSelectOpportunity }: OpportunitiesTableProps) {
  const handleSort = () => {
    onFiltersChange({
      sortOrder: filters.sortOrder === "asc" ? "desc" : "asc",
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4 items-center justify-between">
        <h3 className="text-lg font-medium">Available Yield Farming Opportunities</h3>
        <div className="flex items-center space-x-2">
          <Label htmlFor="sort-by" className="text-sm">
            Sort by:
          </Label>
          <Select value={filters.sortBy} onValueChange={(value) => onFiltersChange({ sortBy: value })}>
            <SelectTrigger id="sort-by" className="w-[180px]">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="apy">APY</SelectItem>
              <SelectItem value="tvl">TVL</SelectItem>
              <SelectItem value="risk">Risk</SelectItem>
              <SelectItem value="protocol">Protocol</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="ghost" size="icon" onClick={handleSort}>
            <ArrowUpDown className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[50px]"></TableHead>
              <TableHead>Protocol / Asset</TableHead>
              <TableHead>Chain</TableHead>
              <TableHead>Farm Type</TableHead>
              <TableHead className="text-right">APY</TableHead>
              <TableHead className="text-right">TVL</TableHead>
              <TableHead>Risk</TableHead>
              <TableHead>Rewards</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {opportunities.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="h-24 text-center">
                  No yield farming opportunities found matching your criteria.
                </TableCell>
              </TableRow>
            ) : (
              opportunities.map((opportunity) => (
                <TableRow key={opportunity.id} className="cursor-pointer hover:bg-muted/50" onClick={() => onSelectOpportunity(opportunity)}>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFavorite(opportunity.id);
                      }}
                    >
                      {favoriteOpportunities.includes(opportunity.id) ? <Star className="h-4 w-4 text-yellow-500" /> : <StarOff className="h-4 w-4 text-muted-foreground" />}
                    </Button>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center">
                      <Image src={opportunity.logo || "/placeholder.svg"} alt={opportunity.protocol} width={32} height={32} className="mr-2 h-8 w-8 rounded-full" />
                      <div>
                        <div className="font-medium">{opportunity.protocol}</div>
                        <div className="text-sm text-muted-foreground">{opportunity.asset}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center">
                      <Image src={CHAIN_ICONS[opportunity.chain as keyof typeof CHAIN_ICONS] || "/placeholder.svg"} alt={opportunity.chain} width={16} height={16} className="mr-2 h-4 w-4 rounded-full" />
                      {opportunity.chain}
                    </div>
                  </TableCell>
                  <TableCell>{opportunity.farmType}</TableCell>
                  <TableCell className="text-right font-medium">{opportunity.apy.toFixed(2)}%</TableCell>
                  <TableCell className="text-right">{formatNumber(opportunity.tvl)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`${RISK_COLORS[opportunity.risk as keyof typeof RISK_COLORS]} text-white`}>
                      {opportunity.risk}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex space-x-1">
                      {opportunity.rewards.map((reward, index) => (
                        <Badge key={index} variant="secondary" className="text-xs">
                          {reward}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm">Deposit</Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
