---
name: database-query
description: Query ClickHouse for any Cascadian data. Auto-use when user asks to "query the database", "find trades for", "check this table", "how many wallets", "count of", "search for condition", "show me the data", or any question requiring SQL against wallets, markets, trades, PnL, positions, or resolutions.
---

# Database Query Builder

Query ClickHouse database efficiently with proper normalization, joins, and performance patterns.

---

## When to Use This Skill

Use this skill when you need to:
- ✅ Query wallet positions, trades, or PnL
- ✅ Search for markets or resolutions
- ✅ Analyze market performance or volume
- ✅ Find specific data across tables
- ✅ Verify data quality or coverage
- ✅ Check table schemas or rowcounts
- ✅ Build aggregation or analytical queries

**Examples of triggers**:
- "Find all trades for wallet 0x..."
- "Get market resolution data"
- "Check PnL for specific wallets"
- "Search tables for condition_id"
- "Show me wallet positions"

---

## Critical ClickHouse Patterns (MUST FOLLOW)

### Pattern 1: ID Normalization (IDN)
**Always normalize IDs before joins**:
```sql
-- ✅ CORRECT - Normalized
SELECT *
FROM table1 t1
JOIN table2 t2 ON lower(replaceAll(t1.condition_id, '0x', '')) = lower(replaceAll(t2.condition_id, '0x', ''))

-- ❌ WRONG - Direct join (will fail on format mismatch)
SELECT *
FROM table1 t1
JOIN table2 t2 ON t1.condition_id = t2.condition_id
```

**Normalization Rules**:
- Lowercase: `lower(condition_id)`
- Strip 0x prefix: `replaceAll(condition_id, '0x', '')`
- Expect 64 hex characters
- Use String type (not FixedString)

### Pattern 2: ClickHouse Array Indexing (CAR)
**Arrays are 1-indexed (NOT 0-indexed)**:
```sql
-- ✅ CORRECT - Add 1 to index
SELECT arrayElement(payout_numerators, winning_index + 1)

-- ❌ WRONG - 0-based indexing (will fail)
SELECT arrayElement(payout_numerators, winning_index)
```

### Pattern 3: Direction from Net Flows (NDR)
```sql
-- Direction calculation
CASE
  WHEN usdc_net > 0 AND token_net > 0 THEN 'BUY'  -- spent USDC, got tokens
  WHEN usdc_net < 0 AND token_net < 0 THEN 'SELL' -- got USDC, spent tokens
  ELSE 'UNKNOWN'
END AS direction
```

### Pattern 4: PnL Calculation (PNL)
```sql
-- PnL from payout vector
shares * (arrayElement(payout_numerators, winning_index + 1) / payout_denominator) - cost_basis AS pnl_usd
```

---

## Available Tables

See `TABLES.md` for complete schemas. Production tables:

| Table | Rows | Description | Key Columns |
|-------|------|-------------|-------------|
| `pm_canonical_fills_v4` | 1.19B | Master canonical fills | wallet, condition_id, usdc_amount, source |
| `pm_trade_fifo_roi_v3` | 283M | FIFO trades with PnL/ROI | wallet, pnl_usd, roi_pct, cost_basis_usd |
| `pm_condition_resolutions` | 411k | Market outcomes | condition_id, winning_index, payout_numerators |
| `pm_token_to_condition_map_v5` | 500k | Token to condition mapping | token_id, condition_id, outcome_index |
| `pm_wallet_position_fact_v1` | - | Current open positions | wallet, net_tokens, cost_basis_usd |
| `pm_latest_mark_price_v1` | - | Current mark prices | condition_id, mark_price |
| `pm_copy_trading_leaderboard` | 20 | Top robust traders | wallet, sim_roi_without_top3, win_rate |
| `pm_smart_money_cache` | 100 | Smart money categories | wallet, category, total_pnl |

**DEPRECATED**: `pm_canonical_fills_v4`, `wallet_metrics_daily`, `fact_pnl` DO NOT EXIST. See TABLES.md for mapping.

**Find all tables**:
```sql
SHOW TABLES FROM default
```

**Get table schema**:
```sql
DESCRIBE TABLE pm_canonical_fills_v4
```

**Get rowcount**:
```sql
SELECT count() FROM pm_canonical_fills_v4
```

---

## Common Query Patterns

See `EXAMPLES.md` for full examples. Quick patterns:

### 1. Wallet Fills
```sql
SELECT
  fill_timestamp,
  condition_id,
  side,
  round(usdc_amount / 1e6, 2) as usdc,
  round(token_amount / 1e6, 2) as tokens,
  source
FROM pm_canonical_fills_v4
WHERE wallet = lower('0x...')
  AND source != 'negrisk'
ORDER BY fill_timestamp DESC
LIMIT 100
```

### 2. Market Resolution Lookup
```sql
SELECT
  condition_id,
  winning_index,
  payout_numerators,
  payout_denominator,
  resolved_at
FROM pm_condition_resolutions
WHERE lower(replaceAll(condition_id, '0x', '')) = lower(replaceAll('{condition_id}', '0x', ''))
```

### 3. Wallet Performance (from FIFO)
```sql
SELECT
  wallet,
  count() as positions,
  countIf(pnl_usd > 0) as wins,
  countIf(pnl_usd < 0) as losses,
  round(wins / nullIf(wins + losses, 0) * 100, 1) as win_rate,
  round(sum(pnl_usd), 2) as total_pnl,
  round(sum(cost_basis_usd), 2) as total_invested
FROM pm_trade_fifo_roi_v3
WHERE wallet = lower('0x...')
GROUP BY wallet
```

### 4. Top Performing Wallets
```sql
SELECT
  wallet,
  round(sum(pnl_usd), 0) as total_pnl,
  count() as positions,
  countIf(pnl_usd > 0) as wins,
  countIf(pnl_usd < 0) as losses,
  round(sum(cost_basis_usd), 0) as total_volume
FROM pm_trade_fifo_roi_v3
WHERE trade_time > now() - INTERVAL 30 DAY
  AND cost_basis_usd >= 10
GROUP BY wallet
HAVING positions >= 20 AND total_pnl > 1000
ORDER BY total_pnl DESC
LIMIT 50
```

### 5. Search by Condition ID
```sql
-- Search across multiple tables
SELECT 'canonical_fills' AS source, count() AS cnt
FROM pm_canonical_fills_v4
WHERE lower(replaceAll(condition_id, '0x', '')) = lower(replaceAll('{condition_id}', '0x', ''))

UNION ALL

SELECT 'resolutions', count()
FROM pm_condition_resolutions
WHERE lower(replaceAll(condition_id, '0x', '')) = lower(replaceAll('{condition_id}', '0x', ''))

UNION ALL

SELECT 'fifo_trades', count()
FROM pm_trade_fifo_roi_v3
WHERE lower(replaceAll(condition_id, '0x', '')) = lower(replaceAll('{condition_id}', '0x', ''))
```

---

## Performance Best Practices

### 1. Use WHERE Clauses
**Always filter before aggregating**:
```sql
-- ✅ GOOD - Filter first
SELECT count(*)
FROM pm_canonical_fills_v4
WHERE timestamp >= '2024-01-01'

-- ❌ BAD - Scan whole table
SELECT count(*) FROM pm_canonical_fills_v4
```

### 2. Use LIMIT
**Always limit large queries**:
```sql
-- ✅ GOOD - Limited
SELECT * FROM pm_canonical_fills_v4 LIMIT 1000

-- ❌ BAD - Could return millions
SELECT * FROM pm_canonical_fills_v4
```

### 3. Use Indexes
**Order by indexed columns**:
```sql
-- ✅ GOOD - Uses index (wallet_address, timestamp)
WHERE wallet_address = '0x...' ORDER BY timestamp

-- ⚠️ SLOWER - Not using index optimally
WHERE market_id = '0x...' ORDER BY timestamp
```

### 4. Prefer count(*) over count(column)
```sql
-- ✅ FASTER
SELECT count(*) FROM pm_canonical_fills_v4

-- ⚠️ SLOWER
SELECT count(trade_id) FROM pm_canonical_fills_v4
```

---

## Debugging Queries

### Check Table Exists
```sql
SELECT count(*) FROM system.tables
WHERE database = 'default'
  AND name = 'pm_canonical_fills_v4'
```

### Check Data Coverage
```sql
SELECT
  min(timestamp) AS earliest,
  max(timestamp) AS latest,
  count(*) AS total_rows
FROM pm_canonical_fills_v4
```

### Check for Duplicates
```sql
SELECT
  trade_id,
  count(*) AS count
FROM pm_canonical_fills_v4
GROUP BY trade_id
HAVING count > 1
```

### Sample Data
```sql
SELECT * FROM pm_canonical_fills_v4 LIMIT 10
```

---

## Common Errors and Fixes

### Error: "Column not found"
**Cause**: Typo or wrong table
**Fix**: Check table schema with `DESCRIBE TABLE`

### Error: "JOIN fails silently"
**Cause**: ID format mismatch (0x prefix, case)
**Fix**: Apply IDN normalization to both sides

### Error: "Array index out of range"
**Cause**: Using 0-based indexing
**Fix**: Add 1 to index (ClickHouse arrays are 1-indexed)

### Error: "Query too slow"
**Cause**: No WHERE clause or missing indexes
**Fix**: Add filters, use indexed columns, add LIMIT

---

## Example Workflow

### Task: Find PnL for wallet
```sql
-- Step 1: Check if wallet exists
SELECT count(*) FROM wallet_metrics_daily
WHERE wallet_address = '0xABC...'

-- Step 2: Get aggregated metrics
SELECT
  sum(total_pnl) AS total_pnl,
  sum(wins) AS wins,
  sum(losses) AS losses,
  wins / nullIf(wins + losses, 0) AS win_rate
FROM wallet_metrics_daily
WHERE wallet_address = '0xABC...'

-- Step 3: Get recent trades
SELECT
  timestamp,
  market_id,
  side,
  pnl,
  usd_value
FROM pm_canonical_fills_v4
WHERE wallet_address = '0xABC...'
  AND timestamp >= now() - INTERVAL 30 DAY
ORDER BY timestamp DESC
LIMIT 100
```

---

## When NOT to Use This Skill

Don't use this skill when:
- ❌ Making schema changes (use database-architect agent instead)
- ❌ Optimizing slow queries (use database-architect agent)
- ❌ Large refactoring (use database-architect agent)
- ❌ Question doesn't involve database

---

## Related Resources

- **TABLES.md**: Complete table schemas
- **EXAMPLES.md**: Detailed query examples
- **Stable Pack** (CLAUDE.md): IDN, NDR, PNL, CAR skill labels
- **lib/clickhouse/client.ts**: ClickHouse connection
- **scripts/**: Query examples in TypeScript

---

## Quick Reference Card

```sql
-- ID Normalization
lower(replaceAll(condition_id, '0x', ''))

-- Array Indexing (1-based!)
arrayElement(array, index + 1)

-- Direction
CASE
  WHEN usdc_net > 0 AND token_net > 0 THEN 'BUY'
  WHEN usdc_net < 0 AND token_net < 0 THEN 'SELL'
  ELSE 'UNKNOWN'
END

-- PnL
shares * (arrayElement(payout_numerators, winning_index + 1) / payout_denominator) - cost_basis

-- Table Info
SHOW TABLES
DESCRIBE TABLE table_name
SELECT count(*) FROM table_name

-- Performance
WHERE + LIMIT + indexed columns
```
