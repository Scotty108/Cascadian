export interface Plan {
  name: string
  description: string
  price: {
    monthly: number
    annual: number
  }
  features: PlanFeature[]
  cta: string
  popular: boolean
  disabled: boolean
}

export interface PlanFeature {
  name: string
  included: boolean
}

export interface UsageItem {
  name: string
  used: number
  total: number
  percentage: number
  unit?: string
}

export interface Invoice {
  id: string
  date: string
  amount: string
  status: string
  method: string
}

export interface PaymentMethod {
  id: string
  type: string
  last4: string
  expiry: string
  default: boolean
}

export interface FAQ {
  question: string
  answer: string
}

export interface SubscriptionSettings {
  autoRenew: boolean
  emailNotifications: boolean
  renewalReminders: boolean
}

export type BillingCycle = "monthly" | "annual"

export interface SubscriptionState {
  currentPlan: Plan
  billingCycle: BillingCycle
  usageData: UsageItem[]
  billingHistory: Invoice[]
  paymentMethods: PaymentMethod[]
  settings: SubscriptionSettings
  showCancelDialog: boolean
}
