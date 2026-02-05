---
name: fifo-logic
description: Complete reference for FIFO v3 trading logic, position lifecycle, deduplication, resolution mapping, and cron pipeline. Auto-use when working on FIFO calculations, trade counting, position tracking, order_id vs fill_id, buy/sell logic, resolved/unresolved positions, or any pm_trade_fifo_roi_v3 work.
---

# FIFO Trading Logic Reference

Complete institutional knowledge for the Cascadian FIFO position tracking system.

---

## Core Concept: Fills Are NOT Trades

A single trading decision (one order) can generate **multiple fills** when matched against multiple counterparties. The hierarchy:

```
Order (1 trading decision by 1 wallet)
  -> Fill 1 (matched against counterparty A)
  -> Fill 2 (matched against counterparty B)
  -> Fill 3 (matched against counterparty C)
```

### fill_id Format
```
clob_{tx_hash}_{order_id}-{m|t}
```
- `tx_hash`: Blockchain transaction hash
- `order_id`: The user's order (1 order = 1 trade decision)
- `m`: Maker side (limit order that was resting)
- `t`: Taker side (market order that crossed the book)

### Extracting order_id in SQL
```sql
splitByChar('-', arrayElement(splitByChar('_', fill_id), 3))[1] as order_id
```

### Why This Matters
- Counting fills = inflated trade count (3x or more)
- Counting order_ids = accurate trade count
- FIFO groups by `(tx_hash, wallet, condition_id, outcome_index)` for position entries

---

## Table: pm_trade_fifo_roi_v3

### Schema
```sql
CREATE TABLE pm_trade_fifo_roi_v3 (
  tx_hash         String,           -- Transaction hash (sort key component)
  order_id        String,           -- Extracted order_id for trade counting
  wallet          LowCardinality(String),  -- Trader wallet address
  condition_id    String,           -- Market condition (64-char hex)
  outcome_index   UInt8,            -- 0 or 1 (binary outcome)
  entry_time      DateTime,         -- First fill time for this position
  tokens          Float64,          -- Total tokens acquired
  cost_usd        Float64,          -- Total USD spent (always positive)
  tokens_sold_early Float64,        -- Tokens sold before resolution
  tokens_held     Float64,          -- Tokens held at resolution
  exit_value      Float64,          -- Total exit proceeds (sells + resolution payout)
  pnl_usd         Float64,          -- exit_value - cost_usd
  roi             Float64,          -- pnl_usd / cost_usd
  pct_sold_early  Float64,          -- Percentage of tokens sold before resolution
  is_maker        UInt8,            -- Was this a maker order
  resolved_at     DateTime,         -- When the market condition resolved
  is_short        UInt8,            -- 1 = short position (net negative tokens)
  is_closed       UInt8             -- Always 1 (only resolved conditions enter this table)
) ENGINE = SharedReplacingMergeTree
ORDER BY (wallet, condition_id, outcome_index, tx_hash)
```

### Key Facts
- **290.5M rows**, 1.95M wallets, 301K+ conditions (Feb 2026)
- **SharedReplacingMergeTree** - deduplicates on sort key during merges
- **No version column** - last inserted row wins on merge
- **Only resolved conditions** are in this table (see Position Lifecycle below)
- `is_closed` is always 1 by design (INNER JOIN to resolutions in cron)

---

## Position Lifecycle & States

### The Three Position States

**"Closed" and "resolved" are NOT the same thing.** A position has two independent axes:

| | Market Unresolved | Market Resolved |
|--|-------------------|-----------------|
| **Holding tokens** | OPEN position | RESOLVED position (payout pending/applied) |
| **All tokens sold** | CLOSED in unresolved market | CLOSED + RESOLVED |

This creates three meaningful states:

1. **Open** - Holding tokens, market hasn't resolved yet
   - `tokens_held > 0`, `resolved_at IS NULL`
   - Only exists in the **unified** table
   - PnL is unrealized (depends on future resolution)

2. **Closed (via selling) in unresolved market** - Sold all tokens before resolution
   - `tokens_held = 0`, `resolved_at IS NULL`
   - Only exists in the **unified** table
   - PnL is fully realized from sell proceeds (no resolution needed)
   - This is a **completed trade** even though the market is still open

3. **Resolved** - Market resolved (may or may not have sold early)
   - `resolved_at IS NOT NULL`
   - Exists in **both** FIFO v3 and unified tables
   - `tokens_sold_early > 0` means some were sold before resolution
   - `tokens_held > 0` means some were held through resolution (pays at payout_rate)

### Where Each State Lives

| Table | Open Positions | Closed (Unresolved) | Resolved |
|-------|---------------|-------------------|----------|
| `pm_trade_fifo_roi_v3` | NO | NO | YES |
| `pm_trade_fifo_roi_v3_mat_unified` | YES | YES | YES |

**pm_trade_fifo_roi_v3** only contains resolved conditions because the cron uses `INNER JOIN pm_condition_resolutions`. This means `is_closed` is always 1 in this table.

**pm_trade_fifo_roi_v3_mat_unified** contains ALL states:
- `is_closed = 0, resolved_at IS NULL` → Open position
- `is_closed = 1, resolved_at IS NULL` → Closed in unresolved market (fully sold)
- `is_closed = 1, resolved_at IS NOT NULL` → Resolved position

### Detecting Closed Positions in Unresolved Markets
```sql
-- Positions where trader fully exited but market hasn't resolved
SELECT wallet, condition_id, tokens, cost_usd, pnl_usd, roi
FROM pm_trade_fifo_roi_v3_mat_unified
WHERE tokens_held = 0           -- All tokens sold
  AND resolved_at IS NULL       -- Market not resolved
  AND cost_usd > 1              -- Non-trivial position
```

These are real completed trades with realized PnL, even though the market outcome is unknown. The trader's PnL is locked in from the buy/sell spread.

### Long Position Flow
1. Wallet buys tokens (`tokens_delta > 0`, `usdc_delta < 0`)
2. **Can sell some or all before resolution** (`tokens_sold_early`)
   - If ALL tokens sold: position is **closed**, PnL realized from sells alone
   - If some tokens remain: position stays **open** until resolution
3. If market resolves: held tokens pay out at resolution rate
4. `exit_value = (early_sell_proceeds) + (tokens_held * payout_rate)`
5. `pnl_usd = exit_value - cost_usd`

### Short Position Flow
1. Wallet has net negative tokens after all buys/sells (sold more than bought)
2. `net_tokens < -0.01 AND cash_flow > 0.01` (received cash, owes tokens)
3. Position is **open** until resolution (short must wait for market outcome)
4. At resolution: short pays `tokens * payout_rate` as liability
5. `pnl_usd = cash_flow + (net_tokens * payout_rate)` (net_tokens is negative)

**Note:** Shorts cannot "close early" in the same way longs can. A short position's liability only resolves when the market resolves.

### Self-Fill Deduplication
When a wallet is BOTH maker AND taker on the same fill:
```sql
AND NOT (is_self_fill = 1 AND is_maker = 1)
```
Only the TAKER side is counted. This prevents double-counting volume.

---

## Resolution Payout Logic

### payout_numerators Format
Stored as string in pm_condition_resolutions: `'[X,Y]'` where X and Y are for outcome 0 and 1.

| payout_numerators | Outcome 0 Wins | Outcome 1 Wins | Meaning |
|-------------------|---------------|---------------|---------|
| `[1,0]`           | Yes (1.0)     | No (0.0)      | Outcome 0 won |
| `[0,1]`           | No (0.0)      | Yes (1.0)     | Outcome 1 won |
| `[1,1]`           | Partial (0.5) | Partial (0.5) | Split/void |

### Payout Rate Calculation
```sql
CASE
  WHEN payout_numerators = '[1,1]' THEN 0.5
  WHEN payout_numerators = '[0,1]' AND outcome_index = 1 THEN 1.0
  WHEN payout_numerators = '[1,0]' AND outcome_index = 0 THEN 1.0
  ELSE 0.0
END as payout_rate
```

Each held token pays `payout_rate` USD at resolution.

---

## Source Data: pm_canonical_fills_v4

### Schema (Key Columns)
```sql
fill_id        String    -- Unique fill identifier
event_time     DateTime  -- When the fill occurred
wallet         String    -- Trader wallet
condition_id   String    -- Market condition
outcome_index  UInt8     -- 0 or 1
tokens_delta   Float64   -- Positive = buy, Negative = sell
usdc_delta     Float64   -- Positive = received USD, Negative = spent USD
source         String    -- 'clob', 'ctf', or 'negrisk'
is_self_fill   UInt8     -- Wallet is both maker and taker
is_maker       UInt8     -- Maker side of the fill
```

### Critical Filters
```sql
-- FIFO only processes CLOB fills (not CTF or NegRisk)
WHERE source = 'clob'

-- Exclude burn address
AND wallet != '0x0000000000000000000000000000000000000000'

-- Self-fill dedup: exclude maker side when self-filling
AND NOT (is_self_fill = 1 AND is_maker = 1)

-- Fill dedup: canonical_fills can have duplicates
GROUP BY fill_id  -- Always deduplicate first!
```

### What Each Source Means
| Source | Description | Used in FIFO? |
|--------|-------------|---------------|
| `clob` | Order book fills (user trades) | YES |
| `ctf` | Token split/merge operations | NO (included in token net position) |
| `negrisk` | NegRisk adapter internal transfers | NO (excluded entirely) |

---

## Deduplication Layers

### Layer 1: Fill Dedup (within canonical_fills_v4)
```sql
SELECT fill_id, any(tx_hash) as tx_hash, any(wallet) as wallet, ...
FROM pm_canonical_fills_v4
GROUP BY fill_id
```
**Why:** The table can contain duplicate fills from overlapping backfill runs.

### Layer 2: Position Aggregation (fills -> positions)
```sql
-- Long positions: group by transaction
GROUP BY tx_hash, wallet, condition_id, outcome_index
HAVING cost_usd >= 0.01

-- Short positions: group by wallet+condition (one short per condition)
GROUP BY wallet, condition_id, outcome_index
HAVING net_tokens < -0.01 AND cash_flow > 0.01
```

### Layer 3: ReplacingMergeTree (storage dedup)
Sort key `(wallet, condition_id, outcome_index, tx_hash)` means:
- Identical sort key rows are deduplicated during merges
- Use `FINAL` keyword or `GROUP BY` all sort key columns for exact dedup
- Without FINAL, queries may return pre-merge duplicates

---

## FIFO Early Exit Calculation

The FIFO logic tracks how tokens from each buy transaction are allocated:

```
For each buy in chronological order:
  tokens_sold_early = min(buy.tokens, remaining_sell_pool)
  tokens_held = buy.tokens - tokens_sold_early

  exit_value = (tokens_sold_early / total_sold) * total_sell_proceeds
             + tokens_held * payout_rate
```

This is true First-In-First-Out: earlier buys are matched to sells first.

### Window Function (the complex part)
```sql
-- Running sum of all previous buy tokens (for FIFO allocation)
sum(buy.tokens) OVER (
  PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index
  ORDER BY buy.entry_time
  ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
)
```

---

## Cron Pipeline

### Data Flow
```
Blockchain → pm_canonical_fills_v4 (*/10 min)
                      ↓
           pm_condition_resolutions (real-time)
                      ↓
           refresh-fifo-trades (*/2 hours)
                      ↓
           pm_trade_fifo_roi_v3 (resolved only)
                      ↓
           refresh-unified-incremental (*/2 hours at :45)
                      ↓
           pm_trade_fifo_roi_v3_mat_unified (resolved + unresolved)
                      ↓
           Leaderboard crons (*/3 hours, daily)
```

### refresh-fifo-trades Cron
- **Schedule:** Every 2 hours
- **Timeout:** 10 minutes (Vercel Pro)
- **Two-phase approach:**
  1. PRIMARY: Conditions resolved in last 7 days not yet in FIFO (max 2000/run)
  2. CATCH-UP: Any older missed conditions (500/run) - prevents permanent gaps
- **Health metrics:** Reports missed condition counts in every response
- **File:** `app/api/cron/refresh-fifo-trades/route.ts`

### refresh-unified-incremental Cron
- **Schedule:** Every 2 hours at :45
- **Steps:**
  1. Process pending resolutions into FIFO (7-day lookback)
  2. Find active wallets from last 24h
  3. Process unresolved LONG + SHORT positions into unified
  4. Update positions that became resolved
  5. Sync missing wallets from v3 to unified
  6. Refresh all unresolved conditions
  7. OPTIMIZE TABLE FINAL (dedup)
- **File:** `app/api/cron/refresh-unified-incremental/route.ts`

### Health Monitoring
The `monitor-data-quality` cron checks:
- `fifo_missed_resolved_conditions`: Alerts at 10+ missed (CRITICAL at 100+)
- `fifo_resolution_freshness_hours`: Alerts at 6h stale (CRITICAL at 24h)
- `condition_resolutions_freshness_hours`: Alerts at 2h stale (CRITICAL at 6h)

---

## Supporting Tables

### pm_condition_resolutions
- 420K+ resolved conditions
- `payout_numerators`: String like `[1,0]` or `[0,1]`
- `resolved_at`: When the market resolved
- `is_deleted`: Soft delete flag (always filter `WHERE is_deleted = 0`)

### pm_token_to_condition_map_v5
- 759K+ token-to-condition mappings
- Maps `token_id_dec` (decimal) to `condition_id` + `outcome_index`
- 99.996% coverage of FIFO conditions
- Rebuilt every 10 minutes by `rebuild-token-map` cron

### pm_trade_fifo_roi_v3_mat_unified
- Same schema as v3 but ALSO contains unresolved positions
- `is_closed = 0` for unresolved, `1` for resolved
- `resolved_at IS NULL` for unresolved positions
- Used by leaderboard queries that need both resolved and unresolved data
- Has explicit column ordering (different from v3!) - always use named columns in INSERT

---

## Common Gotchas

1. **"Why are all positions is_closed=1 in v3?"** - By design. Only resolved conditions enter pm_trade_fifo_roi_v3. Use the **unified** table to see open positions AND closed-but-unresolved positions.

2. **"Can a position be closed if the market hasn't resolved?"** - YES. If a trader buys tokens and sells ALL of them before the market resolves, the position is closed with realized PnL. The market outcome doesn't matter - the trader already locked in profit/loss from the buy/sell spread. These only exist in the unified table.

3. **"Why does the row count seem high?"** - Each buy transaction creates a separate FIFO row. One wallet with 10 buys in a condition = 10 FIFO rows.

4. **"Fill count != trade count"** - One order can have many fills. Use order_id for trade counting, fill_id only for dedup.

5. **"NegRisk fills in the data?"** - The FIFO cron filters `source = 'clob'`. NegRisk is excluded. Don't manually include it.

6. **"Duplicate rows in queries?"** - ReplacingMergeTree may not have merged yet. Add `FINAL` or dedup in your query.

7. **"Unified table has different column order"** - Always use explicit column names in INSERT INTO unified. Never rely on positional column matching.

8. **"Condition resolved but not in FIFO?"** - The cron has a 7-day lookback + catch-up sweep. If you find gaps, run `scripts/backfill-fifo-missed-conditions.ts`.

9. **"Short positions show weird tx_hash"** - Shorts use synthetic tx_hash: `concat('short_', substring(wallet,1,10), '_', substring(condition_id,1,10), '_', toString(outcome_index))`

10. **"Can shorts close early?"** - No. Unlike longs (which can sell all tokens to close), a short position's liability only resolves when the market resolves. Shorts are always open until resolution.

---

## Quick Diagnostic Queries

### Check FIFO freshness
```sql
SELECT max(resolved_at) as latest_resolution, max(entry_time) as latest_entry,
  count() as total_rows, countDistinct(condition_id) as conditions
FROM pm_trade_fifo_roi_v3
```

### Find missed conditions
```sql
SELECT count(DISTINCT r.condition_id) as missed
FROM pm_condition_resolutions r
INNER JOIN pm_canonical_fills_v4 f ON r.condition_id = f.condition_id
WHERE r.is_deleted = 0 AND r.payout_numerators != '' AND f.source = 'clob'
  AND r.condition_id NOT IN (SELECT DISTINCT condition_id FROM pm_trade_fifo_roi_v3)
```

### Verify a wallet's FIFO positions
```sql
SELECT condition_id, outcome_index, entry_time, tokens, cost_usd,
  tokens_sold_early, tokens_held, pnl_usd, roi, is_short, resolved_at
FROM pm_trade_fifo_roi_v3
WHERE wallet = lower('0x...')
ORDER BY entry_time DESC
LIMIT 20
```

### Check unified vs v3 parity
```sql
SELECT
  (SELECT count() FROM pm_trade_fifo_roi_v3) as v3_rows,
  (SELECT count() FROM pm_trade_fifo_roi_v3_mat_unified) as unified_rows,
  (SELECT countDistinct(wallet) FROM pm_trade_fifo_roi_v3) as v3_wallets,
  (SELECT countDistinct(wallet) FROM pm_trade_fifo_roi_v3_mat_unified) as unified_wallets
```

---

## Key Files

| File | Purpose |
|------|---------|
| `app/api/cron/refresh-fifo-trades/route.ts` | FIFO cron (resolved positions) |
| `app/api/cron/refresh-unified-incremental/route.ts` | Unified cron (resolved + unresolved) |
| `app/api/cron/monitor-data-quality/route.ts` | Health monitoring (7 checks including FIFO) |
| `scripts/backfill-fifo-missed-conditions.ts` | One-time backfill for missed conditions |
| `scripts/backfill-fifo-unified-gap.ts` | Sync v3 wallets missing from unified |
| `lib/pnl/pnlEngineV1.ts` | PnL calculation engine (uses FIFO data) |
