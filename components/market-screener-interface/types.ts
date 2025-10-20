export interface MarketScreenerRow {
  market_id: string;
  title: string;
  outcome: 'YES' | 'NO';

  // Price metrics
  last_price: number;              // 0-1
  price_delta: number;             // Price change (percentage)

  // Volume & activity metrics
  volume_24h: number;              // Total volume in USD
  trades_24h: number;              // Number of trades
  buyers_24h: number;              // Number of buyers
  sellers_24h: number;             // Number of sellers
  unique_addresses_24h: number;    // Unique wallet addresses

  // Whale metrics (high-capital wallets)
  whale_buys_24h: number;          // Number of whale buy orders
  whale_sells_24h: number;         // Number of whale sell orders
  whale_volume_buy_24h: number;    // USD volume from whale buys
  whale_volume_sell_24h: number;   // USD volume from whale sells
  whale_pressure: number;          // Net whale pressure (buy - sell volume)
  whale_buy_sell_ratio: number;    // Whale buy/sell ratio

  // General buy/sell metrics
  buy_sell_ratio: number;          // Overall buy/sell ratio

  // Market quality metrics
  volatility: number;              // Price volatility
  spread_bps: number;              // Bid-ask spread in basis points

  // Smart wallet metrics (high-WIS wallets)
  smart_buyers_24h: number;        // Number of smart wallet buyers
  smart_sellers_24h: number;       // Number of smart wallet sellers
  smart_volume_buy_24h: number;    // USD volume from smart buys
  smart_volume_sell_24h: number;   // USD volume from smart sells
  smart_buy_sell_ratio: number;    // Smart wallet buy/sell ratio
  smart_pressure: number;          // Net smart pressure (buy - sell volume)

  // SII & signals
  sii: number;                     // Smart Imbalance Index: -100 to +100
  momentum: number;                // Momentum score: 0-100

  // Metadata
  category: string;
}
