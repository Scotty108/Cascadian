import type { DcaBot, Exchange, Asset, Frequency } from "./types"

export const mockDcaBots: DcaBot[] = [
  {
    id: "dca-1",
    name: "BTC Accumulator",
    asset: "BTC",
    status: "active",
    exchange: "Binance",
    frequency: "Daily",
    amount: 50,
    totalInvested: 2450,
    averagePrice: 38750.25,
    profit: 12.5,
    nextExecution: "2025-05-16T08:00:00",
    createdAt: "2025-01-15T10:30:00",
    history: [
      {
        date: "2025-05-15",
        price: 39250.75,
        amount: 0.00127,
        value: 50,
        status: "completed",
      },
      {
        date: "2025-05-14",
        price: 38950.5,
        amount: 0.00128,
        value: 50,
        status: "completed",
      },
      {
        date: "2025-05-13",
        price: 39100.25,
        amount: 0.00128,
        value: 50,
        status: "completed",
      },
      {
        date: "2025-05-12",
        price: 38800.75,
        amount: 0.00129,
        value: 50,
        status: "completed",
      },
      {
        date: "2025-05-11",
        price: 38600.5,
        amount: 0.0013,
        value: 50,
        status: "completed",
      },
    ],
  },
  {
    id: "dca-2",
    name: "ETH Builder",
    asset: "ETH",
    status: "paused",
    exchange: "Coinbase",
    frequency: "Weekly",
    amount: 200,
    totalInvested: 3600,
    averagePrice: 2850.75,
    profit: 8.2,
    nextExecution: "2025-05-20T10:00:00",
    createdAt: "2025-02-10T14:45:00",
    history: [
      {
        date: "2025-05-08",
        price: 2950.25,
        amount: 0.0678,
        value: 200,
        status: "completed",
      },
      {
        date: "2025-05-01",
        price: 2900.5,
        amount: 0.069,
        value: 200,
        status: "completed",
      },
      {
        date: "2025-04-24",
        price: 2875.75,
        amount: 0.0695,
        value: 200,
        status: "completed",
      },
    ],
  },
  {
    id: "dca-3",
    name: "SOL Stacker",
    asset: "SOL",
    status: "active",
    exchange: "Binance",
    frequency: "Bi-weekly",
    amount: 100,
    totalInvested: 1200,
    averagePrice: 120.5,
    profit: 15.8,
    nextExecution: "2025-05-22T12:00:00",
    createdAt: "2025-03-05T09:15:00",
    history: [
      {
        date: "2025-05-08",
        price: 125.75,
        amount: 0.795,
        value: 100,
        status: "completed",
      },
      {
        date: "2025-04-24",
        price: 122.5,
        amount: 0.816,
        value: 100,
        status: "completed",
      },
      {
        date: "2025-04-10",
        price: 118.25,
        amount: 0.846,
        value: 100,
        status: "completed",
      },
    ],
  },
]

export const mockExchanges: Exchange[] = [
  { id: "binance", name: "Binance", logo: "/binance-logo.png" },
  { id: "coinbase", name: "Coinbase", logo: "/coinbase-logo.png" },
  { id: "kraken", name: "Kraken", logo: "/placeholder.svg?height=32&width=32" },
  { id: "kucoin", name: "KuCoin", logo: "/placeholder.svg?height=32&width=32" },
]

export const mockAssets: Asset[] = [
  { id: "btc", name: "Bitcoin", symbol: "BTC", logo: "/btc-abstract-representation.png" },
  { id: "eth", name: "Ethereum", symbol: "ETH", logo: "/ethereum-logo-abstract.png" },
  { id: "sol", name: "Solana", symbol: "SOL", logo: "/sol-abstract.png" },
  { id: "bnb", name: "Binance Coin", symbol: "BNB", logo: "/bnb-logo-abstract.png" },
  { id: "ada", name: "Cardano", symbol: "ADA", logo: "/ada-lovelace-portrait.png" },
  { id: "xrp", name: "Ripple", symbol: "XRP", logo: "/xrp-abstract-design.png" },
]

export const mockFrequencies: Frequency[] = [
  { id: "hourly", name: "Hourly" },
  { id: "daily", name: "Daily" },
  { id: "weekly", name: "Weekly" },
  { id: "bi-weekly", name: "Bi-weekly" },
  { id: "monthly", name: "Monthly" },
  { id: "custom", name: "Custom" },
]

export const mockPerformanceData = [
  { date: "2025-01-01", value: 1000 },
  { date: "2025-01-15", value: 1050 },
  { date: "2025-02-01", value: 1120 },
  { date: "2025-02-15", value: 1080 },
  { date: "2025-03-01", value: 1200 },
  { date: "2025-03-15", value: 1350 },
  { date: "2025-04-01", value: 1280 },
  { date: "2025-04-15", value: 1420 },
  { date: "2025-05-01", value: 1580 },
  { date: "2025-05-15", value: 1650 },
]
