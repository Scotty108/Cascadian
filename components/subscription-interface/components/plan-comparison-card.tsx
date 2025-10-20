"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { Plan, BillingCycle } from "../types"
import { BillingCycleToggle } from "./billing-cycle-toggle"
import { PlanCard } from "./plan-card"

interface PlanComparisonCardProps {
  plans: Plan[]
  billingCycle: BillingCycle
  currentPlan: Plan
  onToggleBillingCycle: () => void
  onUpgrade: (planName: string) => void
}

export function PlanComparisonCard({
  plans,
  billingCycle,
  currentPlan,
  onToggleBillingCycle,
  onUpgrade,
}: PlanComparisonCardProps) {
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <div className="flex items-center gap-4 flex-wrap  justify-between">
          <div>
            <CardTitle>Available Plans</CardTitle>
            <CardDescription>Compare plans and choose the best option for you</CardDescription>
          </div>
          <BillingCycleToggle billingCycle={billingCycle} onToggle={onToggleBillingCycle} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-3">
          {plans.map((plan) => (
            <PlanCard
              key={plan.name}
              plan={plan}
              billingCycle={billingCycle}
              currentPlan={currentPlan}
              onUpgrade={onUpgrade}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
