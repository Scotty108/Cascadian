# UI Implementation Gap Analysis
*Generated: 2025-10-20*

## Executive Summary

Both Market Detail and Wallet Detail components have basic implementations but are missing **60-70% of the specified features**. This document provides a complete gap analysis and implementation roadmap.

---

## Market Detail Component

### ✅ Currently Implemented (30%)

1. **Basic Header**
   - Market title, category, description
   - Back button navigation

2. **Key Metrics (Partial)**
   - Current Price, SII Score, 24h Volume, Liquidity, Signal, Closes In
   - ❌ Missing: Unique Traders 24h sparkline, Buy YES/NO trades 24h, resolution note, external link

3. **Charts**
   - Price history line chart (7 days)
   - SII trend chart (48 hours)
   - Order book depth chart
   - ❌ Missing: OHLC, RSI, MACD, SMA, whale flip markers

4. **Tables**
   - Whale trades table (basic)
   - Smart positions table (basic)
   - Order book tables (bids/asks)

### ❌ Missing Components (70%)

#### A. Related Markets Section
```typescript
interface RelatedMarket {
  market_id: string;
  title: string;
  outcome_chips: { side: 'YES' | 'NO'; price: number }[];
  volume_24h: number;
  liquidity: number;
  sort_options: 'Featured' | '24h Volume' | 'Liquidity' | 'Ending Soon' | 'Competitive';
}
```
- **Priority**: HIGH
- **Complexity**: Medium
- **Estimated Time**: 4-6 hours

#### B. Liquidity and Impact Cards
```typescript
interface LiquidityImpact {
  momentum_index_7d: number;
  opinion_changes: number; // flip count
  market_certainty_index: {
    value: number;
    badge_text: string;
  };
  apy_opportunity: {
    text: string;
    formula: string;
  };
}
```
- **Priority**: MEDIUM
- **Complexity**: Medium
- **Estimated Time**: 3-4 hours

#### C. Market Bias Donuts
```typescript
interface MarketBias {
  timeframe: '1h' | '24h' | '3d' | '7d';
  yes_volume: number;
  no_volume: number;
}
```
- 4 donut charts showing Yes vs No volume distribution
- **Priority**: MEDIUM
- **Complexity**: Low
- **Estimated Time**: 2-3 hours

#### D. Holders Tables (Per Side)
```typescript
interface HolderPosition {
  wallet_address: string;
  position_usd: number;
  pnl_total: number;
  supply_pct: number;
  avg_entry: number;
  realized_pnl: number;
  unrealized_pnl: number;
  smart_score: number;
  last_action_time: string;
}

interface HoldersSummary {
  side: 'YES' | 'NO';
  holders_count: number;
  profit_usd: number;
  loss_usd: number;
  realized_price: number;
}
```
- **Priority**: HIGH
- **Complexity**: High
- **Estimated Time**: 6-8 hours

#### E. Top Traders Panels
```typescript
interface TopTrader {
  wallet_address: string;
  realized_pnl: number;
  entry_price: number;
  total_invested: number;
  roi: number;
}
```
- Separate panels for YES and NO sides
- Trader selection functionality
- **Priority**: MEDIUM
- **Complexity**: Medium
- **Estimated Time**: 3-4 hours

#### F. Wallet Age Density (KDE)
```typescript
interface WalletAgeDensity {
  side: 'YES' | 'NO';
  age_days: number[];
  density_usd_weighted: number[];
}
```
- Kernel Density Estimation chart
- **Priority**: LOW
- **Complexity**: High (requires statistical library)
- **Estimated Time**: 4-6 hours

#### G. OHLC Block
```typescript
interface OHLCConfig {
  intervals: ('1m' | '5m' | '15m' | '1h' | '4h' | '1d')[];
  spans: ('7d' | '2w' | '1m' | '3m' | 'YTD' | 'All')[];
}
```
- Candlestick chart with volume
- **Priority**: HIGH
- **Complexity**: Medium
- **Estimated Time**: 4-5 hours

#### H. Holding Time Stacked Area
```typescript
interface HoldingTimeBucket {
  bucket: '<24h' | '1-7d' | '7-30d' | '>30d';
  volume: number;
  price_overlay: number;
}
```
- **Priority**: MEDIUM
- **Complexity**: Medium
- **Estimated Time**: 3-4 hours

#### I. Whale Concentration Heatmap
```typescript
interface WhaleConcentration {
  timestamp: string;
  entry_price: number;
  shares_per_trader: number; // color intensity
  average_price: number; // white line overlay
  side: 'YES' | 'NO';
}
```
- **Priority**: MEDIUM
- **Complexity**: High
- **Estimated Time**: 5-7 hours

#### J. Unusual Trades Table
```typescript
interface UnusualTrade {
  timestamp: string;
  wallet_address: string;
  side: 'YES' | 'NO';
  action: 'BUY' | 'SELL';
  price: number;
  amount_usd: number;
  shares: number;
}

interface UnusualTradesFilters {
  user?: string;
  side?: 'YES' | 'NO';
  date_range?: [Date, Date];
  min_usd?: number;
  max_usd?: number;
}
```
- **Priority**: MEDIUM
- **Complexity**: Medium
- **Estimated Time**: 4-5 hours

#### K. Score Comparison
```typescript
interface ScoreComparison {
  yes_aggregate_score: number;
  no_aggregate_score: number;
  narrative: string;
  top_holders_scatter: {
    smart_score: number;
    entry_price: number;
    side: 'YES' | 'NO';
  }[];
  entry_price_histograms: {
    side: 'YES' | 'NO';
    smart_score_bins: number[];
    entry_price_distribution: number[];
  }[];
  smart_score_density: {
    side: 'YES' | 'NO';
    score: number[];
    density_usd_weighted: number[];
  }[];
}
```
- **Priority**: LOW
- **Complexity**: High
- **Estimated Time**: 6-8 hours

#### L. Trades Explorer
```typescript
interface TradesExplorerFilters {
  user?: string;
  market?: string;
  action?: 'BUY' | 'SELL';
  sort?: string;
  date_range?: [Date, Date];
  min_usd?: number;
  max_usd?: number;
}

interface TradeRecord {
  timestamp: string;
  wallet_address: string;
  market_id: string;
  side: 'YES' | 'NO';
  price: number;
  amount_usd: number;
  shares: number;
  fee: number;
  tx_hash: string;
}
```
- **Priority**: MEDIUM
- **Complexity**: Medium
- **Estimated Time**: 4-6 hours

---

## Wallet Detail Component

### ✅ Currently Implemented (40%)

1. **Basic Header**
   - Wallet address, alias, WIS badge
   - Copy address functionality

2. **Performance Metrics**
   - 8 metrics cards (PnL, Win Rate, Trades, Invested, Avg Trade, Best Win, Rank, Days Active)

3. **Charts**
   - PnL performance (90 days) - realized/unrealized/total
   - Win rate trend (90 days)
   - Market distribution (volume + PnL by category)

4. **Tables**
   - Trading history
   - Current positions
   - Category breakdown
   - Comparison with platform averages

### ❌ Missing Components (60%)

#### A. Identity Badges
```typescript
interface IdentityBadges {
  contrarian_pct: number; // % of entries < 0.5
  lottery_ticket_count: number; // positions entered < 0.2 now > 0.9
  senior: boolean; // total positions > 1000
}
```
- **Priority**: HIGH
- **Complexity**: Low
- **Estimated Time**: 1-2 hours

#### B. Enhanced Summary Cards
```typescript
interface WalletSummary {
  total_positions: number;
  active_since: string; // first trade date
  active_days: number;
  current_balance_usdc: number;
  polymarket_link: string;
}
```
- Add "View on Polymarket" external link
- **Priority**: MEDIUM
- **Complexity**: Low
- **Estimated Time**: 1 hour

#### C. Rank by PnL Blocks
```typescript
interface PnLRank {
  period: '1D' | '7D' | '30D' | 'All';
  rank: number;
  pnl_usd: number;
}
```
- 4 period blocks showing rank and PnL
- **Priority**: MEDIUM
- **Complexity**: Low
- **Estimated Time**: 2-3 hours

#### D. Smart Score Projection
```typescript
interface SmartScoreProjection {
  current_score: number;
  current_percentile: number;
  current_pnl: number;
  projected_score: number; // if all open positions resolved at current marks
  projected_delta: number;
  reliability: number;
}
```
- **Priority**: MEDIUM
- **Complexity**: Medium
- **Estimated Time**: 3-4 hours

#### E. Risk Block
```typescript
interface RiskMetrics {
  sharpe_ratio_30d: number; // annualized, sqrt 252
  sharpe_level: 'Excellent' | 'Good' | 'Fair' | 'Poor'; // threshold ≥ 2.0
  traded_usd_30d_daily: {
    date: string;
    volume_usd: number;
  }[];
  traded_usd_30d_total: number;
}
```
- **Priority**: HIGH
- **Complexity**: Medium
- **Estimated Time**: 3-4 hours

#### F. Active Bets vs Finished Bets
Currently combined. Spec requires:
```typescript
interface ActiveBet {
  question: string;
  position_usd: number;
  avg_price: number;
  current_price: number;
  realized_pnl: number;
  total_invested: number;
  unrealized_pnl: number;
  overall_pnl: number;
  overall_pnl_pct: number;
  side: 'YES' | 'NO';
}

interface FinishedBet extends ActiveBet {
  roi: number;
}

interface FinishedBetsSummary {
  total_notional: number;
  total_pnl: number;
  best_trade: {
    market: string;
    roi: number;
  };
  worst_trade: {
    market: string;
    roi: number;
  };
}
```
- **Priority**: HIGH
- **Complexity**: Medium
- **Estimated Time**: 4-5 hours

#### G. Finished Trades Visuals
```typescript
interface FinishedTradesScatter {
  buy_price: number;
  sell_price: number;
  dollar_value: number; // bubble size
  profit_region: boolean; // green if sell > buy
  regression_line?: boolean;
}

interface ROIHistogram {
  roi_bins: number[];
  frequency_usd_weighted: number[];
  color: 'red' | 'green'; // based on sign
}
```
- Scatter plot: Buy price vs Sell price
- Histogram: ROI distribution
- **Priority**: MEDIUM
- **Complexity**: Medium
- **Estimated Time**: 4-5 hours

#### H. Category Insights
```typescript
interface CategoryInsights {
  profit_loss_donuts: {
    category: string;
    profit_usd: number;
    loss_usd: number;
  }[];

  most_traded_radar: {
    category: string;
    value: number;
  }[];

  smart_score_radar: {
    category: string;
    score: number;
  }[];

  win_rate_radar: {
    category: string;
    win_rate: number;
  }[];
}
```
- Categories: Politics, Sport, Crypto, Culture, Weather, Other
- **Priority**: MEDIUM
- **Complexity**: Medium
- **Estimated Time**: 5-6 hours

#### I. Per Market Time Series
```typescript
interface MarketTimeSeries {
  market_id: string;
  realized_pnl_cumulative: {
    timestamp: string;
    pnl: number;
  }[];
  background_bands: 'green' | 'red'; // based on PnL sign
}
```
- Market selector dropdown
- Line chart with colored background
- **Priority**: LOW
- **Complexity**: Medium
- **Estimated Time**: 3-4 hours

#### J. Execution Over Time
```typescript
interface ExecutionMarkers {
  timestamp: string;
  price: number;
  action: 'BUY' | 'SELL';
  market_price: number;
}

interface AvgBuyPriceOverTime {
  timestamp: string;
  avg_buy_price: number;
  market_price: number;
}
```
- Trades on price line (triangles)
- Average buy price vs market price
- **Priority**: LOW
- **Complexity**: Medium
- **Estimated Time**: 4-5 hours

#### K. Recent Trades with Comments
```typescript
interface RecentTrade {
  timestamp: string;
  question: string;
  side: 'YES' | 'NO';
  price: number;
  amount_usd: number;
  shares: number;
  comment?: string; // e.g., "Smaller than usual"
}
```
- **Priority**: LOW
- **Complexity**: Medium
- **Estimated Time**: 2-3 hours

#### L. Entry Preference Bar Chart
```typescript
interface EntryPreference {
  price_bucket: number; // 0.0 to 0.9
  usd_invested: number;
}
```
- Where trader bets most by price range
- **Priority**: LOW
- **Complexity**: Low
- **Estimated Time**: 2-3 hours

---

## API Contracts (TypeScript Interfaces)

### Market Detail APIs

```typescript
// GET /api/v1/markets/{marketId}/overview
interface MarketOverviewResponse {
  header_stats: {
    volume_24h: number;
    volume_total: number;
    liquidity_usd: number;
    unique_traders_24h: number;
    unique_traders_24h_sparkline: { hour: number; count: number }[];
    buy_yes_trades_24h: number;
    buy_yes_trades_24h_hourly: { hour: number; count: number }[];
    buy_no_trades_24h: number;
    buy_no_trades_24h_hourly: { hour: number; count: number }[];
    resolution_note?: string;
    external_link?: string;
  };

  price_chips: {
    p_yes: number;
    p_no: number;
  };

  related_markets: RelatedMarket[];
  liquidity_impact: LiquidityImpact;
  market_bias: MarketBias[];
}

// GET /api/v1/markets/{marketId}/holders?side=YES|NO
interface HoldersResponse {
  side: 'YES' | 'NO';
  summary: HoldersSummary;
  positions: HolderPosition[];
  top_traders: TopTrader[];
}

// GET /api/v1/markets/{marketId}/charts/wallet-age-density?side=YES|NO
interface WalletAgeDensityResponse {
  side: 'YES' | 'NO';
  kde_data: WalletAgeDensity;
}

// GET /api/v1/markets/{marketId}/charts/ohlc?interval=1h&span=7d
interface OHLCResponse {
  ohlc_data: {
    timestamp: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }[];
}

// GET /api/v1/markets/{marketId}/charts/holding-time
interface HoldingTimeResponse {
  buckets: HoldingTimeBucket[];
}

// GET /api/v1/markets/{marketId}/charts/whale-concentration?side=YES|NO
interface WhaleConcentrationResponse {
  side: 'YES' | 'NO';
  heatmap_data: WhaleConcentration[];
}

// GET /api/v1/markets/{marketId}/trades/unusual?filters=...
interface UnusualTradesResponse {
  trades: UnusualTrade[];
  total: number;
  page: number;
  page_size: number;
}

// GET /api/v1/markets/{marketId}/score-comparison
interface ScoreComparisonResponse {
  comparison: ScoreComparison;
}

// GET /api/v1/markets/{marketId}/trades/explorer?filters=...
interface TradesExplorerResponse {
  trades: TradeRecord[];
  total: number;
  page: number;
  page_size: number;
}
```

### Wallet Detail APIs

```typescript
// GET /api/v1/wallets/{address}/profile
interface WalletProfileResponse {
  identity: {
    address: string;
    username?: string;
    avatar_url?: string;
  };
  badges: IdentityBadges;
  summary: WalletSummary;
  pnl_ranks: {
    d1: PnLRank;
    d7: PnLRank;
    d30: PnLRank;
    all: PnLRank;
  };
  smart_score: SmartScoreProjection;
  risk: RiskMetrics;
}

// GET /api/v1/wallets/{address}/positions?status=active|finished&page=1
interface WalletPositionsResponse {
  status: 'active' | 'finished';
  rows: (ActiveBet | FinishedBet)[];
  totals: {
    notional: number;
    pnl: number;
  };
  summary?: FinishedBetsSummary; // only for finished
  total: number;
  page: number;
  page_size: number;
}

// GET /api/v1/wallets/{address}/charts/finished-trades
interface FinishedTradesVisualsResponse {
  scatter_data: FinishedTradesScatter[];
  histogram_data: ROIHistogram;
}

// GET /api/v1/wallets/{address}/categories
interface WalletCategoriesResponse {
  insights: CategoryInsights;
}

// GET /api/v1/wallets/{address}/markets/{marketId}/series
interface MarketSeriesResponse {
  price_with_markers: ExecutionMarkers[];
  avg_buy_series: AvgBuyPriceOverTime[];
  realized_pnl_cum: {
    timestamp: string;
    pnl: number;
  }[];
}

// GET /api/v1/wallets/{address}/trades?from=&to=&min_usd=&max_usd=&page=
interface WalletTradesResponse {
  rows: RecentTrade[];
  total: number;
  page: number;
  page_size: number;
}

// GET /api/v1/wallets/{address}/entry-buckets
interface EntryBucketsResponse {
  buckets: EntryPreference[];
}
```

---

## Implementation Roadmap

### Phase 1: High Priority Features (2-3 weeks)

**Market Detail:**
1. Related Markets grid (6h)
2. Holders Tables per side (8h)
3. OHLC Block (5h)

**Wallet Detail:**
1. Identity Badges (2h)
2. Risk Block with Sharpe Ratio (4h)
3. Active vs Finished Bets separation (5h)

**Total: ~30 hours**

### Phase 2: Medium Priority Features (2-3 weeks)

**Market Detail:**
1. Liquidity & Impact Cards (4h)
2. Market Bias Donuts (3h)
3. Top Traders Panels (4h)
4. Holding Time Stacked Area (4h)
5. Whale Concentration Heatmap (7h)
6. Unusual Trades Table (5h)

**Wallet Detail:**
1. Rank by PnL Blocks (3h)
2. Smart Score Projection (4h)
3. Finished Trades Visuals (5h)
4. Category Insights (6h)

**Total: ~45 hours**

### Phase 3: Low Priority Features (1-2 weeks)

**Market Detail:**
1. Wallet Age Density KDE (6h)
2. Score Comparison (8h)
3. Trades Explorer (6h)

**Wallet Detail:**
1. Per Market Time Series (4h)
2. Execution Over Time (5h)
3. Recent Trades with Comments (3h)
4. Entry Preference Bar Chart (3h)

**Total: ~35 hours**

---

## Database/Precompute Requirements

### Market Detail
- `market_holders_mv` - materialized view for holders per side
- `market_whale_concentration_mv` - for heatmap data
- `market_holding_time_mv` - for stacked area chart
- `market_bias_hourly_mv` - for donut charts
- `market_trades_unusual_mv` - for unusual trades detection

### Wallet Detail
- `wallet_profiles_mv` - with totals, first_seen, current_balance
- `wallet_performance_mv` - 1D, 7D, 30D, all time PnL and ranks
- `wallet_category_mv` - for radar charts
- `wallet_trades_daily_mv` - for Sharpe and traded volume
- `wallet_positions_mv` - for active and finished joins
- `wallet_entry_buckets_mv` - for price bucket bars
- `wallet_score_projections_mv` - recomputed scores

---

## ECharts Component Recommendations

### Market Detail
- **Area sparkline**: unique traders 24h, buy trades hourly
- **Donut charts**: market bias (4 timeframes)
- **Heatmap**: whale concentration
- **Stacked area**: holding time buckets
- **Candlestick**: OHLC with volume
- **KDE plot**: wallet age density
- **Scatter**: score comparison

### Wallet Detail
- **Line with markers**: execution over time (triangles)
- **Scatter with regions**: finished trades (buy vs sell)
- **Histogram**: ROI distribution
- **Donut**: category profit/loss
- **Radar**: most traded, smart score, win rate by category
- **Bar**: entry preference buckets
- **Area with bands**: per market PnL

---

## Next Steps

1. **Review this document** and prioritize features
2. **Set up API endpoints** with mock data matching these interfaces
3. **Create component library** for reusable chart types
4. **Implement Phase 1** features first
5. **Test with real data** as APIs become available
6. **Iterate** based on user feedback

**Estimated Total Time**: 110-120 hours (~3 months at 10 hours/week)
