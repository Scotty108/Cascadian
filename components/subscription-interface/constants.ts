import type { FAQ } from "./types"

export const BILLING_CYCLES = {
  MONTHLY: "monthly" as const,
  ANNUAL: "annual" as const,
}

export const PLAN_NAMES = {
  FREE: "Free",
  PRO: "Pro",
  ENTERPRISE: "Enterprise",
}

export const INVOICE_STATUS = {
  PAID: "Paid",
  PENDING: "Pending",
  FAILED: "Failed",
}

export const PAYMENT_TYPES = {
  VISA: "Visa",
  MASTERCARD: "Mastercard",
  AMEX: "American Express",
}

export const FAQS: FAQ[] = [
  {
    question: "How do I upgrade or downgrade my plan?",
    answer:
      "You can upgrade or downgrade your plan at any time from the Subscription page. Changes to a higher tier take effect immediately. Downgrades take effect at the end of your current billing cycle.",
  },
  {
    question: "Will I be charged immediately when I upgrade?",
    answer:
      "Yes, when upgrading, you'll be charged the prorated amount for the remainder of your current billing cycle. When downgrading, the new rate will apply at the next billing cycle.",
  },
  {
    question: "Can I cancel my subscription at any time?",
    answer:
      "Yes, you can cancel your subscription at any time. Your access will continue until the end of your current billing period. No refunds are provided for partial months.",
  },
  {
    question: "Do you offer refunds?",
    answer:
      "We offer a 14-day money-back guarantee for new subscriptions. If you're not satisfied with our service, contact our support team within 14 days of your initial purchase for a full refund.",
  },
  {
    question: "How do I update my payment information?",
    answer:
      "You can update your payment information in the Payment Methods section of the Subscription page. Click on 'Add Payment Method' to add a new card or 'Set as Default' to change your primary payment method.",
  },
]

export const CANCEL_REASONS = [
  "Too expensive",
  "Not using it enough",
  "Missing features",
  "Found a better alternative",
  "Technical issues",
  "Other",
]

export const ENTERPRISE_FEATURES = {
  TEAM: ["Up to 10 team members", "Team analytics dashboard", "Role-based permissions", "Shared strategy library"],
  ENTERPRISE: [
    "Unlimited team members",
    "Custom API integration",
    "Dedicated account manager",
    "White-label solutions",
  ],
}
