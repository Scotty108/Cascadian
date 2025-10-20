"use client"

import { Check, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { Plan, BillingCycle } from "../types"
import { formatCurrency, getPlanPrice, getAnnualTotal, isCurrentPlan } from "../utils"
import { cn } from "@/lib/utils"

interface PlanCardProps {
  plan: Plan
  billingCycle: BillingCycle
  currentPlan: Plan
  onUpgrade: (planName: string) => void
}

export function PlanCard({ plan, billingCycle, currentPlan, onUpgrade }: PlanCardProps) {
  const price = getPlanPrice(plan, billingCycle)
  const isCurrent = isCurrentPlan(plan, currentPlan)

  return (
    <div
      className={cn(
        "relative rounded-lg border p-4 transition-all",
        plan.popular && "border-primary shadow-sm",
        isCurrent && "bg-muted/50",
      )}
    >
      {plan.popular && <Badge className="absolute -top-2 right-4 bg-primary">Popular</Badge>}

      <div className="mb-4 space-y-1">
        <h3 className="font-bold">{plan.name}</h3>
        <p className="text-sm text-muted-foreground">{plan.description}</p>
      </div>

      <div className="mb-4">
        <span className="text-3xl font-bold">{formatCurrency(price)}</span>
        <span className="text-muted-foreground">{price > 0 ? "/month" : ""}</span>
        {billingCycle === "annual" && price > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">Billed annually ({formatCurrency(getAnnualTotal(plan))})</p>
        )}
      </div>

      <div className="mb-4 space-y-2">
        {plan.features.slice(0, 5).map((feature) => (
          <div key={feature.name} className="flex items-center gap-2">
            {feature.included ? (
              <Check className="h-4 w-4 text-green-500" />
            ) : (
              <X className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="text-sm">{feature.name}</span>
          </div>
        ))}
        {plan.features.length > 5 && (
          <div className="pt-1 text-xs text-muted-foreground">+{plan.features.length - 5} more features</div>
        )}
      </div>

      <Button
        className="w-full"
        variant={isCurrent ? "secondary" : "default"}
        disabled={plan.disabled}
        onClick={() => onUpgrade(plan.name)}
      >
        {plan.cta}
      </Button>
    </div>
  )
}
