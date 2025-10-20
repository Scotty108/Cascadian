import type React from "react"
export type FilterCategory = "profitability" | "status" | "timeframe"
export type FilterItem =
  | "profitable"
  | "unprofitable"
  | "active"
  | "paused"
  | "stopped"
  | "day"
  | "week"
  | "month"
  | "year"
export type ColumnKey =
  | "name"
  | "status"
  | "trades"
  | "winRate"
  | "profit"
  | "profitPercent"
  | "volume"
  | "timeframe"
  | "actions"

export interface Filters {
  profitability: {
    profitable: boolean
    unprofitable: boolean
  }
  status: {
    active: boolean
    paused: boolean
    stopped: boolean
  }
  timeframe: {
    day: boolean
    week: boolean
    month: boolean
    year: boolean
  }
}

export interface ColumnVisibility {
  name: boolean
  status: boolean
  trades: boolean
  winRate: boolean
  profit: boolean
  profitPercent: boolean
  volume: boolean
  timeframe: boolean
  actions: boolean
}

export interface KpiCardProps {
  title: string
  value: string
  change: string
  icon: React.ReactNode
  isPositive?: boolean
}

export interface PerformanceData {
  date: string
  profit: number
  trades: number
  winRate: number
}

export interface MarketSummaryItem {
  market: string
  price: string
  change: string
  isPositive: boolean
}

export interface SignalBot {
  id: number
  name: string
  status: "Active" | "Paused" | "Stopped"
  trades: number
  winRate: number
  profit: number
  profitPercent: number
  volume: number
  timeframe: string
}

export interface Trader {
  id: number
  name: string
  status: "Active" | "Paused" | "Stopped"
  followers: number
  winRate: number
  profit: number
  profitPercent: number
  volume: number
  timeframe: string
}

export interface SignalProvider {
  id: number
  name: string
  status: "Active" | "Paused" | "Stopped"
  subscribers: number
  winRate: number
  profit: number
  profitPercent: number
  signals: number
  timeframe: string
}
