# FIFO V5 Leaderboard Query Guide

**Purpose:** Reference guide for querying `pm_trade_fifo_roi_v3_mat_unified` table for leaderboards, understanding closed positions and unresolved market tracking.

**Last Updated:** January 29, 2026

---

## Critical Concepts

### 1. Two Independent Dimensions

**Market Status** (whether outcome is determined):
- `resolved_at IS NULL` → Market still open (outcome unknown)
- `resolved_at IS NOT NULL` → Market resolved (outcome determined)

**Position Status** (whether trader still holds tokens):
- `is_closed = 0` → Position open (trader holds tokens)
- `is_closed = 1` → Position closed (trader sold all tokens)

### 2. The Four States

| Market Status | Position Status | Example | PnL Status |
|---------------|----------------|---------|------------|
| Unresolved (`resolved_at IS NULL`) | Open (`is_closed = 0`) | Bought 100 shares, still holding | **Unrealized** (no PnL yet) |
| Unresolved (`resolved_at IS NULL`) | Closed (`is_closed = 1`) | Bought 100, sold 100 (scalped) | **Realized** (trading profit captured) |
| Resolved (`resolved_at IS NOT NULL`) | Open (`is_closed = 0`) | Held to resolution, collected payout | **Realized** (resolution payout) |
| Resolved (`resolved_at IS NOT NULL`) | Closed (`is_closed = 1`) | Sold early, then market resolved | **Realized** (trading profit only) |

**Key Insight:** You can have realized PnL on unresolved markets! This captures scalpers and day traders.

---

## Table Schema: `pm_trade_fifo_roi_v3_mat_unified`

### Key Columns for Leaderboards

```sql
tx_hash           String              -- Unique transaction identifier
wallet            LowCardinality      -- Trader wallet address
condition_id      String              -- Market identifier
outcome_index     UInt8               -- Which outcome (0 or 1)
entry_time        DateTime            -- When position opened
resolved_at       Nullable(DateTime)  -- When market resolved (NULL = unresolved)

-- Position metrics
tokens            Float64             -- Total tokens bought
cost_usd          Float64             -- Total cost in USD
tokens_sold_early Float64             -- Tokens sold before resolution
tokens_held       Float64             -- Tokens still held (tokens - tokens_sold_early)

-- PnL metrics
exit_value        Float64             -- Revenue from early sales
pnl_usd           Float64             -- Total profit/loss
roi               Float64             -- Return on investment (pnl_usd / cost_usd)

-- Flags
is_maker          UInt8               -- 1 if maker order
is_closed         UInt8               -- 1 if position fully closed (tokens_held <= 0.01)
is_short          UInt8               -- 1 if SHORT position (net negative tokens)
```

---

## Critical: Deduplication Required

The table uses `SharedMergeTree` (not `ReplacingMergeTree`), so **ALWAYS deduplicate when querying**:

```sql
WITH deduped AS (
  SELECT
    tx_hash, wallet, condition_id, outcome_index,
    any(entry_time) as entry_time,
    any(resolved_at) as resolved_at,
    any(cost_usd) as cost_usd,
    any(pnl_usd) as pnl_usd,
    any(roi) as roi,
    any(is_closed) as is_closed,
    any(is_short) as is_short
  FROM pm_trade_fifo_roi_v3_mat_unified
  WHERE <your filters>
  GROUP BY tx_hash, wallet, condition_id, outcome_index
)
SELECT * FROM deduped
```

**Why:** Architectural duplicates exist for multi-outcome positions (same tx_hash, different outcome_index).

---

## Common Leaderboard Queries

### 1. All Realized PnL (Includes Scalpers)

**What it finds:** All positions with realized profits/losses, including:
- Closed positions on unresolved markets (scalpers, day traders)
- Positions held to resolution
- Early exits before resolution

```sql
WITH deduped AS (
  SELECT
    tx_hash, wallet, condition_id, outcome_index,
    any(entry_time) as trade_entry_time,
    any(resolved_at) as trade_resolved_at,
    any(cost_usd) as trade_cost_usd,
    any(pnl_usd) as trade_pnl_usd,
    any(roi) as trade_roi,
    any(is_closed) as trade_is_closed
  FROM pm_trade_fifo_roi_v3_mat_unified
  WHERE
    entry_time >= now() - INTERVAL 30 DAY
    AND cost_usd > 0
    -- Include BOTH:
    AND (
      resolved_at IS NOT NULL        -- Market resolved (any position)
      OR is_closed = 1               -- OR position closed on unresolved market
    )
  GROUP BY tx_hash, wallet, condition_id, outcome_index
)
SELECT
  wallet,
  count() as total_trades,
  sum(trade_pnl_usd) as total_pnl,
  avg(trade_roi) as avg_roi,
  countIf(trade_roi > 0) * 1.0 / count() as win_rate
FROM deduped
GROUP BY wallet
HAVING total_trades >= 10
ORDER BY total_pnl DESC
LIMIT 100
```

**Key Filter:**
```sql
AND (resolved_at IS NOT NULL OR is_closed = 1)
```
This captures ALL realized PnL: market resolutions + closed positions on unresolved markets.

---

### 2. Only Scalpers/Day Traders (Closed Before Resolution)

**What it finds:** Traders who close positions without waiting for resolution

```sql
WITH deduped AS (
  SELECT
    tx_hash, wallet, condition_id, outcome_index,
    any(entry_time) as trade_entry_time,
    any(cost_usd) as trade_cost_usd,
    any(pnl_usd) as trade_pnl_usd,
    any(roi) as trade_roi
  FROM pm_trade_fifo_roi_v3_mat_unified
  WHERE
    entry_time >= now() - INTERVAL 7 DAY
    AND is_closed = 1                -- Position fully closed
    AND resolved_at IS NULL          -- Market STILL unresolved
    AND cost_usd >= 10
  GROUP BY tx_hash, wallet, condition_id, outcome_index
)
SELECT
  wallet,
  count() as scalp_trades,
  sum(trade_pnl_usd) as scalp_pnl,
  avg(trade_roi) as avg_scalp_roi,
  median(trade_roi) as median_scalp_roi
FROM deduped
GROUP BY wallet
HAVING scalp_trades >= 5
ORDER BY scalp_pnl DESC
LIMIT 50
```

**Key Filter:**
```sql
is_closed = 1 AND resolved_at IS NULL
```
Positions closed while market still open = pure trading skill.

---

### 3. Ultra-Active Traders (Recent Window)

**What it finds:** High-volume traders in a short time window

```sql
WITH deduped AS (
  SELECT
    tx_hash, wallet, condition_id, outcome_index,
    any(entry_time) as trade_entry_time,
    any(resolved_at) as trade_resolved_at,
    any(cost_usd) as trade_cost_usd,
    any(pnl_usd) as trade_pnl_usd,
    any(roi) as trade_roi,
    any(is_closed) as trade_is_closed
  FROM pm_trade_fifo_roi_v3_mat_unified
  WHERE
    entry_time >= now() - INTERVAL 3 DAY
    AND entry_time <= now()
    AND cost_usd >= 10
    AND (resolved_at IS NOT NULL OR is_closed = 1)  -- Only realized PnL
  GROUP BY tx_hash, wallet, condition_id, outcome_index
)
SELECT
  wallet,
  count() as total_trades,
  uniqExact(condition_id) as markets_traded,
  sum(trade_pnl_usd) as total_pnl,
  countIf(trade_roi > 0) * 1.0 / count() as win_rate,
  medianExact(trade_roi) as median_roi,
  toUInt64(max(trade_entry_time)) as last_trade_ts
FROM deduped
GROUP BY wallet
HAVING
  total_trades >= 30
  AND markets_traded >= 8
  AND win_rate >= 0.70
  AND median_roi >= 0.30
  AND total_pnl >= 10000
  AND last_trade_ts >= toUInt64(now() - INTERVAL 3 DAY)
ORDER BY total_trades DESC
LIMIT 100
```

---

### 4. Copy Trading Leaderboard (Robust ROI)

**What it finds:** Traders with consistent returns (excluding top 3 lucky trades)

```sql
WITH deduped AS (
  SELECT
    tx_hash, wallet, condition_id, outcome_index,
    any(entry_time) as trade_entry_time,
    any(cost_usd) as trade_cost_usd,
    any(roi) as trade_roi
  FROM pm_trade_fifo_roi_v3_mat_unified
  WHERE
    entry_time >= now() - INTERVAL 30 DAY
    AND cost_usd >= 10
    AND (resolved_at IS NOT NULL OR is_closed = 1)
  GROUP BY tx_hash, wallet, condition_id, outcome_index
)
SELECT
  wallet,
  count() as total_trades,
  countIf(trade_roi > 0) * 1.0 / count() as win_rate,
  -- Exclude top 3 trades (removes lottery winners)
  arrayElement(
    arraySort(x -> -x, groupArray(trade_roi)),
    4
  ) as fourth_best_roi,
  avg(trade_roi) as avg_roi_all,
  avgIf(trade_roi, trade_roi < fourth_best_roi) as avg_roi_without_top3
FROM deduped
GROUP BY wallet
HAVING
  total_trades >= 25
  AND win_rate >= 0.40
  AND avg_roi_without_top3 > 0  -- Positive even without best trades
ORDER BY avg_roi_without_top3 DESC
LIMIT 20
```

**Key Metric:** `avg_roi_without_top3` filters out wallets with 1-2 lucky trades.

---

## PnL Calculation Logic (FIFO V5)

### LONG Positions

```
PnL = exit_value - cost_usd + (tokens_held * resolution_payout)

Where:
  exit_value = Revenue from selling tokens early
  cost_usd = Total cost of buying tokens
  tokens_held = Tokens still held at resolution (or 0 if closed)
  resolution_payout = $1 if outcome won, $0 if lost
```

**Examples:**

1. **Scalper (Closed, Unresolved):**
   - Buy 100 @ $0.60 = $60 cost
   - Sell 100 @ $0.75 = $75 exit_value
   - PnL = $75 - $60 = **$15 profit**
   - `is_closed = 1`, `resolved_at IS NULL`

2. **Hold to Resolution (Open, Resolved):**
   - Buy 100 @ $0.60 = $60 cost
   - Hold to resolution (outcome wins)
   - PnL = $0 - $60 + (100 * $1) = **$40 profit**
   - `is_closed = 0`, `resolved_at IS NOT NULL`

3. **Partial Exit (Closed, Resolved):**
   - Buy 100 @ $0.60 = $60 cost
   - Sell 50 @ $0.75 = $37.50 exit_value
   - Hold 50 to resolution (outcome wins)
   - PnL = $37.50 - $60 + (50 * $1) = **$27.50 profit**
   - `is_closed = 0` (still holding 50), `resolved_at IS NOT NULL`

### SHORT Positions

```
PnL = cash_flow - (abs(net_tokens) * resolution_payout)

Where:
  cash_flow = Net USDC received from selling tokens
  net_tokens = Negative (trader owes tokens)
  resolution_payout = $1 if outcome won, $0 if lost
```

**Example:**
- Sell 100 (don't own) @ $0.60 = $60 cash_flow
- Outcome wins (trader liable for $100)
- PnL = $60 - (100 * $1) = **-$40 loss**

---

## Time Windows

### Entry Time vs Resolution Time

**For recent activity, filter by `entry_time`:**
```sql
WHERE entry_time >= now() - INTERVAL 7 DAY
```
This finds trades opened in the last 7 days (regardless of when market resolved).

**For resolved markets, filter by `resolved_at`:**
```sql
WHERE resolved_at >= now() - INTERVAL 7 DAY
  AND resolved_at IS NOT NULL
```
This finds markets that resolved in the last 7 days.

**For active traders (last trade), use MAX:**
```sql
HAVING toUInt64(max(trade_entry_time)) >= toUInt64(now() - INTERVAL 3 DAY)
```

---

## Common Filters

### Minimum Bet Size
```sql
WHERE cost_usd >= 10  -- Exclude dust trades
```

### Exclude Zero-Address
```sql
WHERE wallet != '0x0000000000000000000000000000000000000000'
```

### Only Realized PnL
```sql
WHERE (resolved_at IS NOT NULL OR is_closed = 1)
```

### Only LONG Positions
```sql
WHERE is_short = 0
```

### Only SHORT Positions
```sql
WHERE is_short = 1
```

### Active in Time Window
```sql
WHERE entry_time >= now() - INTERVAL 30 DAY
  AND entry_time <= now()
```

---

## Performance Tips

### 1. Always Deduplicate
Use the `WITH deduped AS (GROUP BY ...)` pattern shown above.

### 2. Filter Early
Put filters in the deduped CTE, not after:
```sql
-- GOOD (filter in CTE)
WITH deduped AS (
  SELECT ...
  FROM pm_trade_fifo_roi_v3_mat_unified
  WHERE entry_time >= now() - INTERVAL 7 DAY  -- Filter here
  GROUP BY ...
)

-- BAD (filter after dedup)
WITH deduped AS (
  SELECT ...
  FROM pm_trade_fifo_roi_v3_mat_unified
  GROUP BY ...
)
SELECT * FROM deduped
WHERE entry_time >= now() - INTERVAL 7 DAY  -- Slower
```

### 3. Use Sampling for Exploration
```sql
FROM pm_trade_fifo_roi_v3_mat_unified SAMPLE 0.1  -- 10% sample
```

### 4. Limit Result Sets
Always use `LIMIT` to prevent massive result sets.

---

## Staleness Monitoring

Check how fresh the data is:

```sql
SELECT
  max(CASE WHEN resolved_at IS NULL THEN entry_time END) as newest_unresolved_entry,
  date_diff('minute', max(CASE WHEN resolved_at IS NULL THEN entry_time END), now()) as minutes_stale_unresolved,
  max(resolved_at) as newest_resolved_at,
  date_diff('minute', max(resolved_at), now()) as minutes_stale_resolved
FROM pm_trade_fifo_roi_v3_mat_unified
```

**Freshness Targets:**
- Unresolved: <60 minutes stale (refreshed hourly via cron)
- Resolved: <24 hours stale (refreshed daily at 5am UTC)

---

## Table Statistics

Current state (Jan 29, 2026):
- **Total rows:** 588M (575M resolved + 13M unresolved)
- **Unique wallets:** 1.93M
- **Compressed size:** 20.36 GiB
- **Uncompressed size:** 99.09 GiB
- **Coverage:** All CLOB trades since Nov 21, 2022

---

## Common Mistakes

### ❌ Forgetting Deduplication
```sql
-- WRONG: Will double-count multi-outcome positions
SELECT sum(pnl_usd) FROM pm_trade_fifo_roi_v3_mat_unified
```

### ✅ Correct Deduplication
```sql
SELECT sum(any(pnl_usd))
FROM pm_trade_fifo_roi_v3_mat_unified
GROUP BY tx_hash, wallet, condition_id, outcome_index
```

---

### ❌ Missing Scalpers
```sql
-- WRONG: Only counts market resolutions
WHERE resolved_at IS NOT NULL
```

### ✅ Include All Realized PnL
```sql
-- CORRECT: Includes closed positions on unresolved markets
WHERE (resolved_at IS NOT NULL OR is_closed = 1)
```

---

### ❌ Mixing Entry and Resolution Time
```sql
-- WRONG: "Last 7 days" unclear meaning
WHERE entry_time >= now() - INTERVAL 7 DAY
  AND resolved_at >= now() - INTERVAL 7 DAY
```

### ✅ Be Explicit
```sql
-- CORRECT: Trades opened in last 7 days, resolved anytime
WHERE entry_time >= now() - INTERVAL 7 DAY
  AND (resolved_at IS NOT NULL OR is_closed = 1)
```

---

## Related Documentation

- `docs/FIFO_V5_REFERENCE.md` - Full FIFO V5 technical reference
- `docs/FIFO_V5_UNRESOLVED_MARKETS_PLAN.md` - Unresolved markets strategy
- `UNIFIED_TABLE_MAINTENANCE.md` - Operational procedures
- `scripts/refresh-unified-complete.ts` - Refresh system

---

## Quick Reference: The Magic Filter

**For most leaderboards, use this:**
```sql
WHERE entry_time >= now() - INTERVAL {your_window} DAY
  AND cost_usd >= 10
  AND (resolved_at IS NOT NULL OR is_closed = 1)
GROUP BY tx_hash, wallet, condition_id, outcome_index
```

This captures:
- ✅ Scalpers who close before resolution
- ✅ Holders who wait for resolution
- ✅ Partial exits (sell some, hold some)
- ✅ SHORT positions
- ✅ Proper deduplication

**You're now ready to build comprehensive leaderboards that include all trading activity!**
