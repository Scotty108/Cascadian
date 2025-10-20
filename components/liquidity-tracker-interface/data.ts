import type {
  LiquidityPool,
  LiquidityPosition,
  LiquidityMiningOpportunity,
  ChartDataPoint,
  VolumeDataPoint,
  ProtocolDistribution,
} from "./types"

export const liquidityOverviewData: ChartDataPoint[] = [
  { name: "Jan", uniswap: 1200, curve: 900, balancer: 600, sushiswap: 400, total: 3100 },
  { name: "Feb", uniswap: 1300, curve: 950, balancer: 650, sushiswap: 450, total: 3350 },
  { name: "Mar", uniswap: 1400, curve: 1000, balancer: 700, sushiswap: 500, total: 3600 },
  { name: "Apr", uniswap: 1500, curve: 1050, balancer: 750, sushiswap: 550, total: 3850 },
  { name: "May", uniswap: 1600, curve: 1100, balancer: 800, sushiswap: 600, total: 4100 },
  { name: "Jun", uniswap: 1700, curve: 1150, balancer: 850, sushiswap: 650, total: 4350 },
]

export const protocolDistributionData: ProtocolDistribution[] = [
  { name: "Uniswap", value: 40 },
  { name: "Curve", value: 25 },
  { name: "Balancer", value: 15 },
  { name: "SushiSwap", value: 10 },
  { name: "Others", value: 10 },
]

export const topLiquidityPools: LiquidityPool[] = [
  {
    id: 1,
    name: "ETH-USDC",
    protocol: "Uniswap V3",
    tvl: "$245.8M",
    volume24h: "$78.5M",
    apy: "12.4%",
    fee: "0.3%",
    impermanentLoss: "-2.1%",
    risk: "Medium",
  },
  {
    id: 2,
    name: "BTC-ETH",
    protocol: "Balancer",
    tvl: "$189.3M",
    volume24h: "$45.2M",
    apy: "8.7%",
    fee: "0.25%",
    impermanentLoss: "-1.8%",
    risk: "Medium",
  },
  {
    id: 3,
    name: "USDC-USDT",
    protocol: "Curve",
    tvl: "$320.1M",
    volume24h: "$92.7M",
    apy: "5.2%",
    fee: "0.04%",
    impermanentLoss: "0%",
    risk: "Low",
  },
  {
    id: 4,
    name: "ETH-DAI",
    protocol: "SushiSwap",
    tvl: "$112.5M",
    volume24h: "$34.8M",
    apy: "11.3%",
    fee: "0.3%",
    impermanentLoss: "-2.5%",
    risk: "Medium",
  },
  {
    id: 5,
    name: "MATIC-USDC",
    protocol: "QuickSwap",
    tvl: "$87.2M",
    volume24h: "$29.1M",
    apy: "14.8%",
    fee: "0.3%",
    impermanentLoss: "-3.2%",
    risk: "High",
  },
]

export const myLiquidityPositions: LiquidityPosition[] = [
  {
    id: 1,
    name: "ETH-USDC",
    protocol: "Uniswap V3",
    invested: "$5,000",
    currentValue: "$5,320",
    roi: "+6.4%",
    apy: "12.4%",
    rewards: "$120",
    status: "Active",
  },
  {
    id: 2,
    name: "BTC-ETH",
    protocol: "Balancer",
    invested: "$3,500",
    currentValue: "$3,680",
    roi: "+5.1%",
    apy: "8.7%",
    rewards: "$75",
    status: "Active",
  },
  {
    id: 3,
    name: "MATIC-USDC",
    protocol: "QuickSwap",
    invested: "$2,000",
    currentValue: "$1,920",
    roi: "-4.0%",
    apy: "14.8%",
    rewards: "$65",
    status: "Active",
  },
]

export const volumeData: VolumeDataPoint[] = [
  { name: "Mon", uniswap: 120, curve: 90, balancer: 60, sushiswap: 40 },
  { name: "Tue", uniswap: 130, curve: 95, balancer: 65, sushiswap: 45 },
  { name: "Wed", uniswap: 140, curve: 100, balancer: 70, sushiswap: 50 },
  { name: "Thu", uniswap: 150, curve: 105, balancer: 75, sushiswap: 55 },
  { name: "Fri", uniswap: 160, curve: 110, balancer: 80, sushiswap: 60 },
  { name: "Sat", uniswap: 170, curve: 115, balancer: 85, sushiswap: 65 },
  { name: "Sun", uniswap: 180, curve: 120, balancer: 90, sushiswap: 70 },
]

export const liquidityMiningOpportunities: LiquidityMiningOpportunity[] = [
  {
    id: 1,
    name: "ETH-USDC",
    protocol: "Uniswap V3",
    rewards: "UNI",
    apy: "18.4%",
    duration: "30 days",
    tvl: "$245.8M",
    status: "Active",
  },
  {
    id: 2,
    name: "BTC-ETH",
    protocol: "Balancer",
    rewards: "BAL",
    apy: "15.7%",
    duration: "60 days",
    tvl: "$189.3M",
    status: "Active",
  },
  {
    id: 3,
    name: "USDC-USDT",
    protocol: "Curve",
    rewards: "CRV",
    apy: "12.2%",
    duration: "90 days",
    tvl: "$320.1M",
    status: "Active",
  },
  {
    id: 4,
    name: "ETH-DAI",
    protocol: "SushiSwap",
    rewards: "SUSHI",
    apy: "16.3%",
    duration: "45 days",
    tvl: "$112.5M",
    status: "Active",
  },
  {
    id: 5,
    name: "MATIC-USDC",
    protocol: "QuickSwap",
    rewards: "QUICK",
    apy: "21.8%",
    duration: "30 days",
    tvl: "$87.2M",
    status: "Active",
  },
]

export const performanceData = [
  { date: "Jan 1", value: 10000, invested: 10000 },
  { date: "Jan 15", value: 10200, invested: 10000 },
  { date: "Feb 1", value: 10350, invested: 10000 },
  { date: "Feb 15", value: 10500, invested: 10000 },
  { date: "Mar 1", value: 10680, invested: 10000 },
  { date: "Mar 15", value: 10750, invested: 10000 },
  { date: "Apr 1", value: 10920, invested: 10000 },
]

export const rewardsData = [
  { date: "Jan 1", rewards: 0 },
  { date: "Jan 15", rewards: 35 },
  { date: "Feb 1", rewards: 75 },
  { date: "Feb 15", rewards: 120 },
  { date: "Mar 1", rewards: 165 },
  { date: "Mar 15", rewards: 210 },
  { date: "Apr 1", rewards: 260 },
]

export const marketDepthData = [
  { price: 1800, bids: 0, asks: 5000000 },
  { price: 1850, bids: 0, asks: 4000000 },
  { price: 1900, bids: 0, asks: 3000000 },
  { price: 1950, bids: 0, asks: 2000000 },
  { price: 2000, bids: 0, asks: 1000000 },
  { price: 2050, bids: 1000000, asks: 0 },
  { price: 2100, bids: 2000000, asks: 0 },
  { price: 2150, bids: 3000000, asks: 0 },
  { price: 2200, bids: 4000000, asks: 0 },
  { price: 2250, bids: 5000000, asks: 0 },
]

export const impermanentLossData = [
  { priceChange: -50, il: -5.7 },
  { priceChange: -40, il: -4.3 },
  { priceChange: -30, il: -3.1 },
  { priceChange: -20, il: -1.9 },
  { priceChange: -10, il: -0.9 },
  { priceChange: 0, il: 0 },
  { priceChange: 10, il: -0.9 },
  { priceChange: 20, il: -1.9 },
  { priceChange: 30, il: -3.1 },
  { priceChange: 40, il: -4.3 },
  { priceChange: 50, il: -5.7 },
]
