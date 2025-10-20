

import type { FilterState } from "./types";

type ImpermanentLossCalculatorValues = {
  token1Change: number
  token2Change: number
  initialInvestment: number
}

export const RISK_COLORS = {
  "Very Low": "bg-green-500",
  Low: "bg-emerald-500",
  Medium: "bg-yellow-500",
  High: "bg-orange-500",
  "Very High": "bg-red-500",
} as const

export const CHAIN_ICONS = {
  Ethereum: "/ethereum-logo-abstract.png",
  BSC: "/bnb-logo-abstract.png",
  Polygon: "/placeholder-qj1jv.png",
  Avalanche: "/placeholder-esl16.png",
  Solana: "/sol-abstract.png",
} as const

export const CHART_COLORS = ["#FF6B6B", "#4ECDC4", "#FFE66D", "#1A535C", "#F9C80E"]

export const DEFAULT_FILTER_STATE: FilterState = {
  searchQuery: "",
  selectedChains: [],
  selectedRisks: [],
  selectedFarmTypes: [],
  apyRange: [0, 50],
  tvlRange: [0, 600000000],
  sortBy: "apy",
  sortOrder: "desc",
}

export const DEFAULT_IL_CALCULATOR_VALUES: ImpermanentLossCalculatorValues = {
  token1Change: 0,
  token2Change: 0,
  initialInvestment: 1000,
}

export const GAS_OPTIONS = {
  slow: { price: 25, time: "~10 min" },
  average: { price: 35, time: "~5 min" },
  fast: { price: 50, time: "~1 min" },
}

export const FARM_TYPES = ["LP", "Stablecoin LP", "Lending", "Vault", "Staking"]
export const RISK_LEVELS = ["Very Low", "Low", "Medium", "High", "Very High"]
export const CHAINS = Object.keys(CHAIN_ICONS)
