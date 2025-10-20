import type { TradingPair, OrderBookEntry, ChartData, Balance, Exchange, Account, Market } from "./types"

export const mockTradingPairs: TradingPair[] = [
  { symbol: "BTCUSDT", name: "Bitcoin", price: 42831.07, change24h: 2.34, volume24h: 1245789.32 },
  { symbol: "ETHUSDT", name: "Ethereum", price: 2456.78, change24h: -1.23, volume24h: 987654.21 },
  { symbol: "BNBUSDT", name: "BNB", price: 312.45, change24h: 3.45, volume24h: 456789.12 },
  { symbol: "SOLUSDT", name: "Solana", price: 98.76, change24h: 5.67, volume24h: 234567.89 },
]

export const mockBalances: Balance[] = [
  { asset: "BTC", free: 0.42, locked: 0.0, total: 0.42 },
  { asset: "USDT", free: 12500.25, locked: 0.0, total: 12500.25 },
  { asset: "ETH", free: 2.5, locked: 0.0, total: 2.5 },
  { asset: "BNB", free: 15.75, locked: 0.0, total: 15.75 },
]

export const mockExchanges: Exchange[] = [
  { id: "binance", name: "Binance", status: "connected" },
  { id: "coinbase", name: "Coinbase", status: "disconnected" },
  { id: "kucoin", name: "KuCoin", status: "disconnected" },
  { id: "bybit", name: "Bybit", status: "disconnected" },
]

export const mockAccounts: Account[] = [
  { id: "main", name: "Main Account", type: "main" },
  { id: "trading", name: "Trading Account", type: "trading" },
  { id: "bot", name: "Bot Account", type: "bot" },
]

export const mockMarkets: Market[] = [
  { id: "spot", name: "Spot", type: "spot" },
  { id: "futures", name: "Futures", type: "futures" },
  { id: "margin", name: "Margin", type: "margin" },
]

export const mockOrderBookAsks: OrderBookEntry[] = [
  { price: 42877.54, amount: 1.3934, total: 52414.28 },
  { price: 42868.24, amount: 0.5313, total: 8056.21 },
  { price: 42858.7, amount: 1.6082, total: 31902.05 },
  { price: 42847.3, amount: 0.6663, total: 39348.13 },
  { price: 42838.93, amount: 0.2112, total: 34005.88 },
  { price: 42827.43, amount: 1.5054, total: 10730.5 },
]

export const mockOrderBookBids: OrderBookEntry[] = [
  { price: 42815.88, amount: 0.3143, total: 45027.04 },
  { price: 42807.52, amount: 1.4052, total: 85099.1 },
  { price: 42795.86, amount: 1.2851, total: 4684.75 },
  { price: 42788.32, amount: 0.9542, total: 12657.32 },
  { price: 42775.19, amount: 2.1034, total: 23456.78 },
  { price: 42768.45, amount: 0.8721, total: 9876.54 },
]

export const mockChartData: ChartData[] = [
  { time: "09:00", price: 42850, volume: 1250 },
  { time: "09:15", price: 42920, volume: 1180 },
  { time: "09:30", price: 42880, volume: 1320 },
  { time: "09:45", price: 42950, volume: 1450 },
  { time: "10:00", price: 42931, volume: 1380 },
  { time: "10:15", price: 42970, volume: 1520 },
  { time: "10:30", price: 42945, volume: 1290 },
  { time: "10:45", price: 42980, volume: 1610 },
  { time: "11:00", price: 42965, volume: 1340 },
  { time: "11:15", price: 43020, volume: 1720 },
  { time: "11:30", price: 42995, volume: 1480 },
  { time: "11:45", price: 43050, volume: 1850 },
]
