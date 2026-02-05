---
name: fifo-logic
description: Complete reference for FIFO v3/v5 trading logic, all three FIFO tables (v3, mat_unified, mat_deduped), position lifecycle, deduplication, resolution mapping, cron pipeline, and points of failure. Auto-use when working on FIFO calculations, trade counting, position tracking, order_id vs fill_id, buy/sell logic, resolved/unresolved positions, or any pm_trade_fifo_roi_v3 work.
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

## The Three FIFO Tables

### 1. pm_trade_fifo_roi_v3 (PRIMARY)

**Row Count:** 290.5M | **Engine:** SharedReplacingMergeTree
**Sort Key:** `(wallet, condition_id, outcome_index, tx_hash)` | **Partition:** None

```
Columns (18): tx_hash, order_id, wallet, condition_id, outcome_index,
  entry_time, tokens, cost_usd, tokens_sold_early, tokens_held,
  exit_value, pnl_usd, roi, pct_sold_early, is_maker, resolved_at,
  is_short, is_closed
```

**Key Facts:**
- Contains resolved positions (from `refresh-fifo-trades` cron)
- Also contains closed-but-unresolved positions (from FIFO V5 scripts)
- `is_closed` is always 1 (only fully resolved/closed positions enter)
- `resolved_at` is non-nullable `DateTime` (defaults to `'0000-00-00 00:00:00'` for unresolved)
- HAS `order_id` column
- Column order: `resolved_at` comes AFTER `is_maker` (position 16)
- Used by: PnL engine, ultra-active leaderboard, copy trading cron, smart money cron

### 2. pm_trade_fifo_roi_v3_mat_unified (ALL POSITIONS)

**Row Count:** 276.2M | **Engine:** SharedReplacingMergeTree
**Sort Key:** `(wallet, condition_id, outcome_index, tx_hash)` | **Partition:** None

```
Columns (18): tx_hash, order_id, wallet, condition_id, outcome_index,
  entry_time, resolved_at, tokens, cost_usd, tokens_sold_early,
  tokens_held, exit_value, pnl_usd, roi, pct_sold_early,
  is_maker, is_closed, is_short
```

**Key Facts:**
- Contains resolved + unresolved + closed positions (ALL states)
- `resolved_at` is non-nullable `DateTime` (position 7, right after `entry_time`)
- HAS `order_id` column
- **Column order DIFFERS from v3** - `resolved_at` is at position 7 (not 16)
- **Always use named columns in INSERT** - positional inserts will silently corrupt data
- Used by: leaderboard queries needing both resolved and unresolved data

### 3. pm_trade_fifo_roi_v3_mat_deduped (DEDUPLICATED RESOLVED)

**Row Count:** 286.3M | **Engine:** SharedMergeTree (NOT Replacing!)
**Sort Key:** `(wallet, condition_id, outcome_index, tx_hash)` | **Partition:** None

```
Columns (16): tx_hash, wallet, condition_id, outcome_index, entry_time,
  resolved_at, cost_usd, tokens, tokens_sold_early, tokens_held,
  exit_value, pnl_usd, roi, pct_sold_early, is_maker, is_short
```

**Key Facts:**
- **NO `order_id` column** - cannot do accurate trade counting from this table
- **NO `is_closed` column** - all rows are implicitly closed/resolved
- Different column ordering from both v3 and unified
- SharedMergeTree (no dedup on merge - deduplicated at creation time)
- Used by: `refresh-unified-final` cron, smart money cache, leaderboard scripts

### Column Comparison Matrix

| Column | v3 (18) | unified (18) | deduped (16) |
|--------|---------|-------------|-------------|
| tx_hash | pos 1 | pos 1 | pos 1 |
| order_id | pos 2 | pos 2 | **MISSING** |
| wallet | pos 3 | pos 3 | pos 2 |
| condition_id | pos 4 | pos 4 | pos 3 |
| outcome_index | pos 5 | pos 5 | pos 4 |
| entry_time | pos 6 | pos 6 | pos 5 |
| resolved_at | **pos 16** | **pos 7** | pos 6 |
| tokens | pos 7 | pos 8 | pos 8 |
| cost_usd | pos 8 | pos 9 | pos 7 |
| is_closed | pos 18 | pos 17 | **MISSING** |
| is_short | pos 17 | pos 18 | pos 16 |

**The different column positions mean positional INSERTs between tables will silently corrupt data.** Always use explicit column names.

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
   - `tokens_held > 0`, `resolved_at IS NULL` (or `'0000-00-00 00:00:00'`)
   - Only exists in the **unified** table
   - PnL is unrealized (depends on future resolution)

2. **Closed (via selling) in unresolved market** - Sold all tokens before resolution
   - `tokens_held = 0`, `resolved_at IS NULL` (or `'0000-00-00 00:00:00'`)
   - Exists in **v3** (from V5 scripts) and **unified** table
   - PnL is fully realized from sell proceeds (no resolution needed)
   - This is a **completed trade** even though the market is still open

3. **Resolved** - Market resolved (may or may not have sold early)
   - `resolved_at IS NOT NULL` (and not `'0000-00-00 00:00:00'`)
   - Exists in **all three** tables
   - `tokens_sold_early > 0` means some were sold before resolution
   - `tokens_held > 0` means some were held through resolution (pays at payout_rate)

### Where Each State Lives

| Table | Open Positions | Closed (Unresolved) | Resolved |
|-------|---------------|-------------------|----------|
| `pm_trade_fifo_roi_v3` | NO | YES (from V5 scripts) | YES |
| `pm_trade_fifo_roi_v3_mat_unified` | YES | YES | YES |
| `pm_trade_fifo_roi_v3_mat_deduped` | NO | NO | YES |

### Detecting Closed Positions in Unresolved Markets
```sql
-- Positions where trader fully exited but market hasn't resolved
SELECT wallet, condition_id, tokens, cost_usd, pnl_usd, roi
FROM pm_trade_fifo_roi_v3_mat_unified
WHERE tokens_held < 0.01           -- All tokens sold
  AND (resolved_at IS NULL OR resolved_at = '0000-00-00 00:00:00')
  AND cost_usd > 1                 -- Non-trivial position
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

## FIFO V5: True FIFO Window Function Algorithm

The V5 algorithm uses SQL window functions to implement chronological first-in-first-out matching of buys to sells.

### The Core Window Function
```sql
-- Running sum of all PREVIOUS buy tokens (FIFO allocation)
sum(buy.tokens) OVER (
  PARTITION BY buy.wallet, buy.condition_id, buy.outcome_index
  ORDER BY buy.entry_time
  ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
)
```

### How FIFO Allocation Works
For each buy transaction in chronological order:
```
tokens_sold_early = min(
  buy.tokens,
  max(0, total_tokens_sold - sum_of_all_previous_buy_tokens)
)
tokens_held = buy.tokens - tokens_sold_early
exit_value = (tokens_sold_early / total_tokens_sold) * total_sell_proceeds
           + tokens_held * payout_rate  -- 0 for unresolved positions
```

Earlier buys are matched to sells first. If a wallet bought 100 tokens in tx1 and 50 in tx2, then sold 120 total:
- tx1: 100 tokens sold early, 0 held
- tx2: 20 tokens sold early, 30 held

### V5 Scripts (Manual Backfill)

| Script | Purpose |
|--------|---------|
| `scripts/build-fifo-v5-batch.ts` | Batch process active wallets (all positions) |
| `scripts/build-fifo-v5-full-backfill.ts` | Full historical backfill |
| `scripts/build-fifo-v5-closed-positions.ts` | Closed positions in unresolved markets |
| `scripts/build-fifo-v5-closed-simple.ts` | Simplified closed position processing |

The closed-positions script uses `last_trade_time` as a pseudo-`resolved_at` for closed-but-unresolved positions (since there's no actual resolution time).

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

**Note:** `pm_trade_fifo_roi_v3_mat_deduped` uses SharedMergeTree (NOT Replacing), so it has no automatic dedup - it was deduplicated at creation time.

---

## Cron Pipeline (4 Crons + 1 Daily)

### Data Flow
```
Blockchain → pm_canonical_fills_v4 (*/10 min)
                      ↓
           pm_condition_resolutions (real-time)
                      ↓
           ┌──────────┴──────────────┐
           │                         │
  refresh-fifo-trades          refresh-unified-table
  (*/2h at :35)               (*/2h at :00)
           │                         │
           ↓                         ↓
  pm_trade_fifo_roi_v3       pm_trade_fifo_roi_v3_mat_unified
  (resolved + V5 closed)    (resolved + unresolved + closed)
           │                         ↑
           │                         │
           │              refresh-unified-incremental
           │              (*/2h at :45)
           │                         ↑
           │              refresh-unified-final
           │              (daily 5am UTC)
           │                         │
           ↓                         │
  pm_trade_fifo_roi_v3_mat_deduped ──┘
           │
           ↓
  Leaderboard crons (*/3h, daily)
```

### 1. refresh-fifo-trades (Primary FIFO Cron)
- **Schedule:** Every 2 hours at :35
- **Timeout:** 10 minutes (Vercel Pro)
- **Reads from:** pm_canonical_fills_v4, pm_condition_resolutions
- **Writes to:** pm_trade_fifo_roi_v3
- **Two-phase approach:**
  1. PRIMARY: Conditions resolved in last 7 days not yet in FIFO (max 2000/run)
  2. CATCH-UP: Any older missed conditions (500/run) - prevents permanent gaps
- **Health metrics:** Reports missed condition counts in every response
- **File:** `app/api/cron/refresh-fifo-trades/route.ts`

### 2. refresh-unified-table (Simple Rebuild)
- **Schedule:** Every 2 hours at :00
- **Timeout:** 10 minutes
- **Approach:** DELETE all unresolved → rebuild from last 24h active wallets
- **Runs:** `scripts/refresh-unified-simple.ts` via child process
- **Steps:**
  1. `ALTER TABLE DELETE WHERE resolved_at IS NULL`
  2. Wait for mutation to complete (polls system.mutations)
  3. Find active wallets from last 24h
  4. Build fresh unresolved positions in batches of 500
- **File:** `app/api/cron/refresh-unified-table/route.ts`

### 3. refresh-unified-incremental (8-Step Incremental)
- **Schedule:** Every 2 hours at :45
- **Steps:**
  1. Process pending resolutions into FIFO (7-day lookback)
  2. Find active wallets from last 24h
  3. Process unresolved LONG + SHORT positions into unified
  4. Update positions that became resolved
  5. Sync missing wallets from v3 to unified
  6. Refresh all unresolved conditions
  7. OPTIMIZE TABLE FINAL (dedup)
  8. Timestamp validation
- **Uses:** Temp tables with unique execution IDs to prevent race conditions
- **File:** `app/api/cron/refresh-unified-incremental/route.ts`

### 4. refresh-unified-final (Daily Sync from Deduped)
- **Schedule:** Daily at 5:00 AM UTC
- **Reads from:** pm_trade_fifo_roi_v3_mat_deduped
- **Writes to:** pm_trade_fifo_roi_v3_mat_unified
- **Approach:** LEFT JOIN anti-pattern (insert only rows not already in unified)
- **Sets:** `is_closed = CASE WHEN tokens_held <= 0.01 THEN 1 ELSE 0 END`
- **KNOWN ISSUE:** Still uses 48h lookback (not yet updated to 168h like the others)
- **File:** `app/api/cron/refresh-unified-final/route.ts`

### Health Monitoring
The `monitor-data-quality` cron checks:
- `fifo_missed_resolved_conditions`: Alerts at 10+ missed (CRITICAL at 100+)
- `fifo_resolution_freshness_hours`: Alerts at 6h stale (CRITICAL at 24h)
- `condition_resolutions_freshness_hours`: Alerts at 2h stale (CRITICAL at 6h)

---

## Known Issues & Points of Failure

### Active Issues

1. **refresh-unified-final 48h lookback** - Still uses `LOOKBACK_HOURS = 48` while the other crons were updated to 168h. Conditions resolving during outages >48h could be permanently missed from unified.

2. **Column order mismatches** - The three tables have different column orderings. `refresh-unified-simple.ts` uses positional INSERT (no column names), which risks silent data corruption if the unified table schema changes. Always use explicit column names.

3. **refresh-unified-simple passes NULL for resolved_at** but the column is `DateTime` (not Nullable). ClickHouse stores this as `'0000-00-00 00:00:00'`. Code checking `resolved_at IS NULL` may not work - check for both `IS NULL` AND `= '0000-00-00 00:00:00'`.

4. **No partition key on any FIFO table** - All three tables lack partition keys. This means `ALTER TABLE DELETE` operations scan the entire table (slow). The refresh-unified-simple cron works around this by polling system.mutations.

5. **Memory limits** - ClickHouse Cloud has 10.80 GiB limit. Complex window function queries on large condition sets can OOM. The crons use `max_memory_usage: 8000000000` (8 GiB).

### Where Crons Break
1. **Lookback window too short** - The original 48h lookback caused permanent gaps. Fixed to 168h in refresh-fifo-trades and refresh-unified-incremental. NOT yet fixed in refresh-unified-final.
2. **Connection pool exhaustion** - Too many parallel queries can exhaust ClickHouse connections.
3. **Query timeouts** - Window functions on large datasets can exceed the 300s execution limit.
4. **Token mapping gaps** - New markets missing from pm_token_to_condition_map_v5 (auto-fixed by fix-unmapped-tokens cron).
5. **Vercel 10-min timeout** - All crons must complete within 10 minutes (Pro tier limit).

---

## Supporting Tables

### pm_condition_resolutions
- 420K+ resolved conditions
- `payout_numerators`: String like `[1,0]` or `[0,1]`
- `resolved_at`: When the market condition resolved
- `is_deleted`: Soft delete flag (always filter `WHERE is_deleted = 0`)

### pm_token_to_condition_map_v5
- 759K+ token-to-condition mappings
- Maps `token_id_dec` (decimal) to `condition_id` + `outcome_index`
- 99.996% coverage of FIFO conditions
- Rebuilt every 10 minutes by `rebuild-token-map` cron

### pm_canonical_fills_v4
- 1.19B rows
- Source data for all FIFO calculations
- Sources: clob, ctf, negrisk (only clob used for FIFO)
- Refreshed every 10 minutes by `update-canonical-fills` cron

### pm_ingest_watermarks_v1
- Tracks cron progress (source, last processed timestamp)
- Used by incremental crons to avoid reprocessing

### cron_executions
- Logs cron runs (name, status, duration, details)
- Used by monitor-data-quality to check cron health

---

## Common Gotchas

1. **"Why are all positions is_closed=1 in v3?"** - By design for resolved positions. V5 closed-but-unresolved positions also have is_closed=1. Use the **unified** table to see open positions.

2. **"Can a position be closed if the market hasn't resolved?"** - YES. If a trader buys tokens and sells ALL of them before the market resolves, the position is closed with realized PnL. The market outcome doesn't matter - the trader already locked in profit/loss from the buy/sell spread.

3. **"Why does the row count seem high?"** - Each buy transaction creates a separate FIFO row. One wallet with 10 buys in a condition = 10 FIFO rows.

4. **"Fill count != trade count"** - One order can have many fills. Use order_id for trade counting, fill_id only for dedup. Note: pm_trade_fifo_roi_v3_mat_deduped has NO order_id column.

5. **"NegRisk fills in the data?"** - The FIFO cron filters `source = 'clob'`. NegRisk is excluded. Don't manually include it.

6. **"Duplicate rows in queries?"** - ReplacingMergeTree may not have merged yet. Add `FINAL` or dedup in your query. Note: mat_deduped uses plain MergeTree (no automatic dedup).

7. **"Unified table has different column order"** - Always use explicit column names in INSERT INTO unified. Never rely on positional column matching. The three tables have DIFFERENT column orderings.

8. **"Condition resolved but not in FIFO?"** - The cron has a 7-day lookback + catch-up sweep. If you find gaps, run `scripts/backfill-fifo-missed-conditions.ts`.

9. **"Short positions show weird tx_hash"** - Shorts use synthetic tx_hash: `concat('short_', substring(wallet,1,10), '_', substring(condition_id,1,10), '_', toString(outcome_index))`

10. **"Can shorts close early?"** - No. Unlike longs (which can sell all tokens to close), a short position's liability only resolves when the market resolves. Shorts are always open until resolution.

11. **"resolved_at IS NULL doesn't work"** - The column is `DateTime` (not Nullable). Unresolved positions store `'0000-00-00 00:00:00'`. Check BOTH: `(resolved_at IS NULL OR resolved_at = '0000-00-00 00:00:00')`.

12. **"Which table for leaderboards?"** - Use `pm_trade_fifo_roi_v3` or `pm_trade_fifo_roi_v3_mat_deduped` for resolved-only metrics. Use `pm_trade_fifo_roi_v3_mat_unified` only when you need unresolved positions too.

---

## Quick Diagnostic Queries

### Check FIFO freshness
```sql
SELECT max(resolved_at) as latest_resolution, max(entry_time) as latest_entry,
  count() as total_rows, countDistinct(condition_id) as conditions
FROM pm_trade_fifo_roi_v3
```

### Compare all three tables
```sql
SELECT
  (SELECT count() FROM pm_trade_fifo_roi_v3) as v3_rows,
  (SELECT count() FROM pm_trade_fifo_roi_v3_mat_unified) as unified_rows,
  (SELECT count() FROM pm_trade_fifo_roi_v3_mat_deduped) as deduped_rows
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

### Check unified table position states
```sql
SELECT
  countIf(resolved_at != '0000-00-00 00:00:00' AND resolved_at IS NOT NULL) as resolved,
  countIf(resolved_at = '0000-00-00 00:00:00' OR resolved_at IS NULL) as unresolved,
  countIf((resolved_at = '0000-00-00 00:00:00' OR resolved_at IS NULL) AND tokens_held < 0.01) as closed_unresolved,
  countIf((resolved_at = '0000-00-00 00:00:00' OR resolved_at IS NULL) AND tokens_held >= 0.01) as open
FROM pm_trade_fifo_roi_v3_mat_unified
```

### Check cron freshness
```sql
SELECT cron_name, status, max(executed_at) as last_run,
  dateDiff('minute', max(executed_at), now()) as minutes_ago
FROM cron_executions
WHERE cron_name LIKE '%fifo%' OR cron_name LIKE '%unified%'
GROUP BY cron_name, status
ORDER BY cron_name, status
```

---

## Key Files

| File | Purpose |
|------|---------|
| `app/api/cron/refresh-fifo-trades/route.ts` | FIFO cron (resolved + catch-up, v3 table) |
| `app/api/cron/refresh-unified-table/route.ts` | Simple unified refresh (delete+rebuild) |
| `app/api/cron/refresh-unified-incremental/route.ts` | 8-step incremental unified refresh |
| `app/api/cron/refresh-unified-final/route.ts` | Daily sync from mat_deduped to unified |
| `app/api/cron/monitor-data-quality/route.ts` | Health monitoring (7 checks including FIFO) |
| `scripts/refresh-unified-simple.ts` | Simple rebuild script (used by refresh-unified-table cron) |
| `scripts/backfill-fifo-missed-conditions.ts` | One-time backfill for missed conditions |
| `scripts/backfill-fifo-unified-gap.ts` | Sync v3 wallets missing from unified |
| `scripts/build-fifo-v5-closed-positions.ts` | V5: closed positions in unresolved markets |
| `scripts/build-fifo-v5-batch.ts` | V5: batch process active wallets |
| `scripts/build-fifo-v5-full-backfill.ts` | V5: full historical backfill |
| `lib/pnl/pnlEngineV1.ts` | PnL calculation engine (uses FIFO data) |
