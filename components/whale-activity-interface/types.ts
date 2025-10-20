export interface WhaleTransaction {
  txn_id: string;
  wallet_id: string;
  wallet_alias: string;
  wis: number;
  market_id: string;
  market_title: string;
  outcome: 'YES' | 'NO';
  action: 'BUY' | 'SELL';
  shares: number;
  amount_usd: number;
  price: number;
  timestamp: string;
}

export interface WhaleActivitySummary {
  total_volume_24h: number;
  total_transactions_24h: number;
  avg_transaction_size: number;
  top_market: string;
}

export interface MarketWhaleActivity {
  market_id: string;
  market_title: string;
  whale_volume_24h: number;
  whale_transactions: number;
  net_whale_sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
}
