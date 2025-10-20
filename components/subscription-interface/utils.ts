import type { Plan, BillingCycle } from "./types"

export const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount)
}

export const formatDate = (dateString: string): string => {
  return new Date(dateString).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}

export const calculateAnnualSavings = (monthlyPrice: number, annualPrice: number): number => {
  const annualTotal = monthlyPrice * 12
  const savings = annualTotal - annualPrice * 12
  return Math.round((savings / annualTotal) * 100)
}

export const getPlanPrice = (plan: Plan, billingCycle: BillingCycle): number => {
  return plan.price[billingCycle]
}

export const getAnnualTotal = (plan: Plan): number => {
  return plan.price.annual * 12
}

export const isCurrentPlan = (plan: Plan, currentPlan: Plan): boolean => {
  return plan.name === currentPlan.name
}

export const canUpgrade = (plan: Plan, currentPlan: Plan): boolean => {
  const planOrder = ["Free", "Pro", "Enterprise"]
  const currentIndex = planOrder.indexOf(currentPlan.name)
  const targetIndex = planOrder.indexOf(plan.name)
  return targetIndex > currentIndex
}

export const canDowngrade = (plan: Plan, currentPlan: Plan): boolean => {
  const planOrder = ["Free", "Pro", "Enterprise"]
  const currentIndex = planOrder.indexOf(currentPlan.name)
  const targetIndex = planOrder.indexOf(plan.name)
  return targetIndex < currentIndex
}

export const getUsageColor = (percentage: number): string => {
  if (percentage >= 90) return "text-red-500"
  if (percentage >= 75) return "text-yellow-500"
  return "text-green-500"
}

export const getUsageVariant = (percentage: number): "default" | "destructive" => {
  return percentage >= 90 ? "destructive" : "default"
}

export const maskCardNumber = (last4: string): string => {
  return `•••• ${last4}`
}

export const getCardIcon = (type: string): string => {
  const icons: Record<string, string> = {
    Visa: "💳",
    Mastercard: "💳",
    "American Express": "💳",
  }
  return icons[type] || "💳"
}
