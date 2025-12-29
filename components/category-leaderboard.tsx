/**
 * Category Leaderboard Component
 *
 * Top-down category analysis using Austin Methodology
 * Shows "winnable games" - categories where elite wallets succeed
 */

"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useAustinMethodology } from "@/hooks/use-austin-methodology"
import { Trophy, Target, TrendingUp, Users, DollarSign, Zap } from "lucide-react"

interface CategoryLeaderboardProps {
  defaultWindow?: '24h' | '7d' | '30d' | 'lifetime'
  limit?: number
  showOnlyWinnable?: boolean
  compact?: boolean
}

export function CategoryLeaderboard({
  defaultWindow = '30d',
  limit = 20,
  showOnlyWinnable = false,
  compact = false
}: CategoryLeaderboardProps) {
  const [window, setWindow] = useState<'24h' | '7d' | '30d' | 'lifetime'>(defaultWindow)
  const [winnableOnly, setWinnableOnly] = useState(showOnlyWinnable)

  const { categories, winnableCategories, loading, error, refresh } = useAustinMethodology({
    window,
    limit,
    autoFetch: true
  })

  const displayCategories = winnableOnly ? winnableCategories : categories

  const getWinnabilityColor = (score: number): string => {
    if (score >= 80) return 'bg-green-500'
    if (score >= 60) return 'bg-yellow-500'
    if (score >= 40) return 'bg-orange-500'
    return 'bg-red-500'
  }

  const getWinnabilityGrade = (score: number): string => {
    if (score >= 80) return 'A'
    if (score >= 60) return 'B'
    if (score >= 40) return 'C'
    if (score >= 20) return 'D'
    return 'F'
  }

  const formatCurrency = (value: number) => {
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(1)}M`
    }
    if (value >= 1000) {
      return `$${(value / 1000).toFixed(0)}K`
    }
    return `$${value.toFixed(0)}`
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl text-red-500">Error Loading Categories</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">{error}</p>
          <Button onClick={refresh} className="mt-4">
            Retry
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-xl flex items-center gap-2">
              <Target className="h-5 w-5 text-blue-500" />
              Category Winnability Leaderboard
            </CardTitle>
            <CardDescription className="mt-1">
              Top categories ranked by Austin Methodology • Find &quot;winnable games&quot;
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            {/* Winnable Only Toggle */}
            <Button
              variant={winnableOnly ? "default" : "outline"}
              size="sm"
              onClick={() => setWinnableOnly(!winnableOnly)}
            >
              <Trophy className="h-4 w-4 mr-1" />
              {winnableOnly ? 'Winnable Only' : 'Show All'}
            </Button>

            {/* Time Window Filter */}
            <Select value={window} onValueChange={(val) => setWindow(val as typeof window)}>
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="24h">24 Hours</SelectItem>
                <SelectItem value="7d">7 Days</SelectItem>
                <SelectItem value="30d">30 Days</SelectItem>
                <SelectItem value="lifetime">All Time</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-pulse text-muted-foreground">Loading categories...</div>
          </div>
        ) : displayCategories.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64">
            <Trophy className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              {winnableOnly ? 'No winnable categories found' : 'No categories found'}
            </p>
            {winnableOnly && (
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => setWinnableOnly(false)}
              >
                Show All Categories
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {displayCategories.map((category) => {
              const winnabilityColor = getWinnabilityColor(category.winnabilityScore)
              const winnabilityGrade = getWinnabilityGrade(category.winnabilityScore)

              return (
                <div
                  key={category.category}
                  className="border rounded-lg p-4 hover:bg-muted/50 transition-colors"
                >
                  {/* Category Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      {/* Rank */}
                      <div className="flex-shrink-0 w-8 text-center">
                        {category.categoryRank <= 3 ? (
                          <span className="text-2xl">{['🥇', '🥈', '🥉'][category.categoryRank - 1]}</span>
                        ) : (
                          <span className="text-lg font-bold text-muted-foreground">
                            #{category.categoryRank}
                          </span>
                        )}
                      </div>

                      {/* Category Name */}
                      <div>
                        <h3 className="font-semibold text-lg">{category.category}</h3>
                        <p className="text-xs text-muted-foreground">
                          {category.activeMarketCount} active markets • {category.eliteWalletCount} elite wallets
                        </p>
                      </div>
                    </div>

                    {/* Winnability Badge */}
                    <div className="flex items-center gap-2">
                      {category.isWinnableGame && (
                        <Badge className="bg-purple-500 hover:bg-purple-600 text-white font-bold">
                          🎯 WINNABLE GAME
                        </Badge>
                      )}
                      <Badge className={`${winnabilityColor} text-white font-bold text-base px-3`}>
                        {winnabilityGrade}
                      </Badge>
                    </div>
                  </div>

                  {/* Winnability Score Bar */}
                  <div className="mb-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-muted-foreground">
                        Winnability Score
                      </span>
                      <span className="text-sm font-bold">
                        {category.winnabilityScore.toFixed(0)}/100
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-3">
                      <div
                        className={`h-3 rounded-full transition-all duration-300 ${winnabilityColor}`}
                        style={{ width: `${category.winnabilityScore}%` }}
                      />
                    </div>
                  </div>

                  {/* Metrics Grid */}
                  {!compact && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t">
                      {/* Elite Wallets */}
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-blue-500" />
                        <div>
                          <p className="text-xs text-muted-foreground">Elite Wallets</p>
                          <p className="font-semibold">{category.eliteWalletCount}</p>
                        </div>
                      </div>

                      {/* Median Omega */}
                      <div className="flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-green-500" />
                        <div>
                          <p className="text-xs text-muted-foreground">Median Ω</p>
                          <p className="font-semibold">{category.medianOmegaOfElites.toFixed(2)}</p>
                        </div>
                      </div>

                      {/* Mean CLV */}
                      <div className="flex items-center gap-2">
                        <Zap className="h-4 w-4 text-yellow-500" />
                        <div>
                          <p className="text-xs text-muted-foreground">Mean CLV</p>
                          <p className="font-semibold">{(category.meanCLVOfElites * 100).toFixed(1)}%</p>
                        </div>
                      </div>

                      {/* EV per Hour */}
                      <div className="flex items-center gap-2">
                        <DollarSign className="h-4 w-4 text-green-600" />
                        <div>
                          <p className="text-xs text-muted-foreground">EV/Hour</p>
                          <p className="font-semibold">{formatCurrency(category.avgEVPerHour)}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Compact Metrics */}
                  {compact && (
                    <div className="flex items-center justify-between pt-2 border-t text-sm">
                      <div>
                        <span className="text-muted-foreground">Elite Ω: </span>
                        <span className="font-semibold">{category.medianOmegaOfElites.toFixed(2)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">CLV: </span>
                        <span className="font-semibold">{(category.meanCLVOfElites * 100).toFixed(1)}%</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">EV/hr: </span>
                        <span className="font-semibold">{formatCurrency(category.avgEVPerHour)}</span>
                      </div>
                    </div>
                  )}

                  {/* Top Markets (if available) */}
                  {!compact && category.topMarkets && category.topMarkets.length > 0 && (
                    <div className="mt-3 pt-3 border-t">
                      <p className="text-xs font-medium text-muted-foreground mb-2">
                        Top Markets in {category.category}:
                      </p>
                      <div className="space-y-1">
                        {category.topMarkets.slice(0, 3).map((market) => (
                          <div
                            key={market.marketId}
                            className="text-xs flex items-center justify-between px-2 py-1 bg-muted/50 rounded"
                          >
                            <span className="truncate flex-1">{market.question}</span>
                            <span className="text-muted-foreground ml-2">
                              {formatCurrency(market.volume24h)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Summary Stats */}
        {!loading && displayCategories.length > 0 && (
          <div className="mt-6 pt-4 border-t grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div>
              <p className="text-sm text-muted-foreground">Total Categories</p>
              <p className="text-2xl font-bold">{categories.length}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Winnable Games</p>
              <p className="text-2xl font-bold text-green-600">{winnableCategories.length}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Avg Winnability</p>
              <p className="text-2xl font-bold">
                {(categories.reduce((sum, c) => sum + c.winnabilityScore, 0) / categories.length).toFixed(0)}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Win Rate</p>
              <p className="text-2xl font-bold text-purple-600">
                {((winnableCategories.length / categories.length) * 100).toFixed(0)}%
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
