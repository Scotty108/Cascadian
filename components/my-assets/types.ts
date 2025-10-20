import type React from "react"
export interface AssetData {
  name: string
  value: number
  percentage: number
  color: string
  symbol?: string
  price?: number
  holdings?: string
  change?: number
}

export interface Transaction {
  type: "bought" | "sold"
  asset: string
  amount: string
  date: string
  value: string
}

export interface KpiMetric {
  title: string
  value: string
  change: string
  icon: React.ElementType
  isPositive?: boolean
}
