import { BarChart3, CreditCard, DollarSign, Users } from "lucide-react"
import type { KpiCard, ProfitData, RecentTrade, TopBot, WalletAsset } from "./types"

// KPI Cards data
export const kpiCardsData: KpiCard[] = [
  {
    title: "Total Balance",
    value: "$45,231.89",
    change: "+20.1% from last month",
    icon: <DollarSign className="h-4 w-4 text-muted-foreground" />,
    changeType: "positive",
  },
  {
    title: "Active Bots",
    value: "+12",
    change: "+2 since last login",
    icon: <Users className="h-4 w-4 text-muted-foreground" />,
    changeType: "positive",
  },
  {
    title: "Total Profit",
    value: "+$12,234",
    change: "+19% from last month",
    icon: <CreditCard className="h-4 w-4 text-muted-foreground" />,
    changeType: "positive",
  },
  {
    title: "Active Trades",
    value: "+573",
    change: "+201 since yesterday",
    icon: <BarChart3 className="h-4 w-4 text-muted-foreground" />,
    changeType: "positive",
  },
]

// Profit chart data
export const profitData: ProfitData = {
  daily: [
    { date: "Mon", referral: 120, autoApproved: 350, dividend: 220, bankApproved: 180, total: 870 },
    { date: "Tue", referral: 132, autoApproved: 380, dividend: 240, bankApproved: 190, total: 942 },
    { date: "Wed", referral: 145, autoApproved: 420, dividend: 230, bankApproved: 210, total: 1005 },
    { date: "Thu", referral: 155, autoApproved: 450, dividend: 250, bankApproved: 220, total: 1075 },
    { date: "Fri", referral: 170, autoApproved: 480, dividend: 260, bankApproved: 240, total: 1150 },
    { date: "Sat", referral: 180, autoApproved: 510, dividend: 270, bankApproved: 250, total: 1210 },
    { date: "Sun", referral: 190, autoApproved: 530, dividend: 280, bankApproved: 260, total: 1260 },
  ],
  weekly: [
    { date: "Week 1", referral: 840, autoApproved: 2450, dividend: 1540, bankApproved: 1260, total: 6090 },
    { date: "Week 2", referral: 920, autoApproved: 2680, dividend: 1680, bankApproved: 1380, total: 6660 },
    { date: "Week 3", referral: 1010, autoApproved: 2940, dividend: 1840, bankApproved: 1510, total: 7300 },
    { date: "Week 4", referral: 1105, autoApproved: 3220, dividend: 2020, bankApproved: 1650, total: 7995 },
  ],
  monthly: [
    { date: "Jan", referral: 3650, autoApproved: 10500, dividend: 6600, bankApproved: 5400, total: 26150 },
    { date: "Feb", referral: 4200, autoApproved: 12100, dividend: 7600, bankApproved: 6200, total: 30100 },
    { date: "Mar", referral: 4850, autoApproved: 13950, dividend: 8750, bankApproved: 7150, total: 34700 },
    { date: "Apr", referral: 5580, autoApproved: 16050, dividend: 10050, bankApproved: 8220, total: 39900 },
    { date: "May", referral: 6420, autoApproved: 18450, dividend: 11550, bankApproved: 9450, total: 45870 },
    { date: "Jun", referral: 7380, autoApproved: 21220, dividend: 13280, bankApproved: 10870, total: 52750 },
  ],
  totals: {
    referral: 7380,
    autoApproved: 21220,
    dividend: 13280,
    bankApproved: 10870,
    total: 52750,
  },
}

// Recent trades data
export const recentTradesData: RecentTrade[] = [
  { pair: "BTC/USDT", value: 3540, changeType: "positive" },
  { pair: "ETH/USDT", value: 2340, changeType: "positive" },
  { pair: "SOL/USDT", value: 1340, changeType: "negative" },
  { pair: "BNB/USDT", value: 1240, changeType: "positive" },
]

// Top performing bots data
export const topBotsData: TopBot[] = [
  { name: "BTC Scalper", type: "AI Bot", profit: "+$5,240", winRate: "87%" },
  { name: "ETH DCA Master", type: "DCA Bot", profit: "+$3,980", winRate: "92%" },
  { name: "Binance Arbitrage", type: "Arbitrage Bot", profit: "+$2,340", winRate: "98%" },
  { name: "Altcoin Hunter", type: "Signal Bot", profit: "+$1,890", winRate: "76%" },
]

// Wallet overview data
export const walletAssetsData: WalletAsset[] = [
  { name: "Bitcoin", amount: "0.76 BTC", value: "$32,400", change: "+12.5%", changeType: "positive" },
  { name: "Ethereum", amount: "2.14 ETH", value: "$8,240", change: "+8.2%", changeType: "positive" },
  { name: "Solana", amount: "32.5 SOL", value: "$3,450", change: "+24.1%", changeType: "positive" },
  { name: "USDT", amount: "12,500 USDT", value: "$12,500", change: "+0.0%", changeType: "neutral" },
]
