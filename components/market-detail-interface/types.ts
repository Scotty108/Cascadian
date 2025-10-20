export interface MarketDetail {
  market_id: string;
  title: string;
  description: string;
  category: string;
  outcome: 'YES' | 'NO';

  // Current state
  current_price: number;        // 0-1
  bid: number;
  ask: number;
  spread_bps: number;

  // Volume & liquidity
  volume_24h: number;
  volume_total: number;
  liquidity_usd: number;

  // Market metadata
  end_date: string;             // ISO date
  hours_to_close: number;
  active: boolean;

  // Signal data
  sii: number;                  // -100 to +100
  momentum: number;             // 0-100
  signal_confidence: number;    // 0-1
  signal_recommendation: 'BUY_YES' | 'BUY_NO' | 'HOLD' | 'SELL';
  edge_bp: number;              // Basis points
}

export interface PriceHistoryPoint {
  timestamp: string;
  price: number;
  volume: number;
}

export interface SignalBreakdown {
  psp_weight: number;
  psp_contribution: number;
  psp_confidence: number;

  crowd_weight: number;
  crowd_contribution: number;
  crowd_confidence: number;

  momentum_weight: number;
  momentum_contribution: number;
  momentum_confidence: number;

  microstructure_weight: number;
  microstructure_contribution: number;
  microstructure_confidence: number;
}

export interface WhaleTradeForMarket {
  trade_id: string;
  timestamp: string;
  wallet_address: string;
  wallet_alias: string;
  wis: number;
  side: 'YES' | 'NO';
  action: 'BUY' | 'SELL';
  shares: number;
  amount_usd: number;
  price: number;
}

export interface SmartWalletPosition {
  wallet_address: string;
  wallet_alias: string;
  wis: number;
  position_side: 'YES' | 'NO';
  shares: number;
  avg_entry_price: number;
  current_value_usd: number;
  unrealized_pnl_usd: number;
  unrealized_pnl_pct: number;
}

export interface OrderBookLevel {
  price: number;
  size: number;
  total: number;        // Cumulative
}

export interface OrderBook {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  timestamp: string;
}

export interface SIIHistoryPoint {
  timestamp: string;
  sii: number;
  confidence: number;
}
