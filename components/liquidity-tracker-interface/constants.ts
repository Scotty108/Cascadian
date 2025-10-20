export const CHAINS = [
  { value: "all", label: "All Chains" },
  { value: "ethereum", label: "Ethereum" },
  { value: "bsc", label: "BSC" },
  { value: "polygon", label: "Polygon" },
  { value: "arbitrum", label: "Arbitrum" },
  { value: "optimism", label: "Optimism" },
] as const

export const PROTOCOLS = [
  { value: "all", label: "All Protocols" },
  { value: "uniswap", label: "Uniswap" },
  { value: "curve", label: "Curve" },
  { value: "balancer", label: "Balancer" },
  { value: "sushiswap", label: "SushiSwap" },
  { value: "quickswap", label: "QuickSwap" },
] as const

export const TIME_RANGES = [
  { value: "1d", label: "1D" },
  { value: "1w", label: "1W" },
  { value: "1m", label: "1M" },
  { value: "3m", label: "3M" },
  { value: "1y", label: "1Y" },
  { value: "all", label: "All" },
] as const

export const RISK_LEVELS = [
  { value: "all", label: "All" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
] as const

export const FEE_TIERS = [
  { value: "all", label: "All" },
  { value: "0.01", label: "0.01%" },
  { value: "0.05", label: "0.05%" },
  { value: "0.3", label: "0.3%" },
  { value: "1", label: "1%" },
] as const

export const MIN_TVL_OPTIONS = [
  { value: "0", label: "Any" },
  { value: "100000", label: "$100K+" },
  { value: "1000000", label: "$1M+" },
  { value: "10000000", label: "$10M+" },
  { value: "100000000", label: "$100M+" },
] as const

export const MIN_APY_OPTIONS = [
  { value: "0", label: "Any" },
  { value: "5", label: "5%+" },
  { value: "10", label: "10%+" },
  { value: "20", label: "20%+" },
  { value: "50", label: "50%+" },
] as const

export const CHART_COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#8884D8"] as const

export const TABS = [
  { value: "overview", label: "Overview" },
  { value: "pools", label: "Pools" },
  { value: "my-positions", label: "My Positions" },
  { value: "analytics", label: "Analytics" },
  { value: "calculator", label: "Calculator" },
] as const
