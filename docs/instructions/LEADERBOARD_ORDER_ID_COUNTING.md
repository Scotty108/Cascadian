# Leaderboard Trade Counting: Using order_id for Accurate Metrics

**Purpose:** Instructions for implementing accurate trade counting in leaderboard queries using the `order_id` column instead of row counts.

---

## The Problem: Trade Count Inflation

### Data Hierarchy
```
Fill (smallest) < Trade (tx_hash) < Order (order_id) < Position (condition_id)
```

A single **trading decision** (order) can result in multiple database rows:
- A maker limit order filled by 5 takers = 5 rows in FIFO table
- Each row has the same `order_id` but different `tx_hash`

### Example of Inflation
```sql
-- WRONG: Counts fills, not orders (inflated 25-75%)
SELECT wallet, count(*) as trade_count
FROM pm_trade_fifo_roi_v3
WHERE is_short = 0
GROUP BY wallet

-- Wallet 0xf541... shows 409,374 "trades"
-- But they only made 157,452 actual orders (61.5% inflation)
```

---

## The Solution: Use order_id

### Correct Trade Counting
```sql
-- CORRECT: Counts unique orders
SELECT wallet, countDistinct(order_id) as trade_count
FROM pm_trade_fifo_roi_v3
WHERE is_short = 0
  AND order_id != ''  -- Exclude rows without order_id (~3%)
GROUP BY wallet
```

### When order_id is Empty
About 3-5% of rows have empty `order_id`:
- AMM fills (source != 'clob')
- Very old fills before order_id tracking
- Edge cases in fill_id parsing

For these, fall back to counting distinct `tx_hash`:
```sql
SELECT wallet,
  countDistinct(order_id) + countDistinctIf(tx_hash, order_id = '') as trade_count
FROM pm_trade_fifo_roi_v3
WHERE is_short = 0
GROUP BY wallet
```

---

## FIFO V5 Integration

### Column Schema
The `order_id` column exists in both FIFO tables:
- `pm_trade_fifo_roi_v3` - Primary FIFO table
- `pm_trade_fifo_roi_v3_mat_unified` - Unified materialized table

```sql
DESCRIBE pm_trade_fifo_roi_v3
-- order_id: String (2nd column after tx_hash)
```

### Order ID Extraction Logic
The `order_id` is extracted from `fill_id` in `pm_canonical_fills_v4`:
```
fill_id format: clob_{tx_hash}_{order_id}-{m/t}
                                 ^^^^^^^^
                                 Extract this

Example: clob_0xabc123_0x456def-m
         order_id = 0x456def
```

Extraction SQL:
```sql
splitByChar('-', arrayElement(splitByChar('_', fill_id), 3))[1] as order_id
```

---

## Leaderboard Query Patterns

### Pattern 1: Basic Trade Count
```sql
SELECT
  wallet,
  countDistinct(order_id) as trades,
  sum(pnl_usd) as total_pnl,
  sum(cost_usd) as total_cost
FROM pm_trade_fifo_roi_v3
WHERE is_short = 0
  AND cost_usd > 0
  AND (resolved_at IS NOT NULL OR is_closed = 1)
GROUP BY wallet
HAVING trades >= 25
```

### Pattern 2: With Fallback for Empty order_id
```sql
SELECT
  wallet,
  -- Primary: count distinct order_ids
  -- Fallback: count distinct tx_hash for rows without order_id
  countDistinct(order_id) + countDistinctIf(tx_hash, order_id = '') as trades,
  sum(pnl_usd) as total_pnl
FROM pm_trade_fifo_roi_v3
WHERE is_short = 0
  AND cost_usd > 0
  AND (resolved_at IS NOT NULL OR is_closed = 1)
GROUP BY wallet
HAVING trades >= 25
```

### Pattern 3: Win Rate with Order-Level Aggregation
```sql
WITH order_outcomes AS (
  SELECT
    wallet,
    order_id,
    -- Aggregate fills to order level first
    sum(pnl_usd) as order_pnl,
    sum(cost_usd) as order_cost
  FROM pm_trade_fifo_roi_v3
  WHERE is_short = 0
    AND order_id != ''
    AND cost_usd > 0
    AND (resolved_at IS NOT NULL OR is_closed = 1)
  GROUP BY wallet, order_id
)
SELECT
  wallet,
  count() as trades,
  countIf(order_pnl > 0) as wins,
  round(countIf(order_pnl > 0) * 100.0 / count(), 1) as win_rate,
  sum(order_pnl) as total_pnl
FROM order_outcomes
GROUP BY wallet
HAVING trades >= 25
ORDER BY total_pnl DESC
```

### Pattern 4: Median Bet Size (Order Level)
```sql
WITH order_costs AS (
  SELECT
    wallet,
    order_id,
    sum(cost_usd) as order_cost
  FROM pm_trade_fifo_roi_v3
  WHERE is_short = 0
    AND order_id != ''
    AND cost_usd > 0
  GROUP BY wallet, order_id
)
SELECT
  wallet,
  count() as trades,
  median(order_cost) as median_bet
FROM order_costs
GROUP BY wallet
HAVING median_bet >= 10  -- $10 minimum median bet
```

---

## Critical Rules

### DO
- Use `countDistinct(order_id)` for trade counts
- Aggregate to order level BEFORE calculating metrics like win rate
- Include fallback for empty order_id when completeness matters
- Filter `is_short = 0` to exclude artifact positions

### DON'T
- Use `count(*)` or `count()` for trade counts (inflated)
- Calculate win rate on fill level (a single order split across fills could show as multiple wins/losses)
- Ignore empty order_id without understanding the impact (~3-5% of rows)

---

## Coverage Status (Feb 2026)

| Period | order_id Coverage |
|--------|-------------------|
| Feb 2026 | 95.9% |
| Jan 2026 | 94.7% |
| Dec 2025 | 97.2% |
| Nov 2025 | 96.9% |
| Oct 2025 | 95.4% |
| Earlier | 96-100% |

The ~3-5% without order_id are primarily AMM fills which don't have CLOB order IDs.

---

## Example: Leaderboard V26 Query Structure

```sql
-- Step 1: Aggregate to order level
WITH wallet_orders AS (
  SELECT
    wallet,
    order_id,
    condition_id,
    sum(cost_usd) as order_cost,
    sum(pnl_usd) as order_pnl,
    sum(pnl_usd) / nullIf(sum(cost_usd), 0) as order_roi
  FROM pm_trade_fifo_roi_v3
  WHERE is_short = 0
    AND order_id != ''
    AND cost_usd > 0
    AND (resolved_at IS NOT NULL OR is_closed = 1)
  GROUP BY wallet, order_id, condition_id
),

-- Step 2: Calculate wallet-level metrics
wallet_metrics AS (
  SELECT
    wallet,
    count() as trades,
    countDistinct(condition_id) as markets,
    sum(order_cost) as total_cost,
    sum(order_pnl) as total_pnl,
    countIf(order_pnl > 0) as wins,
    round(countIf(order_pnl > 0) * 100.0 / count(), 1) as win_rate,
    median(order_cost) as median_bet
  FROM wallet_orders
  GROUP BY wallet
)

-- Step 3: Apply filters
SELECT *
FROM wallet_metrics
WHERE trades >= 25
  AND markets >= 10
  AND median_bet >= 10
  AND win_rate >= 50
ORDER BY total_pnl DESC
LIMIT 100
```

---

## Summary

| Metric | Wrong Approach | Correct Approach |
|--------|----------------|------------------|
| Trade count | `count(*)` | `countDistinct(order_id)` |
| Win rate | Count winning rows / total rows | Count winning orders / total orders |
| Median bet | `median(cost_usd)` per row | `median(sum(cost_usd))` per order |
| Markets | May over-count | Aggregate to order first, then count markets |

**Key principle:** Always aggregate fills to the order level first, then calculate metrics on the aggregated data.
