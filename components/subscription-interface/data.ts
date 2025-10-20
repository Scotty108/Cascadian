import type { Plan, UsageItem, Invoice, PaymentMethod, SubscriptionSettings } from "./types"
import { PLAN_NAMES, INVOICE_STATUS, PAYMENT_TYPES } from "./constants"

export const plans: Plan[] = [
  {
    name: PLAN_NAMES.FREE,
    description: "Basic access to trading tools and market data",
    price: {
      monthly: 0,
      annual: 0,
    },
    features: [
      { name: "Basic market data", included: true },
      { name: "Manual trading tools", included: true },
      { name: "Portfolio tracking", included: true },
      { name: "1 trading bot", included: true },
      { name: "Basic analytics", included: true },
      { name: "Community support", included: true },
      { name: "Advanced trading bots", included: false },
      { name: "AI-powered insights", included: false },
      { name: "Real-time alerts", included: false },
      { name: "API access", included: false },
      { name: "Priority support", included: false },
      { name: "Custom strategies", included: false },
    ],
    cta: "Base Plan",
    popular: false,
    disabled: true,
  },
  {
    name: PLAN_NAMES.PRO,
    description: "Advanced trading tools and AI-powered insights",
    price: {
      monthly: 49.99,
      annual: 39.99,
    },
    features: [
      { name: "Everything in Free", included: true },
      { name: "Advanced trading bots", included: true },
      { name: "AI-powered insights", included: true },
      { name: "Real-time alerts", included: true },
      { name: "API access", included: true },
      { name: "Priority support", included: true },
      { name: "5 concurrent bots", included: true },
      { name: "Strategy backtesting", included: true },
      { name: "Custom indicators", included: true },
      { name: "Team access", included: false },
      { name: "White-label solutions", included: false },
      { name: "Dedicated account manager", included: false },
    ],
    cta: "Current Plan",
    popular: true,
    disabled: true,
  },
  {
    name: PLAN_NAMES.ENTERPRISE,
    description: "Custom solutions for professional traders and teams",
    price: {
      monthly: 199.99,
      annual: 159.99,
    },
    features: [
      { name: "Everything in Pro", included: true },
      { name: "Unlimited bots", included: true },
      { name: "Team access", included: true },
      { name: "White-label solutions", included: true },
      { name: "Dedicated account manager", included: true },
      { name: "Custom API integration", included: true },
      { name: "Advanced risk management", included: true },
      { name: "Custom reporting", included: true },
      { name: "24/7 phone support", included: true },
      { name: "On-demand training", included: true },
      { name: "Strategy development", included: true },
      { name: "SLA guarantees", included: true },
    ],
    cta: "Upgrade",
    popular: false,
    disabled: false,
  },
]

export const usageData: UsageItem[] = [
  {
    name: "Bot Instances",
    used: 3,
    total: 5,
    percentage: 60,
  },
  {
    name: "API Calls",
    used: 7500,
    total: 10000,
    percentage: 75,
  },
  {
    name: "Strategy Slots",
    used: 4,
    total: 10,
    percentage: 40,
  },
  {
    name: "Data Storage",
    used: 2.5,
    total: 5,
    percentage: 50,
    unit: "GB",
  },
]

export const billingHistory: Invoice[] = [
  {
    id: "INV-001",
    date: "May 1, 2025",
    amount: "$49.99",
    status: INVOICE_STATUS.PAID,
    method: "Visa •••• 4242",
  },
  {
    id: "INV-002",
    date: "Apr 1, 2025",
    amount: "$49.99",
    status: INVOICE_STATUS.PAID,
    method: "Visa •••• 4242",
  },
  {
    id: "INV-003",
    date: "Mar 1, 2025",
    amount: "$49.99",
    status: INVOICE_STATUS.PAID,
    method: "Visa •••• 4242",
  },
]

export const paymentMethods: PaymentMethod[] = [
  {
    id: "pm-001",
    type: PAYMENT_TYPES.VISA,
    last4: "4242",
    expiry: "04/26",
    default: true,
  },
  {
    id: "pm-002",
    type: PAYMENT_TYPES.MASTERCARD,
    last4: "5555",
    expiry: "08/27",
    default: false,
  },
]

export const defaultSettings: SubscriptionSettings = {
  autoRenew: true,
  emailNotifications: true,
  renewalReminders: true,
}

export const currentPlanIndex = 1 // Pro plan
