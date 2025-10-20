"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { BarChart3, Calculator, Heart, Plus, Wallet } from "lucide-react";
import { Cell, Legend, Pie, PieChart, Tooltip as RechartsTooltip, ResponsiveContainer } from "recharts";
import { activeStakes, portfolioAllocation } from "../data";
import type { StakingPool } from "../types";
import { formatNumber, formatPercent } from "../utils";

interface OverviewTabProps {
  onTabChange: (tab: string) => void;
  onShowCalculator: () => void;
  onStakePool: (pool: StakingPool) => void;
  onToggleFavorite: (poolId: string) => void;
  favoritesPools: StakingPool[];
}

export function OverviewTab({ onTabChange, onShowCalculator, onStakePool, onToggleFavorite, favoritesPools }: OverviewTabProps) {
  // Calculate totals
  const totalStakedValue = activeStakes.reduce((sum, stake) => sum + stake.stakedValue, 0);
  const totalRewardsValue = activeStakes.reduce((sum, stake) => sum + stake.rewardsValue, 0);
  const weightedApySum = activeStakes.reduce((sum, stake) => sum + stake.apy * stake.stakedValue, 0);
  const averageApy = totalStakedValue > 0 ? weightedApySum / totalStakedValue : 0;

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Staked Value</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(totalStakedValue)}</div>
            <p className="text-xs text-muted-foreground">Across {activeStakes.length} staking positions</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Rewards</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNumber(totalRewardsValue)}</div>
            <p className="text-xs text-muted-foreground">Earned from all staking positions</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Average APY</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatPercent(averageApy)}</div>
            <p className="text-xs text-muted-foreground">Weighted by staked value</p>
          </CardContent>
        </Card>
      </div>

      {/* Portfolio and Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Portfolio Allocation</CardTitle>
            <CardDescription>Distribution of your staked assets</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={portfolioAllocation}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="value"
                    nameKey="name"
                    label={({ name, percent }) => (percent !== undefined ? `${name} ${(percent * 100).toFixed(0)}%` : `${name}`)}
                  >
                    {portfolioAllocation.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Legend />
                  <RechartsTooltip formatter={(value: number) => [`${formatNumber(value)}`, "Value"]} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Common staking operations</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button className="w-full" onClick={() => onTabChange("discover")}>
              <Plus className="mr-2 h-4 w-4" />
              Stake New Assets
            </Button>

            <Button variant="outline" className="w-full" onClick={onShowCalculator}>
              <Calculator className="mr-2 h-4 w-4" />
              Staking Calculator
            </Button>

            <Button variant="outline" className="w-full" onClick={() => onTabChange("analytics")}>
              <BarChart3 className="mr-2 h-4 w-4" />
              View Analytics
            </Button>

            <Button variant="outline" className="w-full" onClick={() => onTabChange("my-stakes")}>
              <Wallet className="mr-2 h-4 w-4" />
              Manage Stakes
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Featured Staking Opportunities */}
      <Card>
        <CardHeader>
          <CardTitle>Featured Staking Opportunities</CardTitle>
          <CardDescription>Recommended pools based on your portfolio</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {favoritesPools.map((pool) => (
              <Card key={pool.id} className="overflow-hidden">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={pool.tokenLogo || "/placeholder.svg"} alt={pool.token} />
                        <AvatarFallback>{pool.tokenSymbol.substring(0, 2)}</AvatarFallback>
                      </Avatar>
                      <div>
                        <CardTitle className="text-base">{pool.name}</CardTitle>
                        <CardDescription className="text-xs">{pool.protocol}</CardDescription>
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onToggleFavorite(pool.id)}>
                      <Heart className={cn("h-4 w-4", pool.isFavorite ? "fill-primary text-primary" : "")} />
                      <span className="sr-only">Toggle favorite</span>
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="pb-2">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <div className="text-muted-foreground">APY</div>
                      <div className="font-medium text-lg text-green-500">{formatPercent(pool.apy)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">TVL</div>
                      <div className="font-medium">{formatNumber(pool.tvl)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Lock Period</div>
                      <div className="font-medium">{pool.lockPeriodText}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Risk Level</div>
                      <div className="flex items-center">
                        <div className={cn("h-2 w-2 rounded-full mr-2", getRiskColor(pool.riskLevel))}></div>
                        <span>{pool.riskLevel}</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
                <CardContent>
                  <Button className="w-full" onClick={() => onStakePool(pool)}>
                    Stake {pool.tokenSymbol}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function getRiskColor(risk: string): string {
  switch (risk) {
    case "Low":
      return "bg-green-500";
    case "Medium":
      return "bg-yellow-500";
    case "High":
      return "bg-red-500";
    default:
      return "bg-gray-500";
  }
}
