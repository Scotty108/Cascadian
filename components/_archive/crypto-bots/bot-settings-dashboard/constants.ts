export const BOT_TYPES = [
  { value: "ai", label: "AI Trading Bot" },
  { value: "dca", label: "DCA Bot" },
  { value: "signal", label: "Signal Bot" },
  { value: "arbitrage", label: "Arbitrage Bot" },
  { value: "grid", label: "Grid Trading Bot" },
  { value: "momentum", label: "Momentum Bot" },
]

export const EXCHANGES = [
  { value: "binance", label: "Binance" },
  { value: "coinbase", label: "Coinbase Pro" },
  { value: "kraken", label: "Kraken" },
  { value: "bybit", label: "Bybit" },
  { value: "okx", label: "OKX" },
  { value: "kucoin", label: "KuCoin" },
]

export const STRATEGIES = [
  { value: "momentum", label: "Momentum Trading" },
  { value: "mean-reversion", label: "Mean Reversion" },
  { value: "dca", label: "Dollar Cost Averaging" },
  { value: "grid", label: "Grid Trading" },
  { value: "scalping", label: "Scalping" },
  { value: "custom", label: "Custom Strategy" },
]

export const TIMEFRAMES = [
  { value: "1m", label: "1 Minute" },
  { value: "5m", label: "5 Minutes" },
  { value: "15m", label: "15 Minutes" },
  { value: "1h", label: "1 Hour" },
  { value: "4h", label: "4 Hours" },
  { value: "1d", label: "1 Day" },
]

export const RISK_LEVELS = [
  { value: "low", label: "Low Risk", description: "Conservative trading with minimal risk" },
  { value: "medium", label: "Medium Risk", description: "Balanced approach with moderate risk" },
  { value: "high", label: "High Risk", description: "Aggressive trading with higher potential returns" },
]

export const CURRENCIES = [
  { value: "USD", label: "USD" },
  { value: "USDT", label: "USDT" },
  { value: "USDC", label: "USDC" },
  { value: "BTC", label: "BTC" },
  { value: "ETH", label: "ETH" },
]

export const EXECUTION_MODES = [
  { value: "live", label: "Live Trading" },
  { value: "paper", label: "Paper Trading" },
  { value: "backtest", label: "Backtesting" },
]

export const ORDER_TYPES = [
  { value: "market", label: "Market Order" },
  { value: "limit", label: "Limit Order" },
  { value: "stop", label: "Stop Order" },
  { value: "stop-limit", label: "Stop-Limit Order" },
]

export const EXECUTION_SCHEDULES = [
  { value: "continuous", label: "Continuous" },
  { value: "hourly", label: "Every Hour" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "custom", label: "Custom Schedule" },
]

export const DCA_INTERVALS = [
  { value: "1h", label: "Every Hour" },
  { value: "4h", label: "Every 4 Hours" },
  { value: "12h", label: "Every 12 Hours" },
  { value: "1d", label: "Daily" },
  { value: "3d", label: "Every 3 Days" },
  { value: "1w", label: "Weekly" },
]
