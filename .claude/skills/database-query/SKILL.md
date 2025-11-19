---
name: database-query
description: Query and search ClickHouse database for Cascadian data. Use when analyzing wallets, markets, trades, PnL, positions, or resolutions. Includes table search, schema lookups, and query pattern templates.
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

See `TABLES.md` for complete schemas. Common tables:

| Table | Description | Key Columns |
|-------|-------------|-------------|
| `trades_raw` | Raw trade data | wallet_address, market_id, timestamp, side |
| `wallet_metrics_daily` | Daily wallet performance | wallet_address, date, total_pnl, wins, losses |
| `market_resolutions` | Resolved market outcomes | condition_id, winning_index, payout_numerators |
| `wallet_positions` | Current positions | wallet_address, market_id, shares, entry_price |
| `fact_pnl` | Calculated P&L | wallet_address, realized_pnl, unrealized_pnl |

**Find all tables**:
```sql
SHOW TABLES FROM default
```

**Get table schema**:
```sql
DESCRIBE TABLE default.trades_raw
```

**Get rowcount**:
```sql
SELECT count(*) FROM default.trades_raw
```

---

## Common Query Patterns

See `EXAMPLES.md` for full examples. Quick patterns:

### 1. Wallet Trades
```sql
SELECT
  timestamp,
  market_id,
  side,
  shares,
  entry_price,
  usd_value
FROM trades_raw
WHERE wallet_address = '0x...'
ORDER BY timestamp DESC
LIMIT 100
```

### 2. Market Resolution Lookup
```sql
SELECT
  condition_id,
  market_slug,
  winning_index,
  payout_numerators,
  resolved_at
FROM market_resolutions
WHERE lower(replaceAll(condition_id, '0x', '')) = lower(replaceAll('{condition_id}', '0x', ''))
```

### 3. Wallet Performance
```sql
SELECT
  wallet_address,
  sum(total_trades) AS total_trades,
  sum(wins) AS wins,
  sum(losses) AS losses,
  sum(total_pnl) AS total_pnl,
  wins / nullIf(wins + losses, 0) AS win_rate
FROM wallet_metrics_daily
WHERE wallet_address = '0x...'
GROUP BY wallet_address
```

### 4. Top Performing Wallets
```sql
SELECT
  wallet_address,
  sum(total_pnl) AS total_pnl,
  sum(wins) AS wins,
  sum(losses) AS losses,
  sum(total_volume) AS total_volume
FROM wallet_metrics_daily
GROUP BY wallet_address
HAVING total_pnl > 1000
ORDER BY total_pnl DESC
LIMIT 50
```

### 5. Search by Condition ID
```sql
-- Search across multiple tables
SELECT 'trades_raw' AS source, count(*) AS count
FROM trades_raw
WHERE lower(replaceAll(market_id, '0x', '')) = lower(replaceAll('{condition_id}', '0x', ''))

UNION ALL

SELECT 'market_resolutions' AS source, count(*) AS count
FROM market_resolutions
WHERE lower(replaceAll(condition_id, '0x', '')) = lower(replaceAll('{condition_id}', '0x', ''))

UNION ALL

SELECT 'wallet_positions' AS source, count(*) AS count
FROM wallet_positions
WHERE lower(replaceAll(market_id, '0x', '')) = lower(replaceAll('{condition_id}', '0x', ''))
```

---

## Performance Best Practices

### 1. Use WHERE Clauses
**Always filter before aggregating**:
```sql
-- ✅ GOOD - Filter first
SELECT count(*)
FROM trades_raw
WHERE timestamp >= '2024-01-01'

-- ❌ BAD - Scan whole table
SELECT count(*) FROM trades_raw
```

### 2. Use LIMIT
**Always limit large queries**:
```sql
-- ✅ GOOD - Limited
SELECT * FROM trades_raw LIMIT 1000

-- ❌ BAD - Could return millions
SELECT * FROM trades_raw
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
SELECT count(*) FROM trades_raw

-- ⚠️ SLOWER
SELECT count(trade_id) FROM trades_raw
```

---

## Debugging Queries

### Check Table Exists
```sql
SELECT count(*) FROM system.tables
WHERE database = 'default'
  AND name = 'trades_raw'
```

### Check Data Coverage
```sql
SELECT
  min(timestamp) AS earliest,
  max(timestamp) AS latest,
  count(*) AS total_rows
FROM trades_raw
```

### Check for Duplicates
```sql
SELECT
  trade_id,
  count(*) AS count
FROM trades_raw
GROUP BY trade_id
HAVING count > 1
```

### Sample Data
```sql
SELECT * FROM trades_raw LIMIT 10
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
FROM trades_raw
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
