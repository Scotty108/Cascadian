# Category-Specific Wallet Metrics

## Overview

This document describes the category-specific wallet metrics system that enables Smart Money signals to use category-specific performance indicators (e.g., a wallet's Politics Omega for Politics markets).

## Architecture

### Database Schema

**Table:** `wallet_metrics_by_category`

**Key Fields:**
- `wallet_address` + `category` + `window` (composite primary key)
- Same 102 metrics as `wallet_metrics_complete`, but computed per category
- Additional category context fields:
  - `trades_in_category`: Total trades in this category
  - `pct_of_total_trades`: % of wallet's trades in this category
  - `pct_of_total_volume`: % of wallet's volume in this category
  - `is_primary_category`: TRUE if most trades are in this category

**Time Windows:** 30d, 90d, 180d, lifetime

**Join Path:**
```
trades_raw.market_id
  → markets_dim.market_id
  → markets_dim.event_id
  → events_dim.event_id
  → events_dim.canonical_category
```

### Implementation

**Script:** `/scripts/compute-wallet-metrics-by-category.ts`

**Flow:**
1. Query all (wallet, category) pairs with >= 5 trades
2. For each time window (30d, 90d, 180d, lifetime):
   - Compute TIER 1 metrics per (wallet, category) pair
   - Enrich with category-specific context fields
   - Enrich with tail ratios, resolution accuracy, and performance trends
3. Insert into `wallet_metrics_by_category` table
4. Generate summary report

**Batch Processing:**
- Processes 500 wallet-category pairs at a time
- Prevents memory issues with large datasets

## TIER 1 Metrics Implemented

### Performance Metrics (per category)
- `metric_2_omega_net`: Category-specific Omega ratio (gains/losses)
- `metric_6_sharpe`: Category-specific Sharpe ratio (risk-adjusted returns)
- `metric_9_net_pnl_usd`: Category-specific net P&L
- `metric_12_hit_rate`: Category-specific win rate
- `metric_13_avg_win_usd`: Category-specific average win
- `metric_14_avg_loss_usd`: Category-specific average loss
- `metric_60_tail_ratio`: Category-specific win/loss distribution

### Activity Metrics (per category)
- `metric_22_resolved_bets`: Trade count in this category
- `metric_23_track_record_days`: Days active in this category
- `metric_24_bets_per_week`: Betting frequency in this category

### Capital Efficiency (per category)
- `metric_69_ev_per_hour_capital`: EV per hour of capital deployed

### Trend Indicators (per category)
- `metric_85_performance_trend_flag`: Improving/declining/stable
- `metric_88_sizing_discipline_trend`: Consistency in position sizing

### Resolution Accuracy (per category)
- `resolution_accuracy`: Prediction correctness in this category

## Usage

### Run the Script

```bash
# Dry run (recommended first)
DRY_RUN=1 npx tsx scripts/compute-wallet-metrics-by-category.ts

# Production run
npx tsx scripts/compute-wallet-metrics-by-category.ts
```

### Query Examples

**Get a wallet's Politics-specific metrics:**
```sql
SELECT
  wallet_address,
  category,
  window,
  metric_2_omega_net as omega,
  metric_9_net_pnl_usd as pnl,
  metric_12_hit_rate as win_rate,
  pct_of_total_trades,
  is_primary_category
FROM wallet_metrics_by_category
WHERE wallet_address = '0x...'
  AND category = 'Politics'
  AND window = 'lifetime'
```

**Get top Politics specialists:**
```sql
SELECT
  wallet_address,
  metric_2_omega_net as politics_omega,
  metric_9_net_pnl_usd as politics_pnl,
  metric_22_resolved_bets as politics_trades,
  pct_of_total_trades
FROM wallet_metrics_by_category
WHERE category = 'Politics'
  AND window = 'lifetime'
  AND metric_22_resolved_bets >= 10
  AND is_primary_category = true
ORDER BY metric_2_omega_net DESC
LIMIT 20
```

**Get category distribution for a wallet:**
```sql
SELECT
  category,
  metric_22_resolved_bets as trades,
  metric_9_net_pnl_usd as pnl,
  pct_of_total_trades,
  is_primary_category
FROM wallet_metrics_by_category
WHERE wallet_address = '0x...'
  AND window = 'lifetime'
ORDER BY pct_of_total_trades DESC
```

**Find multi-category specialists:**
```sql
SELECT
  wallet_address,
  COUNT(DISTINCT category) as categories_traded,
  SUM(metric_22_resolved_bets) as total_trades,
  AVG(metric_2_omega_net) as avg_omega_across_categories
FROM wallet_metrics_by_category
WHERE window = 'lifetime'
  AND metric_22_resolved_bets >= 10
GROUP BY wallet_address
HAVING categories_traded >= 3
  AND avg_omega_across_categories > 2.0
ORDER BY avg_omega_across_categories DESC
```

## Integration with Smart Money Signals

### Category-Specific Omega Filtering

**Before (overall metrics):**
```typescript
// Used overall Omega regardless of market category
const eligibleWallets = await db.query(`
  SELECT wallet_address, metric_2_omega_net
  FROM wallet_metrics_complete
  WHERE metric_2_omega_net >= 3.0
    AND window = 'lifetime'
`)
```

**After (category-specific metrics):**
```typescript
// Use category-specific Omega for Politics markets
const eligibleWallets = await db.query(`
  SELECT
    wmc.wallet_address,
    wmc.metric_2_omega_net as politics_omega
  FROM wallet_metrics_by_category wmc
  INNER JOIN markets_dim m ON m.market_id = :marketId
  INNER JOIN events_dim e ON m.event_id = e.event_id
  WHERE wmc.category = e.canonical_category
    AND wmc.metric_2_omega_net >= 3.0
    AND wmc.window = 'lifetime'
    AND wmc.metric_22_resolved_bets >= 10
`)
```

### Smart Money Signal Example

```typescript
// Generate SII for a Politics market
const market = await getMarketById(marketId)
const category = await getCategoryForMarket(marketId) // 'Politics'

// Get wallets with strong Politics-specific performance
const smartMoneyWallets = await db.query(`
  SELECT
    wallet_address,
    metric_2_omega_net as category_omega,
    metric_60_tail_ratio as category_tail_ratio,
    pct_of_total_trades as category_specialization
  FROM wallet_metrics_by_category
  WHERE category = :category
    AND window = '90d'
    AND metric_2_omega_net >= 3.0
    AND metric_22_resolved_bets >= 10
  ORDER BY metric_2_omega_net DESC
  LIMIT 50
`, { category })

// Calculate Smart Money Intensity Index using category-specific signals
const sii = calculateSII(market, smartMoneyWallets)
```

## Expected Results

### Scale Estimates

For 2,839 wallets:
- Average 2-4 categories per wallet with >= 5 trades
- Expected rows: **~34,000 rows** (2,839 × 3 categories × 4 windows)
- Processing time: **~1-2 minutes**

When scaled to 65k wallets:
- Expected rows: **~780,000 rows** (65k × 3 × 4)
- Processing time: **~30-45 minutes**

### Category Distribution

Common categories:
- **Politics**: Largest category, ~60-70% of wallets
- **Crypto**: ~40-50% of wallets
- **Sports**: ~30-40% of wallets
- **Pop Culture**: ~20-30% of wallets
- **Business & Finance**: ~15-25% of wallets
- Other categories: Lower representation

## Performance Optimization

### Query Optimization
- Indexes on `(category, metric_2_omega_net)` for category leaderboards
- Index on `(wallet_address, category)` for wallet lookups
- Index on `is_primary_category` for specialist detection
- Partitioning by `(category, window)` for efficient queries

### Batch Processing
- Processes 500 pairs at a time to avoid memory issues
- Uses OR conditions instead of individual queries
- Enrichment steps run in parallel where possible

### Caching Strategy
- Results cached for 1 hour (same as overall metrics)
- Incremental updates only for new/updated wallets
- ReplacingMergeTree deduplicates on `calculated_at`

## Migration

**Migration file:** `/migrations/clickhouse/013_create_wallet_metrics_by_category.sql`

**Run migration:**
```bash
# Apply migration
npx tsx scripts/apply-supabase-migration.ts clickhouse/013_create_wallet_metrics_by_category.sql
```

**Verify table:**
```sql
-- Check table exists
SELECT count() FROM wallet_metrics_by_category;

-- Check schema
DESCRIBE wallet_metrics_by_category;

-- Check partitions
SELECT
  partition,
  name,
  rows,
  formatReadableSize(bytes_on_disk) as size
FROM system.parts
WHERE table = 'wallet_metrics_by_category'
  AND active
ORDER BY partition, name;
```

## Maintenance

### Refresh Schedule
- Run daily after trades are enriched
- Full refresh: ~30-45 minutes (for 65k wallets)
- Incremental: Only new/updated wallets

### Monitoring
- Track row count: Should match expected scale
- Monitor query performance: p95 < 500ms for category lookups
- Check data freshness: `MAX(calculated_at)` should be recent

### Troubleshooting

**No rows returned:**
```sql
-- Check if markets_dim and events_dim are populated
SELECT COUNT(*) FROM markets_dim;
SELECT COUNT(*) FROM events_dim WHERE canonical_category != '';

-- Check if join path works
SELECT COUNT(*)
FROM trades_raw t
INNER JOIN markets_dim m ON t.market_id = m.market_id
INNER JOIN events_dim e ON m.event_id = e.event_id
WHERE e.canonical_category != '';
```

**Slow queries:**
```sql
-- Check if indexes exist
SELECT name, type, expr
FROM system.data_skipping_indices
WHERE table = 'wallet_metrics_by_category';

-- Analyze query performance
EXPLAIN indexes = 1
SELECT * FROM wallet_metrics_by_category
WHERE category = 'Politics' AND metric_2_omega_net > 3.0;
```

## Future Enhancements

### Phase 3 Metrics
- CLV (Closing Line Value) per category
- Calibration score per category
- News reaction time per category

### Phase 4 Features
- Auto-detect category specialists (>80% trades in one category)
- Category rotation tracking (shifting focus over time)
- Cross-category correlation analysis
- Category-specific risk scores

## References

- [Overall Wallet Metrics](/scripts/compute-wallet-metrics.ts)
- [Metrics Documentation](/docs/metrics.md)
- [Smart Money Signals](/docs/smart-money-signals.md)
- [Austin Methodology](/docs/austin-methodology.md)
