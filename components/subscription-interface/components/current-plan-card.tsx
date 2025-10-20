"use client"

import { Calendar } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import type { Plan, UsageItem, BillingCycle } from "../types"
import { UsageProgressItem } from "./usage-progress-item"

interface CurrentPlanCardProps {
  currentPlan: Plan
  billingCycle: BillingCycle
  usageData: UsageItem[]
  onCancelSubscription: () => void
}

export function CurrentPlanCard({ currentPlan, billingCycle, usageData, onCancelSubscription }: CurrentPlanCardProps) {
  return (
    <Card className="lg:col-span-1">
      <CardHeader>
        <CardTitle>Current Plan</CardTitle>
        <CardDescription>Your subscription details and usage</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">{currentPlan.name} Plan</p>
            <p className="text-sm text-muted-foreground">{billingCycle === "monthly" ? "Monthly" : "Annual"} billing</p>
          </div>
          <Badge variant="secondary" className="px-3 py-1">
            Active
          </Badge>
        </div>

        <div className="rounded-lg bg-muted p-3">
          <div className="flex items-center justify-between">
            <div className="text-sm">
              <p className="font-medium">Next billing date</p>
              <p className="text-muted-foreground">June 1, 2025</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <Calendar className="h-5 w-5 text-primary" />
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <p className="text-sm font-medium">Plan Usage</p>
          {usageData.map((item) => (
            <UsageProgressItem key={item.name} item={item} />
          ))}
        </div>
      </CardContent>
      <CardFooter className="flex flex-col gap-2">
        <Button variant="outline" className="w-full" onClick={onCancelSubscription}>
          Cancel Subscription
        </Button>
      </CardFooter>
    </Card>
  )
}
