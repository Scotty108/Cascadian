export interface DcaBot {
  id: string
  name: string
  asset: string
  status: "active" | "paused"
  exchange: string
  frequency: string
  amount: number
  totalInvested: number
  averagePrice: number
  profit: number
  nextExecution: string
  createdAt: string
  history: DcaPurchase[]
}

export interface DcaPurchase {
  date: string
  price: number
  amount: number
  value: number
  status: "completed" | "pending" | "failed"
}

export interface Exchange {
  id: string
  name: string
  logo: string
}

export interface Asset {
  id: string
  name: string
  symbol: string
  logo: string
}

export interface Frequency {
  id: string
  name: string
}

export interface DcaBotFormData {
  name: string
  asset: string
  exchange: string
  frequency: string
  amount: number
  startDate: string
  autoAdjust: boolean
  priceLimit: boolean
  notifications: boolean
  autoReinvest: boolean
}

export interface DcaStats {
  totalBots: number
  activeBots: number
  totalInvested: number
  averageProfit: number
}

export interface DcaSettings {
  autoStart: boolean
  defaultExchange: string
  defaultFrequency: string
  defaultAmount: number
  emailNotifications: boolean
  pushNotifications: boolean
  telegramNotifications: boolean
  weeklySummary: boolean
  maxDailySpend: number
  confirmation: boolean
  twoFactor: boolean
}
