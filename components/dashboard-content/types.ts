import type React from "react"
// Define types for the dashboard data
export interface KpiCard {
  title: string
  value: string
  change: string
  icon: React.ReactNode
  changeType?: "positive" | "negative" | "neutral"
}

export interface ProfitDataItem {
  date: string
  referral: number
  autoApproved: number
  dividend: number
  bankApproved: number
  total: number
}

export interface ProfitData {
  daily: ProfitDataItem[]
  weekly: ProfitDataItem[]
  monthly: ProfitDataItem[]
  totals: {
    referral: number
    autoApproved: number
    dividend: number
    bankApproved: number
    total: number
  }
}

export interface RecentTrade {
  pair: string
  value: number
  changeType: "positive" | "negative"
}

export interface TopBot {
  name: string
  type: string
  profit: string
  winRate: string
}

export interface WalletAsset {
  name: string
  amount: string
  value: string
  change: string
  changeType: "positive" | "negative" | "neutral"
}

export type TimeframeType = "daily" | "weekly" | "monthly"
export type ChartType = "bar" | "line"
