# Leaderboard Development - New Session Context

**Date:** January 28, 2026
**Purpose:** Context for building new leaderboard using FIFO V5 materialized data

---

## Current State

### Production Table: `pm_trade_fifo_roi_v3_mat_unified`

**Status:** Currently being built (adding resolved positions)

**When complete, contains:**
- **272k wallets** (34k from 2-day test + 238k from 10-day NEW)
- **~130M rows** (57M unresolved + ~73M resolved estimated)
- **Both resolved AND unresolved positions**
- **Zero duplicates verified**

**Available NOW for testing:**
- **57.3M rows** (unresolved only for NEW wallets, full history for 2-day wallets)
- **272k wallets**
- Can query immediately for leaderboard prototyping

---

## Test Table: `pm_trade_fifo_roi_v3_mat_unified_2d_test`

**Completed:** ✅ January 27, 2026
**Status:** Production-ready, fully verified

**Contains:**
- **48.9M rows** (43.9M resolved + 5M unresolved)
- **34,385 wallets** (2-day active traders)
- **FULL HISTORY** for these wallets (all-time data, not just 2 days)
- **Zero duplicates verified**

**Use this for:**
- Fast iteration on leaderboard queries
- Testing FIFO V5 logic
- Smaller dataset = faster query times

---

## FIFO V5 Logic Reference

### Table Schema

```sql
CREATE TABLE pm_trade_fifo_roi_v3_mat_unified (
  tx_hash String,                    -- Unique buy transaction ID
  wallet LowCardinality(String),     -- Trader wallet address
  condition_id String,               -- Market condition ID
  outcome_index UInt8,               -- 0 = YES, 1 = NO (usually)
  entry_time DateTime,               -- When position was entered
  resolved_at Nullable(DateTime),    -- When market resolved (NULL = unresolved)
  cost_usd Float64,                  -- Entry cost in USDC
  tokens Float64,                    -- Total tokens bought
  tokens_sold_early Float64,         -- Tokens sold before resolution
  tokens_held Float64,               -- Tokens still held (or held at resolution)
  exit_value Float64,                -- USDC received from early sells
  pnl_usd Float64,                   -- Realized PnL (exit_value - cost_usd for unresolved)
  roi Float64,                       -- Return on investment (pnl_usd / cost_usd)
  pct_sold_early Float64,            -- % of tokens sold before resolution
  is_maker UInt8,                    -- 1 if maker order, 0 if taker
  is_short UInt8,                    -- 1 for SHORT positions, 0 for LONG
  is_closed UInt8                    -- 1 if position fully closed
) ENGINE = MergeTree()
ORDER BY (wallet, condition_id, outcome_index, tx_hash)
```

### Key Concepts

**1. Multiple Rows Per Position**
- Each **buy transaction** = one row
- Single position can have multiple buy transactions
- Group by `(wallet, condition_id, outcome_index)` to aggregate position

**2. Unique Key**
- `(tx_hash, wallet, condition_id, outcome_index)` is unique
- Identifies one wallet's specific buy transaction for a position

**3. Resolved vs Unresolved**
- **Resolved:** `resolved_at IS NOT NULL` - market has settled
- **Unresolved:** `resolved_at IS NULL` - market still active
- Both types can be `is_closed = 1` (sold all tokens)

**4. Position States**

| State | resolved_at | is_closed | Meaning |
|-------|-------------|-----------|---------|
| Open unresolved | NULL | 0 | Still holding tokens, market active |
| Closed unresolved | NULL | 1 | Sold all tokens, market still active |
| Resolved held to end | NOT NULL | 1 | Held to resolution |
| Resolved partial sell | NOT NULL | 0 | Should be 1 (edge case) |

**5. PnL Calculation**

**For RESOLVED positions:**
```sql
-- Final PnL = exit_value (early sells) + resolution proceeds - cost
-- resolution proceeds = tokens_held × payout (from resolution)
pnl_usd = exit_value + (tokens_held * resolution_payout) - cost_usd
```

**For UNRESOLVED positions:**
```sql
-- Current PnL = early sells - cost (unrealized gain on held tokens not counted)
pnl_usd = exit_value - cost_usd
```

**6. SHORT Positions**
- `is_short = 1` means net negative tokens (sold more than bought)
- `tx_hash` format: `'short_' + wallet_prefix + '_' + condition_prefix + '_' + outcome`
- `cost_usd` = negative cash flow (profit from shorting)
- `tokens` = absolute value of net short position
- `roi` = typically -1.0 (full loss on short)

---

## Example Queries

### 1. Closed Position Stats (Leaderboard Ready)

```sql
SELECT
  wallet,
  uniq(condition_id) as unique_markets,
  count() as total_trades,
  countIf(pnl_usd > 0) / count() * 100 as win_rate_pct,
  sum(pnl_usd) as total_pnl,
  avg(roi * 100) as avg_roi_pct
FROM pm_trade_fifo_roi_v3_mat_unified
WHERE is_closed = 1
  AND abs(cost_usd) >= 5  -- Min $5 position size
GROUP BY wallet
HAVING unique_markets >= 7  -- Min diversity
ORDER BY avg_roi_pct DESC
LIMIT 100
```

### 2. Active Positions (Current Holdings)

```sql
SELECT
  wallet,
  condition_id,
  sum(tokens_held) as total_tokens,
  sum(cost_usd) as total_invested,
  sum(exit_value) as current_realized,
  sum(pnl_usd) as unrealized_pnl
FROM pm_trade_fifo_roi_v3_mat_unified
WHERE resolved_at IS NULL
  AND is_closed = 0
  AND tokens_held > 0.01
GROUP BY wallet, condition_id
ORDER BY total_invested DESC
```

### 3. Aggregate Position-Level Metrics

```sql
WITH position_aggregates AS (
  SELECT
    wallet,
    condition_id,
    outcome_index,
    sum(cost_usd) as position_cost,
    sum(tokens) as position_tokens,
    sum(exit_value) as position_exit,
    sum(pnl_usd) as position_pnl,
    max(resolved_at) as resolved_at,
    max(is_closed) as is_closed
  FROM pm_trade_fifo_roi_v3_mat_unified
  GROUP BY wallet, condition_id, outcome_index
)
SELECT
  wallet,
  count() as num_positions,
  countIf(resolved_at IS NOT NULL) as resolved_positions,
  countIf(position_pnl > 0) as winning_positions,
  sum(position_pnl) as total_pnl
FROM position_aggregates
GROUP BY wallet
ORDER BY total_pnl DESC
LIMIT 100
```

### 4. Time-Filtered Entry

```sql
-- Only positions ENTERED in last N days (not just resolved)
SELECT
  wallet,
  count() as recent_trades,
  sum(pnl_usd) as pnl
FROM pm_trade_fifo_roi_v3_mat_unified
WHERE entry_time >= now() - INTERVAL 7 DAY
  AND is_closed = 1
GROUP BY wallet
```

---

## Important Filters

### For Leaderboard Quality

```sql
WHERE is_closed = 1                    -- Only closed positions
  AND abs(cost_usd) >= 5               -- Min $5 position size
  AND entry_time >= now() - INTERVAL 2 DAY  -- Recent activity
```

### Edge Cases to Handle

1. **Self-fills:** Already filtered (excluded from materialization)
2. **Dust positions:** Filter with `cost_usd >= 0.01` minimum
3. **SHORT positions:** Can include or exclude with `is_short = 0`
4. **Negative PnL:** Can indicate sizing disaster (see copytrade analysis)

---

## Performance Tips

1. **Always filter by entry_time or resolved_at first** (indexed)
2. **Use HAVING for post-aggregation filters** (unique_markets, etc.)
3. **For 2-day test table:** No indexes needed, scans are fast
4. **For full table (130M rows):** Always use date filters

---

## Copytrade Analysis Reference

**Previous analysis** (`/Users/scotty/Projects/Cascadian-app/copytrade-30day-analysis.csv`):
- Top 5 wallets: $4,673.75 profit in 30 days with $1 per trade
- Best wallet: 0x914a7020... ($1,506 profit, 299 trades, 504% avg ROI)
- Filters used: 10-1000 trades/30 days (realistic volumes)

**CSV columns:** wallet, total_trades, copytrade_pnl, avg_roi_pct, win_rate_pct, last_trade

---

## Testing Workflow

### 1. Start with 2-day test table
```sql
-- Fast iteration
FROM pm_trade_fifo_roi_v3_mat_unified_2d_test
WHERE is_closed = 1
```

### 2. Verify on full table
```sql
-- Production query
FROM pm_trade_fifo_roi_v3_mat_unified
WHERE is_closed = 1
  AND entry_time >= now() - INTERVAL 2 DAY
```

### 3. Export results
```typescript
// Example from hyperdiversified-2day.ts
const csvPath = '/Users/scotty/Projects/Cascadian-app/leaderboard-results.csv';
writeFileSync(csvPath, csvHeader + csvRows.join('\n'));
```

---

## Related Files

**Scripts:**
- `/Users/scotty/Projects/Cascadian-app/scripts/analysis/hyperdiversified-2day.ts` - Existing leaderboard query
- `/Users/scotty/Projects/Cascadian-app/scripts/analysis/copytrade-30day.ts` - Copytrade analysis

**CSV Outputs:**
- `/Users/scotty/Projects/Cascadian-app/hyper-diversified-2day-traders.csv` - Current leaderboard (709 wallets)
- `/Users/scotty/Projects/Cascadian-app/copytrade-30day-analysis.csv` - Copytrade analysis (100 wallets)

**Documentation:**
- `/Users/scotty/Projects/Cascadian-app/docs/READ_ME_FIRST_PNL.md` - PnL engine docs
- `/Users/scotty/Projects/Cascadian-app/docs/systems/database/TABLE_RELATIONSHIPS.md` - Database schema

---

## Next Steps

1. Define leaderboard criteria (win rate, ROI, diversity, volume, etc.)
2. Write query against 2-day test table
3. Test and iterate
4. Run on full production table when ready
5. Export CSV or build API endpoint

---

## Questions to Consider

- **Ranking:** Edge per trade? Win rate? Total PnL? Compounding score?
- **Filters:** Min trades? Min markets? Time window? Position size?
- **Exclusions:** SHORT positions? Self-fills already excluded?
- **Grouping:** Per-wallet or per-position metrics?
- **Edge formula:** W × R_w - (1-W) × R_l (as in hyperdiversified query)?

---

**Current Status:** INNER JOIN adding resolved positions is running (started 6:58 PM, ETA ~10-15 min)

**Ready NOW:** 2-day test table with 48.9M rows, 34k wallets, full history ✅
