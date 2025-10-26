# Tier 1 Metrics Calculator

**Script:** `scripts/calculate-tier1-metrics.ts`
**Purpose:** Calculate the 8 most critical metrics from enriched trades in ClickHouse
**Output:** Populates `wallet_metrics_complete` table with Tier 1 metrics

---

## Overview

The Tier 1 Metrics Calculator processes enriched trade data from the `trades_raw` table and calculates 8 critical performance metrics for each wallet across 4 time windows. These metrics form the foundation of the wallet analytics system and enable ranking and filtering of traders.

### Time Windows

- **30d**: Last 30 days of trading activity
- **90d**: Last 90 days of trading activity
- **180d**: Last 180 days of trading activity
- **lifetime**: All trading activity

---

## 8 Critical Tier 1 Metrics

### 1. **metric_1_omega_gross** (Decimal 12,4)
- **Formula:** `total_gains / total_losses` (before fees)
- **Purpose:** Risk-adjusted returns ignoring costs
- **Range:** 0.0+ (higher is better)
- **Filters:** Only closed positions with `outcome IS NOT NULL`

### 2. **metric_2_omega_net** (Decimal 12,4) ⭐ PRIMARY METRIC
- **Formula:** `total_gains / total_losses` (after fees)
- **Purpose:** True profitability metric accounting for all costs
- **Range:** 0.0+ (higher is better, >1.0 is profitable)
- **Use Case:** Primary ranking and leaderboard sorting

### 3. **metric_9_net_pnl_usd** (Decimal 18,2)
- **Formula:** `SUM(pnl_net)`
- **Purpose:** Total profit/loss in USD
- **Range:** Any positive or negative value
- **Use Case:** Absolute performance measurement

### 4. **metric_12_hit_rate** (Decimal 5,4)
- **Formula:** `wins / total_closed_positions`
- **Purpose:** Win percentage (accuracy)
- **Range:** 0.0 to 1.0 (0% to 100%)
- **Use Case:** Consistency and accuracy filtering

### 5. **metric_13_avg_win_usd** (Decimal 18,2)
- **Formula:** `AVG(pnl_net WHERE pnl_net > 0)`
- **Purpose:** Average size of winning trades
- **Range:** Positive USD values
- **Use Case:** Identify large bet winners vs small bet winners

### 6. **metric_14_avg_loss_usd** (Decimal 18,2)
- **Formula:** `AVG(ABS(pnl_net) WHERE pnl_net <= 0)`
- **Purpose:** Average size of losing trades (absolute value)
- **Range:** Positive USD values
- **Use Case:** Risk management and loss control analysis

### 7. **metric_15_ev_per_bet_mean** (Decimal 18,4)
- **Formula:** `AVG(pnl_net)`
- **Purpose:** Expected value per trade
- **Range:** Any value (positive = profitable on average)
- **Use Case:** Edge identification and bet sizing optimization

### 8. **metric_22_resolved_bets** (UInt32)
- **Formula:** `COUNT(*) WHERE is_closed = true`
- **Purpose:** Sample size for statistical significance
- **Range:** Integer count
- **Use Case:** Filter out wallets with insufficient data
- **Minimum:** 5 trades required

---

## Prerequisites

### 1. Data Requirements

The `trades_raw` table must have enriched data with the following columns:
- `outcome` (Int8): 1 = YES won, 0 = NO won, NULL = unresolved
- `pnl_net` (Decimal 18,6): Net P&L after all costs
- `pnl_gross` (Decimal 18,6): Gross P&L before fees
- `is_closed` (Bool): Position is closed/resolved
- `hours_held` (Decimal 10,2): Duration of position

### 2. Table Setup

Run ClickHouse migrations:
```bash
# Create trades_raw table
npx tsx scripts/setup-clickhouse-schema.ts

# Add enrichment columns
# Execute: migrations/clickhouse/002_add_metric_fields.sql

# Create wallet_metrics_complete table
# Execute: migrations/clickhouse/004_create_wallet_metrics_complete.sql
```

### 3. Environment Variables

Required in `.env.local`:
```bash
CLICKHOUSE_HOST=https://your-clickhouse-host.com
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=your_password
CLICKHOUSE_DATABASE=default
```

---

## Usage

### Basic Usage (All Windows)

Calculate metrics for all 4 time windows:

```bash
npx tsx scripts/calculate-tier1-metrics.ts
```

This will:
1. Check data readiness
2. Calculate metrics for 30d, 90d, 180d, and lifetime windows
3. Insert results into `wallet_metrics_complete`
4. Validate the data
5. Show top 10 performers for each window

### Specific Windows

Calculate for specific time windows only:

```bash
# Only 30-day window
npx tsx scripts/calculate-tier1-metrics.ts 30d

# Multiple specific windows
npx tsx scripts/calculate-tier1-metrics.ts 30d lifetime

# 90-day and 180-day windows
npx tsx scripts/calculate-tier1-metrics.ts 90d 180d
```

---

## Output

### Console Output

The script provides detailed progress tracking:

```
═══════════════════════════════════════════════════════════
          TIER 1 METRICS CALCULATOR
═══════════════════════════════════════════════════════════
Calculating 8 critical metrics from enriched trades
Output: wallet_metrics_complete table
═══════════════════════════════════════════════════════════

🔍 Checking data readiness...

   Total trades: 125,432
   Enriched trades (outcome set): 98,234
   Trades with PnL: 98,234
   Enrichment rate: 78.3%

   ✅ Data is ready for metrics calculation

📋 Processing 4 time window(s): 30d, 90d, 180d, lifetime

════════════════════════════════════════════════════════════
Processing: 30D WINDOW
════════════════════════════════════════════════════════════

📊 Calculating Tier 1 metrics for 30d window...
   🔍 Executing query for 30d window...
   📋 Filter: timestamp >= now() - INTERVAL 30 DAY
   ✅ Calculated metrics for 1,245 wallets
   ⏱️  Query completed in 2.34s

💾 Inserting 1,245 metric records into wallet_metrics_complete...
   📦 Batch 1/2: Inserting 1000 records...
   ✅ Batch 1/2 inserted successfully
   📦 Batch 2/2: Inserting 245 records...
   ✅ Batch 2/2 inserted successfully
   ✅ Total inserted: 1,245 records

🔍 Validating metrics for 30d window...
   📊 Total records: 1,245

   📈 Statistics:
      Median Omega: 1.85
      P90 Omega: 4.23
      P95 Omega: 5.67
      Max Omega: 12.45
      Avg Hit Rate: 58.34%
      Avg Resolved Bets: 23
      Total PnL: $234,567.89

   ✅ Validation complete for 30d

🏆 Top 10 Performers (30d window):

   Rank | Wallet (last 8) | Omega | Net PnL | Hit Rate | Bets
   ----------------------------------------------------------------------
      1 | 8f44e | 12.45 | $45,234 | 62.5% |   32
      2 | 9a23b |  8.92 | $23,456 | 71.4% |   28
      3 | 7c11d |  7.34 | $18,900 | 65.0% |   20
      ...
```

### Database Records

Each wallet gets one record per time window in `wallet_metrics_complete`:

```sql
SELECT
  wallet_address,
  window,
  metric_2_omega_net,
  metric_9_net_pnl_usd,
  metric_12_hit_rate,
  metric_22_resolved_bets
FROM wallet_metrics_complete
WHERE window = 1  -- 30d
ORDER BY metric_2_omega_net DESC
LIMIT 10;
```

---

## Query Examples

### Top Performers (30-day window)

```sql
SELECT
  wallet_address,
  metric_2_omega_net as omega,
  metric_9_net_pnl_usd as pnl,
  metric_12_hit_rate * 100 as hit_rate_pct,
  metric_22_resolved_bets as bets
FROM wallet_metrics_complete
WHERE window = 1  -- 30d
  AND metric_22_resolved_bets >= 10
ORDER BY metric_2_omega_net DESC
LIMIT 50;
```

### Profitable Wallets (Lifetime)

```sql
SELECT
  wallet_address,
  metric_2_omega_net,
  metric_9_net_pnl_usd,
  metric_15_ev_per_bet_mean
FROM wallet_metrics_complete
WHERE window = 4  -- lifetime
  AND metric_2_omega_net > 1.0
  AND metric_22_resolved_bets >= 20
ORDER BY metric_9_net_pnl_usd DESC;
```

### High Win Rate Traders

```sql
SELECT
  wallet_address,
  metric_12_hit_rate * 100 as hit_rate,
  metric_2_omega_net as omega,
  metric_22_resolved_bets as bets
FROM wallet_metrics_complete
WHERE window = 2  -- 90d
  AND metric_12_hit_rate >= 0.60
  AND metric_22_resolved_bets >= 15
ORDER BY metric_12_hit_rate DESC;
```

### Best EV per Bet

```sql
SELECT
  wallet_address,
  metric_15_ev_per_bet_mean as ev_per_bet,
  metric_2_omega_net as omega,
  metric_22_resolved_bets as bets
FROM wallet_metrics_complete
WHERE window = 3  -- 180d
  AND metric_22_resolved_bets >= 25
ORDER BY metric_15_ev_per_bet_mean DESC
LIMIT 100;
```

---

## Performance

### Execution Time

Expected performance on typical datasets:

| Trades in trades_raw | Wallets | 30d Window | All 4 Windows |
|---------------------|---------|------------|---------------|
| 10,000              | 100     | ~0.5s      | ~2s           |
| 100,000             | 1,000   | ~2.0s      | ~8s           |
| 1,000,000           | 10,000  | ~15s       | ~60s          |

### Optimization

The script uses:
- **Batch inserts** (1,000 records per batch)
- **Efficient ClickHouse aggregations** (sumIf, countIf, avgIf)
- **Materialized views** (pre-aggregated data in `wallet_metrics_30d`)
- **Minimum threshold** (5 trades) to reduce processing

---

## Validation

### Data Quality Checks

The script performs automatic validation:

1. **Row Count**: Verifies records were inserted
2. **Statistics**: Checks median, P90, P95, max Omega values
3. **Hit Rate**: Ensures average hit rate is reasonable (30-70%)
4. **Sample Size**: Validates average resolved bets meets minimum

### Manual Verification

```sql
-- Check for null primary metrics (should be 0)
SELECT count(*)
FROM wallet_metrics_complete
WHERE metric_2_omega_net IS NULL;

-- Check for unrealistic omega values (investigate if >100)
SELECT count(*)
FROM wallet_metrics_complete
WHERE metric_2_omega_net > 100;

-- Verify all windows populated
SELECT window, count(*) as wallets
FROM wallet_metrics_complete
GROUP BY window
ORDER BY window;
```

---

## Troubleshooting

### Error: "No trades found in trades_raw table"

**Cause:** The `trades_raw` table is empty
**Solution:**
```bash
npx tsx scripts/sync-wallet-trades.ts <wallet_address>
```

### Error: "No enriched trades found"

**Cause:** Trades lack `outcome` and `pnl_net` data
**Solution:**
1. Run enrichment script (to be created)
2. Verify migration 002 was applied: `DESCRIBE trades_raw;`

### Error: "Low enrichment rate"

**Cause:** Most trades don't have outcome data (unresolved markets)
**Solution:**
- This is normal for recent trades
- Ensure resolved markets have outcome data
- Focus on older trades that should be resolved

### Error: "Invalid window: xyz"

**Cause:** Invalid time window argument
**Solution:** Use only: `30d`, `90d`, `180d`, `lifetime`

---

## Architecture

### Data Flow

```
trades_raw (enriched)
    ↓
calculate-tier1-metrics.ts
    ↓
wallet_metrics_complete
    ↓
[API endpoints, leaderboards, filters]
```

### SQL Query Pattern

```sql
SELECT
  wallet_address,
  sumIf(pnl_net, pnl_net > 0) / nullIf(sumIf(abs(pnl_net), pnl_net <= 0), 0) as omega_net,
  sum(pnl_net) as net_pnl,
  countIf(pnl_net > 0) / nullIf(count(*), 0) as hit_rate,
  -- ... other metrics
FROM trades_raw
WHERE is_closed = true
  AND outcome IS NOT NULL
  AND {time_window_filter}
GROUP BY wallet_address
HAVING count(*) >= 5
ORDER BY omega_net DESC;
```

### Batch Insert Strategy

1. Query aggregates all metrics in single pass
2. Split results into batches of 1,000 records
3. Insert each batch with progress tracking
4. Use `ReplacingMergeTree` to handle duplicates

---

## Next Steps

### Tier 2 Metrics (Phase 2)

After Tier 1 is complete, calculate:
- Brier score & calibration (metrics 25-29)
- Closing Line Value (metrics 30-32)
- Track record & activity (metrics 23-24)

### Tier 3 Metrics (Phase 3)

Advanced analytics:
- Latency-adjusted metrics (48-55)
- Momentum indicators (56-88)
- Category breakdowns (89-92)

### Integration

Use the calculated metrics in:
- API endpoints: `/api/wallets/top-performers`
- Leaderboards: `/discovery/omega-leaderboard`
- Wallet profiles: `/wallets/[address]`
- Smart Money filters

---

## API Integration Example

```typescript
// app/api/wallets/top-performers/route.ts
import { clickhouse } from '@/lib/clickhouse/client'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const window = searchParams.get('window') || '30d'
  const limit = parseInt(searchParams.get('limit') || '50')

  const query = `
    SELECT
      wallet_address,
      metric_2_omega_net,
      metric_9_net_pnl_usd,
      metric_12_hit_rate,
      metric_22_resolved_bets
    FROM wallet_metrics_complete
    WHERE window = ${windowToEnum(window)}
      AND metric_22_resolved_bets >= 10
    ORDER BY metric_2_omega_net DESC
    LIMIT ${limit}
  `

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow'
  })

  return Response.json(await result.json())
}
```

---

## Maintenance

### Re-calculating Metrics

Run daily or after major data updates:

```bash
# Recalculate all windows
npx tsx scripts/calculate-tier1-metrics.ts

# Only update recent windows
npx tsx scripts/calculate-tier1-metrics.ts 30d 90d
```

### Data Cleanup

```sql
-- Remove old calculations (if schema changed)
ALTER TABLE wallet_metrics_complete DELETE WHERE calculated_at < now() - INTERVAL 7 DAY;

-- Optimize table (ClickHouse)
OPTIMIZE TABLE wallet_metrics_complete FINAL;
```

---

## References

- **Schema:** `migrations/clickhouse/004_create_wallet_metrics_complete.sql`
- **Enrichment:** `migrations/clickhouse/002_add_metric_fields.sql`
- **Trade Sync:** `scripts/sync-wallet-trades.ts`
- **ClickHouse Client:** `lib/clickhouse/client.ts`

---

## Support

For issues or questions:
1. Check data readiness: `npx tsx scripts/verify-clickhouse-data.ts`
2. Verify schema: `DESCRIBE wallet_metrics_complete;`
3. Check logs for specific error messages
4. Review this documentation for common issues
