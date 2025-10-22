export interface InsiderWallet {
  wallet_id: string;
  wallet_alias: string;
  wis: number;
  insider_score: number;
  total_trades: number;
  win_rate: number;
  avg_entry_timing: number; // hours before event resolution
  total_profit: number;
  active_positions: number;
  last_activity: string;
  risk_level: "LOW" | "MEDIUM" | "HIGH";
}

export interface InsiderTransaction {
  txn_id: string;
  wallet_id: string;
  wallet_alias: string;
  insider_score: number;
  market_id: string;
  market_title: string;
  outcome: string;
  action: "BUY" | "SELL";
  shares: number;
  amount_usd: number;
  price: number;
  timestamp: string;
  time_before_resolution: number; // hours
  information_advantage: "SUSPECTED" | "LIKELY" | "CONFIRMED";
}

export interface InsiderMarketActivity {
  market_id: string;
  market_title: string;
  insider_volume_24h: number;
  insider_transactions: number;
  insider_sentiment: "BULLISH" | "BEARISH" | "NEUTRAL";
  suspicious_activity_score: number;
  avg_entry_timing: number;
  resolution_date: string;
}

export interface InsiderActivitySummary {
  total_insider_volume_24h: number;
  total_insider_transactions_24h: number;
  avg_insider_score: number;
  top_market: string;
  suspected_insider_wallets: number;
}
