"use client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { Download, Share2, Heart, ShoppingCart } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Strategy } from "../types"
import { formatNumber, getReturnColor, formatPercentage } from "../utils"
import { StarRating } from "./star-rating"
import { CreatorInfo } from "./creator-info"
import { PerformanceChart } from "./performance-chart"
import { RiskMetrics } from "./risk-metrics"
import { TradingDetails } from "./trading-details"
import { PurchaseOptions } from "./purchase-options"

interface StrategyDetailsModalProps {
  strategy: Strategy | null
  isOpen: boolean
  onClose: () => void
  onToggleFavorite: (id: string) => void
  onPurchase?: (strategyId: string) => void
}

const getReturnIcon = (value: number) => {
  if (value > 0) return "↗"
  if (value < 0) return "↘"
  return ""
}

export function StrategyDetailsModal({
  strategy,
  isOpen,
  onClose,
  onToggleFavorite,
  onPurchase,
}: StrategyDetailsModalProps) {
  if (!strategy) return null

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="text-2xl">{strategy.name}</DialogTitle>
          <DialogDescription>{strategy.description}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-6 py-4 md:grid-cols-3">
          {/* Left column - Performance metrics */}
          <div className="space-y-4 md:col-span-2">
            <div className="rounded-lg border p-4">
              <h3 className="mb-4 text-lg font-semibold">Performance</h3>

              <div className="mb-4">
                <PerformanceChart strategy={strategy} height={250} showControls />
              </div>

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <div className="text-sm text-muted-foreground">Daily Return</div>
                  <div
                    className={cn(
                      "flex items-center gap-1 text-lg font-semibold",
                      getReturnColor(strategy.returns.daily),
                    )}
                  >
                    <span>{getReturnIcon(strategy.returns.daily)}</span>
                    {formatPercentage(strategy.returns.daily)}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Weekly Return</div>
                  <div
                    className={cn(
                      "flex items-center gap-1 text-lg font-semibold",
                      getReturnColor(strategy.returns.weekly),
                    )}
                  >
                    <span>{getReturnIcon(strategy.returns.weekly)}</span>
                    {formatPercentage(strategy.returns.weekly)}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Monthly Return</div>
                  <div
                    className={cn(
                      "flex items-center gap-1 text-lg font-semibold",
                      getReturnColor(strategy.returns.monthly),
                    )}
                  >
                    <span>{getReturnIcon(strategy.returns.monthly)}</span>
                    {formatPercentage(strategy.returns.monthly)}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Yearly Return</div>
                  <div
                    className={cn(
                      "flex items-center gap-1 text-lg font-semibold",
                      getReturnColor(strategy.returns.yearly),
                    )}
                  >
                    <span>{getReturnIcon(strategy.returns.yearly)}</span>
                    {formatPercentage(strategy.returns.yearly)}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-lg border p-4">
                <h3 className="mb-4 text-lg font-semibold">Risk Metrics</h3>
                <RiskMetrics strategy={strategy} />
              </div>

              <div className="rounded-lg border p-4">
                <h3 className="mb-4 text-lg font-semibold">Trading Details</h3>
                <TradingDetails strategy={strategy} />
              </div>
            </div>

            <div className="rounded-lg border p-4">
              <h3 className="mb-4 text-lg font-semibold">Creator</h3>
              <CreatorInfo creator={strategy.creator} showDetails />
            </div>
          </div>

          {/* Right column - Purchase options */}
          <div className="space-y-4">
            <div className="rounded-lg border p-4">
              <h3 className="mb-4 text-lg font-semibold">Purchase Options</h3>
              <PurchaseOptions strategy={strategy} onPurchase={onPurchase} />
            </div>

            <div className="rounded-lg border p-4">
              <h3 className="mb-4 text-lg font-semibold">Strategy Details</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Category</span>
                  <Badge variant="secondary">{strategy.category}</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Rating</span>
                  <div className="flex items-center">
                    <StarRating rating={strategy.rating} size="sm" />
                    <span className="ml-1 text-xs text-muted-foreground">({strategy.reviews})</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Users</span>
                  <span className="text-sm font-medium">{formatNumber(strategy.purchases)}</span>
                </div>
                <Separator />
                <div>
                  <div className="mb-1 text-sm">Tags</div>
                  <div className="flex flex-wrap gap-1">
                    {strategy.tags.map((tag) => (
                      <Badge key={tag} variant="outline" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border p-4">
              <Button variant="outline" size="sm" className="gap-1">
                <Share2 className="h-4 w-4" />
                <span>Share</span>
              </Button>
              <Button variant="outline" size="sm" className="gap-1" onClick={() => onToggleFavorite(strategy.id)}>
                <Heart className={cn("h-4 w-4", strategy.isFavorite ? "fill-red-500 text-red-500" : "")} />
                <span>{strategy.isFavorite ? "Favorited" : "Add to Favorites"}</span>
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="gap-1">
            <Download className="h-4 w-4" />
            <span>Download Whitepaper</span>
          </Button>
          {strategy.isFree ? (
            <Button className="gap-1" onClick={() => onPurchase?.(strategy.id)}>
              <Download className="h-4 w-4" />
              <span>Get Free Strategy</span>
            </Button>
          ) : (
            <Button className="gap-1" onClick={() => onPurchase?.(strategy.id)}>
              <ShoppingCart className="h-4 w-4" />
              <span>Buy Now</span>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
