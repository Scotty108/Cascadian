export interface TradingPair {
  symbol: string
  name: string
  price: number
  change24h: number
  volume24h: number
}

export interface OrderBookEntry {
  price: number
  amount: number
  total: number
}

export interface ChartData {
  time: string
  price: number
  volume: number
}

export interface Balance {
  asset: string
  free: number
  locked: number
  total: number
}

export interface MarketSummary {
  change24h: number
  high24h: number
  low24h: number
  volume24h: number
}

export interface OrderFormData {
  amount: string
  price: string
  total: string
  type: "limit" | "market"
}

export interface TradingSettings {
  tradingView: boolean
  signals: boolean
  fullscreen: boolean
}

export interface Exchange {
  id: string
  name: string
  status: "connected" | "disconnected"
}

export interface Account {
  id: string
  name: string
  type: "main" | "trading" | "bot"
}

export interface Market {
  id: string
  name: string
  type: "spot" | "futures" | "margin"
}

export interface TradeHistoryItem {
  id: string;
  type: "buy" | "sell";
  amount: string;
  price: string;
  total: string;
  timestamp: string;
  pair: string;
}
