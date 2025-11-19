# Phase 2: All-Wallet Analytics & Leaderboards

**Timeline:** 1 week
**Prerequisites:** Phase 1 Step D+E complete, all 4 gates passed
**Database State:** ~2.45M trades across 2,839-10,000+ wallets (expandable)

## Objective

Compute comprehensive wallet performance metrics across all wallets in the system, enabling:
- Multi-timeframe performance analysis (30d/90d/180d/lifetime)
- Per-category expertise scoring (Politics, Sports, Crypto, etc.)
- Leaderboards by various dimensions (ROI, Sharpe, accuracy, volume)
- API endpoints for wallet discovery and comparison

## Scope

### 1. Core Metrics (102 metrics × 4 time windows)

**Time Windows:**
- 30-day rolling
- 90-day rolling
- 180-day rolling
- Lifetime (all-time)

**Metric Categories:**

**A. P&L Metrics** (9 metrics)
- Total realized P&L (USD)
- Total unrealized P&L (USD)
- Net P&L (realized + unrealized)
- Gross P&L (before fees)
- ROI % (return on capital deployed)
- Win rate % (winning trades / total trades)
- Average win size (USD)
- Average loss size (USD)
- Profit factor (gross wins / gross losses)

**B. Risk-Adjusted Returns** (6 metrics)
- Sharpe Ratio (annualized)
- Sortino Ratio (downside deviation only)
- Calmar Ratio (return / max drawdown)
- Omega Ratio (probability-weighted gains/losses)
- Kelly Criterion % (optimal bet sizing)
- Information Ratio (alpha / tracking error)

**C. Risk Metrics** (5 metrics)
- Maximum Drawdown (USD and %)
- Current Drawdown (USD and %)
- Value at Risk (VaR 95%)
- Conditional VaR (CVaR 95%)
- Volatility (annualized std dev of daily returns)

**D. Accuracy & Resolution** (4 metrics)
- Resolution accuracy % (correct side when market resolves)
- Weighted accuracy % (size-weighted correctness)
- Brier score (calibration quality)
- Log score (probabilistic accuracy)

**E. Trading Behavior** (8 metrics)
- Total trades
- Total volume (USD)
- Average trade size (USD)
- Median trade size (USD)
- Average hold time (hours)
- Turnover ratio (volume / capital)
- Diversification score (markets traded / total markets)
- Concentration ratio (top 10 markets % of volume)

**F. Market Timing** (4 metrics)
- Closing Line Value (CLV) - entry price vs close price
- Average CLV bps (basis points better than close)
- Early entry % (trades in first 25% of market lifetime)
- Late entry % (trades in last 25% before resolution)

**G. Per-Category Performance** (66 metrics = 11 categories × 6 metrics)
- Categories: Politics, Sports, Crypto, Pop Culture, Science, Business, Entertainment, News, Gaming, Forecast, Uncategorized
- Per-category metrics:
  - Total P&L (USD)
  - ROI %
  - Sharpe Ratio
  - Accuracy %
  - Total volume (USD)
  - Trade count

### 2. Data Model

**ClickHouse Materialized View:** `wallet_metrics_aggregated`

```sql
CREATE MATERIALIZED VIEW wallet_metrics_aggregated
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (wallet_address, time_window, category)
AS SELECT
  wallet_address,
  date,
  time_window,  -- '30d', '90d', '180d', 'lifetime'
  category,     -- 'all', 'Politics', 'Sports', etc.

  -- P&L
  sum(pnl_net) AS total_pnl,
  sum(pnl_gross) AS gross_pnl,
  sum(usd_value) AS total_volume,

  -- Risk
  max(drawdown_usd) AS max_drawdown,
  stddevPop(daily_pnl) AS volatility,

  -- Accuracy
  avg(was_correct) AS accuracy_rate,
  count() AS total_trades,

  -- Aggregates for downstream computation
  groupArray(daily_pnl) AS pnl_series,
  groupArray(trade_size) AS size_distribution
FROM trades_enriched
GROUP BY wallet_address, date, time_window, category
```

**Supabase Table:** `wallet_metrics`

```sql
CREATE TABLE wallet_metrics (
  wallet_address TEXT NOT NULL,
  time_window TEXT NOT NULL,  -- '30d', '90d', '180d', 'lifetime'
  category TEXT NOT NULL,      -- 'all', category name, or 'category:Politics'

  -- P&L
  total_pnl DECIMAL(18,2),
  roi_pct DECIMAL(10,4),
  win_rate DECIMAL(5,2),
  profit_factor DECIMAL(10,4),

  -- Risk-adjusted
  sharpe_ratio DECIMAL(10,4),
  sortino_ratio DECIMAL(10,4),
  omega_ratio DECIMAL(10,4),

  -- Risk
  max_drawdown_usd DECIMAL(18,2),
  max_drawdown_pct DECIMAL(5,2),
  volatility DECIMAL(10,4),

  -- Accuracy
  accuracy_pct DECIMAL(5,2),
  brier_score DECIMAL(10,6),

  -- Volume
  total_volume DECIMAL(18,2),
  total_trades INT,
  avg_trade_size DECIMAL(18,2),

  -- Metadata
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  data_freshness TIMESTAMPTZ,

  PRIMARY KEY (wallet_address, time_window, category)
);

CREATE INDEX idx_wallet_metrics_roi ON wallet_metrics(roi_pct DESC) WHERE time_window = 'lifetime' AND category = 'all';
CREATE INDEX idx_wallet_metrics_sharpe ON wallet_metrics(sharpe_ratio DESC) WHERE time_window = 'lifetime' AND category = 'all';
CREATE INDEX idx_wallet_metrics_category ON wallet_metrics(category, roi_pct DESC);
```

### 3. Computation Pipeline

**Script:** `scripts/compute-wallet-metrics.ts`

```
Input:  trades_raw (ClickHouse)
        markets_dim (ClickHouse)
Output: wallet_metrics (Supabase)
        wallet_metrics_aggregated (ClickHouse MV)

Steps:
1. For each wallet:
   a. Pull all trades from ClickHouse
   b. Group by time window (30d/90d/180d/lifetime)
   c. Compute 102 metrics per window
   d. Insert into Supabase wallet_metrics

2. For each wallet × category:
   a. Filter trades by canonical_category
   b. Compute 6 per-category metrics per window
   c. Insert with category = 'category:{name}'

3. Update metadata:
   - computed_at = NOW()
   - data_freshness = max(trade timestamp)
```

**Script:** `scripts/compute-wallet-metrics-by-category.ts`

```
Input:  trades_raw WHERE canonical_category != 'Uncategorized'
Output: wallet_metrics (category-specific rows)

For each (wallet, category, time_window):
  - Filter to category trades only
  - Compute P&L, ROI, Sharpe, Omega, accuracy, volume
  - Insert row with category = 'category:{name}'
```

### 4. Leaderboard Views (ClickHouse)

**File:** `migrations/clickhouse/views/v_top_wallets.sql`

```sql
CREATE VIEW v_top_wallets AS
SELECT
  wallet_address,
  total_pnl,
  roi_pct,
  sharpe_ratio,
  accuracy_pct,
  total_volume,
  total_trades,
  rank() OVER (ORDER BY roi_pct DESC) as rank_roi,
  rank() OVER (ORDER BY sharpe_ratio DESC) as rank_sharpe,
  rank() OVER (ORDER BY total_pnl DESC) as rank_pnl
FROM wallet_metrics
WHERE time_window = 'lifetime' AND category = 'all'
ORDER BY roi_pct DESC
LIMIT 1000;
```

**File:** `migrations/clickhouse/views/v_wallet_accuracy_by_category.sql`

```sql
CREATE VIEW v_wallet_accuracy_by_category AS
SELECT
  wallet_address,
  category,
  accuracy_pct,
  total_trades,
  total_pnl,
  sharpe_ratio,
  rank() OVER (PARTITION BY category ORDER BY accuracy_pct DESC) as rank_in_category
FROM wallet_metrics
WHERE
  time_window = 'lifetime'
  AND category LIKE 'category:%'
  AND total_trades >= 10  -- Minimum significance threshold
ORDER BY category, accuracy_pct DESC;
```

### 5. API Endpoints

**GET /api/wallets/[address]/metrics**
```json
{
  "wallet_address": "0xabc...",
  "metrics": {
    "lifetime": { "total_pnl": 12500.00, "roi_pct": 15.5, "sharpe_ratio": 1.2, ... },
    "180d": { ... },
    "90d": { ... },
    "30d": { ... }
  },
  "by_category": {
    "Politics": { "lifetime": { "pnl": 8500, "roi_pct": 22.0, ... }, ... },
    "Sports": { ... }
  },
  "rankings": {
    "lifetime_roi": 47,
    "lifetime_sharpe": 123,
    "category_politics_roi": 12
  },
  "computed_at": "2025-10-28T19:00:00Z"
}
```

**GET /api/leaderboards?metric=roi&window=lifetime&limit=100**
```json
{
  "leaderboard": [
    { "wallet_address": "0xabc...", "roi_pct": 45.2, "sharpe_ratio": 2.1, "total_trades": 245 },
    ...
  ],
  "metadata": {
    "metric": "roi",
    "window": "lifetime",
    "total_wallets": 2839,
    "computed_at": "2025-10-28T19:00:00Z"
  }
}
```

**GET /api/leaderboards/category/[category]?metric=accuracy**
```json
{
  "category": "Politics",
  "leaderboard": [
    { "wallet_address": "0xdef...", "accuracy_pct": 78.5, "total_trades": 142 },
    ...
  ]
}
```

### 6. Orchestration

**Integration with overnight-orchestrator.ts:**

```typescript
// After Step E (resolution accuracy) passes gates:

if (gatesPassed) {
  console.log('Phase 2: Computing all-wallet metrics...')

  // 1. All-wallet metrics
  await runScript('compute-wallet-metrics.ts')

  // 2. Per-category metrics
  await runScript('compute-wallet-metrics-by-category.ts')

  // 3. Refresh materialized views
  await runScript('refresh-clickhouse-views.ts')

  // 4. Sync to Supabase for API consumption
  await runScript('sync-metrics-to-supabase.ts')

  console.log('Phase 2 complete. Leaderboards live.')
}
```

### 7. Performance Targets

**Computation:**
- Time: <2 hours for 2,839 wallets, <8 hours for 10k wallets
- Parallelization: 10 wallets concurrently
- Memory: <4GB peak (streaming computation)

**API Response Times:**
- Single wallet metrics: <100ms (cached in Supabase)
- Leaderboard (top 100): <200ms (materialized view)
- Category leaderboard: <300ms

**Data Freshness:**
- Overnight batch: Updated daily at 4 AM UTC
- Incremental: New trades processed within 15 minutes

### 8. Shadow Backlog Integration

After gates pass, optionally bulk-apply the 10,059 NEW wallets from shadow discovery:

```bash
# Load shadow wallets into ClickHouse
npx tsx scripts/bulk-load-shadow-wallets.ts

# Recompute metrics for ALL wallets (now 10k+)
npx tsx scripts/compute-wallet-metrics.ts --full-refresh
```

This expands the universe from 2,839 → 10,112+ wallets.

## Success Criteria

- ✅ All 102 metrics computed for all wallets across 4 time windows
- ✅ Per-category metrics for 11 categories
- ✅ Leaderboard APIs returning <200ms
- ✅ Daily overnight refresh completing successfully
- ✅ Data quality gates: no NaN, no negative volumes, Sharpe ratios in [-5, 10] range
- ✅ Frontend integration: leaderboard pages rendering real data

## Risks & Mitigations

**Risk:** Computation time blows up with 10k wallets
**Mitigation:** Parallelize, use ClickHouse aggregations, incremental updates

**Risk:** Metric formulas incorrect (especially Sharpe, Omega)
**Mitigation:** Validate against known-good wallets, manual spot-checks, unit tests

**Risk:** Category assignments incomplete
**Mitigation:** Already handled in Step B (denorm categories), but add gate check

**Risk:** API becomes bottleneck
**Mitigation:** Cache in Supabase, use CDN for leaderboards, add Redis if needed

## Next Steps After Phase 2

**Phase 3:** Real-time watchlist signals
- Stream new trades via websockets
- Recompute metrics incrementally
- Push notifications when smart money moves
