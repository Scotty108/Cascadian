export const ASSET_TYPES = [
  { value: "all", label: "All Assets" },
  { value: "crypto", label: "Cryptocurrencies" },
  { value: "tokens", label: "Tokens" },
  { value: "stablecoins", label: "Stablecoins" },
] as const

export const ACCOUNT_TYPES = [
  { value: "all", label: "All Accounts" },
  { value: "spot", label: "Spot" },
  { value: "futures", label: "Futures" },
  { value: "defi", label: "DeFi" },
] as const

export const DATE_RANGES = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "1y", label: "Last year" },
  { value: "custom", label: "Custom range" },
] as const

export const DEFAULT_DATE_RANGE = "12 Aug - 19 Aug"

export const STATS_CONFIG = {
  totalBalance: {
    title: "Total Balance",
    value: 482498.39,
    change: 2.4,
    changeValue: 11579.96,
    period: "since last week",
  },
  balanceUpnl: {
    title: "Balance & UPNL",
    value: 124.0,
    change: 1.2,
    changeValue: 1.48,
    period: "since yesterday",
  },
  upnl: {
    title: "UPNL",
    value: 10.0,
    change: -0.5,
    changeValue: -0.05,
    period: "since yesterday",
  },
  freeBalance: {
    title: "Free Balance",
    value: 482498.39,
    change: 3.1,
    changeValue: 14957.45,
    period: "since last week",
  },
} as const
