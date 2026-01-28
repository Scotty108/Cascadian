# FIFO V5 Reference Guide

Complete technical reference for querying TRUE FIFO V5 data with early selling, holding to resolution, and SHORT positions.

---

## Table to Use

### Production Table (Use This)

**`pm_trade_fifo_roi_v3_mat_deduped`**

- ✅ Materialized (physical storage, fast queries)
- ✅ Deduplicated by `tx_hash` (no duplicate rows)
- ✅ Contains TRUE FIFO V5 logic
- ✅ Multiple rows per position (one per buy transaction)
- ✅ Properly indexed

**Use for:** All production queries, dashboards, leaderboards, analytics

### Other Tables (Don't Use)

| Table | Status | Don't Use Because |
|-------|--------|-------------------|
| `pm_trade_fifo_roi_v3` | Source | 286M rows with duplicates, queries timeout |
| `pm_trade_fifo_roi_v3_deduped` | VIEW | On-the-fly GROUP BY, queries timeout, wrong GROUP BY logic |
| `pm_trade_fifo_roi_v2` | Legacy | Old V4 logic, no early selling |
| `pm_trade_fifo_roi_v1` | Legacy | Old V3 logic |

---

## Understanding TRUE FIFO V5 Logic

### Key Concept: One Row Per Buy Transaction

V5 creates **multiple rows per position** because it tracks each buy transaction separately:

```
Position: Wallet 0xabc, Market X, Outcome 0

Row 1:
  tx_hash: 0x111
  entry_time: 2026-01-20 10:00:00
  tokens: 300
  cost_usd: 150 (bought @ $0.50)
  tokens_sold_early: 300 (sold all before resolution)
  tokens_held: 0
  exit_value: 195
  pnl_usd: 45
  roi: 0.30 (30%)

Row 2:
  tx_hash: 0x222
  entry_time: 2026-01-21 14:00:00
  tokens: 700
  cost_usd: 420 (bought @ $0.60)
  tokens_sold_early: 200 (sold some early)
  tokens_held: 500 (held rest to resolution)
  exit_value: 430
  pnl_usd: 10
  roi: 0.024 (2.4%)
```

**Total position PnL:** $45 + $10 = $55

### Field Definitions

| Field | Description |
|-------|-------------|
| `tx_hash` | Buy transaction hash (unique identifier) |
| `wallet` | Trader wallet address |
| `condition_id` | Market/question ID (32-byte hex) |
| `outcome_index` | 0 = YES, 1 = NO (or outcome position in multi-outcome) |
| `entry_time` | When buy transaction occurred |
| `resolved_at` | When market resolved |
| `tokens` | Total tokens bought in this transaction |
| `cost_usd` | Cost to buy these tokens (negative for SHORT) |
| `tokens_sold_early` | Tokens sold BEFORE market resolution |
| `tokens_held` | Tokens held TO resolution (FIFO: first bought, first sold) |
| `exit_value` | Total value realized (early sales + resolution payouts) |
| `pnl_usd` | Profit/Loss for this buy transaction |
| `roi` | Return on investment (pnl_usd / abs(cost_usd)) |
| `pct_sold_early` | Percentage sold before resolution (0-100) |
| `is_maker` | 1 if maker order, 0 if taker |
| `is_short` | 1 if SHORT position, 0 if LONG |

### Early Selling Logic

When a trader **sells tokens before resolution**, FIFO determines which buy transactions are closed:

**Example:**
```
Buy 1: 300 tokens @ $0.50 (entry_time: Jan 20)
Buy 2: 700 tokens @ $0.60 (entry_time: Jan 21)

Total: 1000 tokens

Sell: 500 tokens @ $0.65 (Jan 22)
```

**FIFO Result:**
```
Buy 1: 300 tokens sold, 0 held → PnL = 300 × ($0.65 - $0.50) = $45
Buy 2: 200 tokens sold, 500 held → PnL = 200 × ($0.65 - $0.60) = $10 (so far)
```

When market resolves (outcome wins):
```
Buy 2: 500 tokens resolve @ $1.00 → Additional PnL = 500 × ($1.00 - $0.60) = $200
Buy 2 Final PnL: $10 + $200 = $210
```

### SHORT Positions

SHORT positions have:
- **Negative `cost_usd`** (received USDC for selling)
- **Positive `tokens`** (bought to close SHORT)
- **Inverted PnL logic** (profit when outcome loses)

**Example:**
```
SHORT 100 NO tokens (receive $80)
  cost_usd: -80
  tokens: 100

Market resolves: YES wins, NO loses (payout = 0)
  exit_value: 0
  pnl_usd: 80 (kept the $80 received)
  roi: -1.0 (100% profit on SHORT)
```

---

## Common Query Patterns

### 1. Get All Trades for a Wallet

```sql
SELECT
  tx_hash,
  condition_id,
  outcome_index,
  entry_time,
  tokens,
  cost_usd,
  tokens_sold_early,
  tokens_held,
  pnl_usd,
  roi,
  is_short
FROM pm_trade_fifo_roi_v3_mat_deduped
WHERE wallet = '0x...'
ORDER BY entry_time DESC
```

### 2. Calculate Total PnL for a Position

```sql
SELECT
  wallet,
  condition_id,
  outcome_index,
  count() as num_buy_transactions,
  sum(tokens) as total_tokens_bought,
  sum(cost_usd) as total_cost,
  sum(tokens_sold_early) as total_sold_early,
  sum(tokens_held) as total_held_to_resolution,
  sum(pnl_usd) as total_position_pnl,
  sum(pnl_usd) / sum(abs(cost_usd)) as position_roi
FROM pm_trade_fifo_roi_v3_mat_deduped
WHERE wallet = '0x...'
  AND condition_id = '0x...'
  AND outcome_index = 0
GROUP BY wallet, condition_id, outcome_index
```

### 3. Get Wallet-Level Metrics

```sql
SELECT
  wallet,

  -- Trade counts
  count() as total_buy_transactions,
  uniq(condition_id, outcome_index) as unique_positions,
  uniq(condition_id) as unique_markets,

  -- Win/Loss
  countIf(pnl_usd > 0) as wins,
  countIf(pnl_usd <= 0) as losses,
  round(countIf(pnl_usd > 0) * 100.0 / count(), 1) as win_rate_pct,

  -- ROI stats
  quantile(0.5)(if(pnl_usd > 0, roi, NULL)) * 100 as median_win_roi_pct,
  quantile(0.5)(if(pnl_usd <= 0, roi, NULL)) * 100 as median_loss_roi_pct,
  avg(roi) * 100 as avg_roi_pct,

  -- PnL
  sum(pnl_usd) as total_pnl,
  avg(abs(cost_usd)) as avg_position_size,
  sum(abs(cost_usd)) as total_volume,

  -- Early selling behavior
  avg(pct_sold_early) as avg_pct_sold_early,
  countIf(tokens_sold_early > 0) as positions_sold_early,

  -- SHORT usage
  countIf(is_short = 1) as short_positions,
  round(countIf(is_short = 1) * 100.0 / count(), 1) as short_pct

FROM pm_trade_fifo_roi_v3_mat_deduped
WHERE wallet = '0x...'
GROUP BY wallet
```

### 4. Find Top Performers

```sql
SELECT
  wallet,
  count() as trades,
  uniq(condition_id) as markets,
  countIf(pnl_usd > 0) as wins,
  countIf(pnl_usd <= 0) as losses,
  sum(pnl_usd) as total_pnl,
  quantile(0.5)(roi) * 100 as median_roi_pct
FROM pm_trade_fifo_roi_v3_mat_deduped
WHERE abs(cost_usd) >= 5  -- Minimum $5 position size
GROUP BY wallet
HAVING markets >= 7  -- Diversified traders
  AND wins > losses  -- Winning record
  AND total_pnl > 0  -- Net profitable
ORDER BY total_pnl DESC
LIMIT 100
```

### 5. Analyze a Specific Market

```sql
SELECT
  condition_id,
  outcome_index,
  count() as buy_transactions,
  uniq(wallet) as unique_traders,
  sum(tokens) as total_tokens_bought,
  sum(tokens_sold_early) as total_sold_early,
  sum(tokens_held) as total_held_to_resolution,
  avg(roi) * 100 as avg_roi_pct,
  sum(pnl_usd) as total_pnl,
  countIf(is_short = 1) as short_positions
FROM pm_trade_fifo_roi_v3_mat_deduped
WHERE condition_id = '0x...'
GROUP BY condition_id, outcome_index
```

### 6. Time-Based Analysis

```sql
SELECT
  toStartOfDay(entry_time) as trade_date,
  count() as trades,
  uniq(wallet) as active_traders,
  sum(pnl_usd) as daily_pnl,
  avg(roi) * 100 as avg_roi_pct
FROM pm_trade_fifo_roi_v3_mat_deduped
WHERE entry_time >= now() - INTERVAL 30 DAY
GROUP BY trade_date
ORDER BY trade_date DESC
```

---

## Important Rules

### 1. Never Filter Out Rows from Same Position

**❌ WRONG:**
```sql
-- This loses per-trade detail!
SELECT
  wallet,
  condition_id,
  outcome_index,
  any(pnl_usd) as pnl  -- Only gets ONE row's PnL
FROM pm_trade_fifo_roi_v3_mat_deduped
GROUP BY wallet, condition_id, outcome_index
```

**✅ CORRECT:**
```sql
-- Sum all buy transactions for the position
SELECT
  wallet,
  condition_id,
  outcome_index,
  sum(pnl_usd) as total_pnl  -- Sums ALL buy transactions
FROM pm_trade_fifo_roi_v3_mat_deduped
GROUP BY wallet, condition_id, outcome_index
```

### 2. Count Trades vs Positions Correctly

- **Buy transactions:** `count(*)`
- **Unique positions:** `uniq(wallet, condition_id, outcome_index)`
- **Unique markets:** `uniq(condition_id)`

```sql
SELECT
  wallet,
  count() as total_buy_transactions,
  uniq(condition_id, outcome_index) as unique_positions,
  uniq(condition_id) as unique_markets
FROM pm_trade_fifo_roi_v3_mat_deduped
GROUP BY wallet
```

### 3. Handle Early Selling in Filters

If you want **only positions held to resolution:**
```sql
WHERE tokens_held = tokens  -- All tokens held
```

If you want **only positions sold early:**
```sql
WHERE tokens_sold_early > 0
```

If you want **mixed behavior:**
```sql
WHERE tokens_sold_early > 0 AND tokens_held > 0
```

### 4. Calculate ROI Correctly for Aggregates

**For individual transactions:**
```sql
SELECT roi * 100 as roi_pct
FROM pm_trade_fifo_roi_v3_mat_deduped
```

**For position totals:**
```sql
SELECT
  sum(pnl_usd) / sum(abs(cost_usd)) * 100 as position_roi_pct
FROM pm_trade_fifo_roi_v3_mat_deduped
WHERE wallet = '0x...'
  AND condition_id = '0x...'
  AND outcome_index = 0
```

**For wallet averages (use median, not mean):**
```sql
SELECT
  quantile(0.5)(roi) * 100 as median_roi_pct  -- Better than avg()
FROM pm_trade_fifo_roi_v3_mat_deduped
WHERE wallet = '0x...'
```

---

## Data Quirks & Edge Cases

### Multiple Rows with Same tx_hash

**Shouldn't happen** (deduplication by tx_hash), but if you see it:
```sql
-- Detect duplicates
SELECT tx_hash, count(*) as cnt
FROM pm_trade_fifo_roi_v3_mat_deduped
GROUP BY tx_hash
HAVING cnt > 1
```

If found, report as bug - table needs rebuilding.

### Zero or Negative Tokens

**Normal for:**
- LONG positions sold early: `tokens_sold_early > 0`, `tokens_held = 0`
- SHORT positions that didn't close: Check `is_short = 1`

**Abnormal:**
- `tokens < 0` → Data error
- `tokens_sold_early > tokens` → Data error

### Missing `resolved_at`

**Means:** Market hasn't resolved yet (open position)

**Implications:**
- `tokens_held` exists but no resolution payout yet
- `pnl_usd` only includes early sales, not final resolution
- `roi` is incomplete

**Filter for only resolved positions:**
```sql
WHERE resolved_at IS NOT NULL
```

### HIGH `pct_sold_early` with LOW `roi`

**Normal:** Trader cut losses or took small profits early instead of holding to resolution

**Example:**
```
tokens: 1000
tokens_sold_early: 1000 (100%)
tokens_held: 0
cost_usd: 500
exit_value: 505
pnl_usd: 5
roi: 0.01 (1%)
```

Trader bailed early with 1% profit instead of risking holding to resolution.

---

## Performance Tips

### 1. Use Minimum Position Filters

```sql
WHERE abs(cost_usd) >= 5  -- Skip dust positions
```

### 2. Filter by Time Range

```sql
WHERE entry_time >= now() - INTERVAL 30 DAY
```

### 3. Use Proper ORDER BY

Table is indexed by `(wallet, condition_id, outcome_index, tx_hash)`:

**Fast:**
```sql
WHERE wallet = '0x...'
ORDER BY entry_time DESC
```

**Also fast:**
```sql
WHERE condition_id = '0x...'
ORDER BY entry_time DESC
```

**Slow (full table scan):**
```sql
ORDER BY pnl_usd DESC  -- No index on pnl_usd
LIMIT 100
```

### 4. Use Aggregations Wisely

ClickHouse is fast at aggregations, use them:

```sql
-- Fast
SELECT
  wallet,
  sum(pnl_usd) as total_pnl
FROM pm_trade_fifo_roi_v3_mat_deduped
GROUP BY wallet
HAVING total_pnl > 1000
ORDER BY total_pnl DESC
```

---

## Refreshing the Table

When new FIFO data is added to source table, rebuild:

```bash
npx tsx scripts/create-materialized-deduped.ts
```

**Runtime:** 15-30 minutes
**Frequency:** After bulk FIFO backfills or weekly

---

## Verifying Data Quality

### Check Row Count
```sql
SELECT count() FROM pm_trade_fifo_roi_v3_mat_deduped
```

### Check for Duplicates
```sql
SELECT tx_hash, count(*) as cnt
FROM pm_trade_fifo_roi_v3_mat_deduped
GROUP BY tx_hash
HAVING cnt > 1
```

Should return 0 rows.

### Check Position Distribution
```sql
SELECT
  uniq(wallet) as unique_wallets,
  uniq(condition_id) as unique_markets,
  uniq(wallet, condition_id, outcome_index) as unique_positions,
  count() as total_buy_transactions,
  round(count() / uniq(wallet, condition_id, outcome_index), 2) as avg_buys_per_position
FROM pm_trade_fifo_roi_v3_mat_deduped
```

Expected: `avg_buys_per_position` between 1.5-3.0 (multiple buys per position is normal).

### Check Date Range
```sql
SELECT
  min(entry_time) as earliest_trade,
  max(entry_time) as latest_trade,
  min(resolved_at) as earliest_resolution,
  max(resolved_at) as latest_resolution
FROM pm_trade_fifo_roi_v3_mat_deduped
```

---

## Summary

✅ **Table:** `pm_trade_fifo_roi_v3_mat_deduped`
✅ **Key concept:** One row per buy transaction (multiple rows per position)
✅ **Use `sum(pnl_usd)`** to get position totals
✅ **Early selling:** Check `tokens_sold_early` vs `tokens_held`
✅ **SHORT positions:** Check `is_short = 1`, negative `cost_usd`
✅ **No duplicates:** Deduplicated by `tx_hash`
✅ **Fast queries:** Materialized table, properly indexed

This is the TRUE FIFO V5 system. Use it for all production queries.
