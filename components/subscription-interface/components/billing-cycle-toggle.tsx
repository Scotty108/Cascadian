"use client"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import type { BillingCycle } from "../types"
import { BILLING_CYCLES } from "../constants"

interface BillingCycleToggleProps {
  billingCycle: BillingCycle
  onToggle: () => void
}

export function BillingCycleToggle({ billingCycle, onToggle }: BillingCycleToggleProps) {
  return (
    <div className="flex items-center gap-2 rounded-lg border p-1">
      <Button
        variant={billingCycle === BILLING_CYCLES.MONTHLY ? "secondary" : "ghost"}
        size="sm"
        onClick={onToggle}
        className="text-xs"
      >
        Monthly
      </Button>
      <Button
        variant={billingCycle === BILLING_CYCLES.ANNUAL ? "secondary" : "ghost"}
        size="sm"
        onClick={onToggle}
        className="text-xs"
      >
        Annual
        <Badge variant="outline" className="ml-1 bg-green-500/10 text-green-500">
          Save 20%
        </Badge>
      </Button>
    </div>
  )
}
