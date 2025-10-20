"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Check, ShoppingCart, Sparkles } from "lucide-react"
import type { Strategy } from "../types"

interface PurchaseOptionsProps {
  strategy: Strategy
  onPurchase?: (strategyId: string) => void
}

export function PurchaseOptions({ strategy, onPurchase }: PurchaseOptionsProps) {
  const handlePurchase = () => {
    onPurchase?.(strategy.id)
  }

  if (strategy.isFree) {
    return (
      <div className="space-y-4">
        <div className="rounded-md bg-green-50 p-3 dark:bg-green-900/20">
          <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
            <Sparkles className="h-5 w-5" />
            <span className="font-medium">This strategy is free!</span>
          </div>
        </div>
        <Button className="w-full gap-2" onClick={handlePurchase}>
          <ShoppingCart className="h-4 w-4" />
          <span>Get Free Strategy</span>
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {strategy.subscription ? (
        <>
          <div className="rounded-md border-2 border-primary p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge>Recommended</Badge>
                <span className="font-medium">Yearly</span>
              </div>
              <div className="text-xl font-bold">
                ${strategy.subscription.yearly.toFixed(2)}
                <span className="text-xs font-normal text-muted-foreground">/year</span>
              </div>
            </div>
            <div className="mb-2 text-sm text-muted-foreground">
              Save ${(strategy.subscription.monthly * 12 - strategy.subscription.yearly).toFixed(2)} per year
            </div>
            <Button className="w-full gap-2" onClick={handlePurchase}>
              <ShoppingCart className="h-4 w-4" />
              <span>Buy Now</span>
            </Button>
          </div>

          <div className="rounded-md border p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-medium">Monthly</span>
              <div className="text-xl font-bold">
                ${strategy.subscription.monthly.toFixed(2)}
                <span className="text-xs font-normal text-muted-foreground">/month</span>
              </div>
            </div>
            <div className="mb-2 text-sm text-muted-foreground">Billed monthly, cancel anytime</div>
            <Button variant="outline" className="w-full gap-2" onClick={handlePurchase}>
              <ShoppingCart className="h-4 w-4" />
              <span>Subscribe</span>
            </Button>
          </div>
        </>
      ) : (
        <div className="rounded-md border p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-medium">One-time Purchase</span>
            <div className="text-xl font-bold">${strategy.price.toFixed(2)}</div>
          </div>
          <div className="mb-2 text-sm text-muted-foreground">Lifetime access to this strategy</div>
          <Button className="w-full gap-2" onClick={handlePurchase}>
            <ShoppingCart className="h-4 w-4" />
            <span>Buy Now</span>
          </Button>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-2">
        <div className="flex items-center gap-2 text-sm">
          <Check className="h-4 w-4 text-green-500" />
          <span>Free updates</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Check className="h-4 w-4 text-green-500" />
          <span>Technical support</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Check className="h-4 w-4 text-green-500" />
          <span>Use on multiple exchanges</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Check className="h-4 w-4 text-green-500" />
          <span>Customizable parameters</span>
        </div>
      </div>
    </div>
  )
}
