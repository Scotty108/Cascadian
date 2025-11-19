# ClickHouse Table Schemas

Complete reference for Cascadian ClickHouse tables.

---

## Core Tables

### trades_raw
**Purpose**: Raw trade data from Polymarket
**Engine**: MergeTree
**Partition**: Monthly (toYYYYMM(timestamp))
**Order**: (wallet_address, timestamp)

```sql
CREATE TABLE trades_raw (
  trade_id String,
  wallet_address String,
  market_id String,
  timestamp DateTime,
  side Enum8('YES' = 1, 'NO' = 2),
  entry_price Decimal(18, 8),
  exit_price Nullable(Decimal(18, 8)),
  shares Decimal(18, 8),
  usd_value Decimal(18, 2),
  pnl Nullable(Decimal(18, 2)),
  is_closed Bool,
  transaction_hash String,
  created_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (wallet_address, timestamp)
```

**Common Queries**:
- Filter by wallet: `WHERE wallet_address = '0x...'`
- Filter by date: `WHERE timestamp >= '2024-01-01'`
- Recent trades: `ORDER BY timestamp DESC LIMIT 100`

---

### wallet_metrics_daily
**Purpose**: Aggregated daily wallet performance
**Engine**: SummingMergeTree
**Partition**: Monthly (toYYYYMM(date))
**Order**: (wallet_address, date)

```sql
CREATE MATERIALIZED VIEW wallet_metrics_daily
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (wallet_address, date)
AS SELECT
  wallet_address,
  toDate(timestamp) AS date,
  count() AS total_trades,
  countIf(is_closed = true AND pnl > 0) AS wins,
  countIf(is_closed = true AND pnl <= 0) AS losses,
  sumIf(pnl, is_closed = true) AS total_pnl,
  avgIf(pnl, is_closed = true AND pnl > 0) AS avg_win,
  avgIf(pnl, is_closed = true AND pnl <= 0) AS avg_loss,
  sum(usd_value) AS total_volume
FROM trades_raw
GROUP BY wallet_address, toDate(timestamp)
```

**Common Queries**:
- Wallet performance: `WHERE wallet_address = '0x...' GROUP BY wallet_address`
- Top wallets: `GROUP BY wallet_address HAVING total_pnl > 1000 ORDER BY total_pnl DESC`
- Win rate: `wins / nullIf(wins + losses, 0)`

---

### market_resolutions
**Purpose**: Resolved market outcomes with payout vectors
**Key Columns**: condition_id, winning_index, payout_numerators, payout_denominator

```sql
-- Typical structure (check actual schema with DESCRIBE)
condition_id String,
market_slug String,
market_title String,
winning_index UInt8,
payout_numerators Array(UInt256),
payout_denominator UInt256,
resolved_at DateTime,
outcome_text String
```

**Critical**: Always normalize condition_id for joins!
```sql
WHERE lower(replaceAll(condition_id, '0x', '')) = lower(replaceAll('{input}', '0x', ''))
```

**Common Queries**:
- Find resolution: `WHERE condition_id = '...'` (with normalization)
- Recent resolutions: `ORDER BY resolved_at DESC`
- Specific outcome: `WHERE outcome_text LIKE '%winner%'`

---

### wallet_positions
**Purpose**: Current open positions for wallets
**Key Columns**: wallet_address, market_id, shares, entry_price

```sql
-- Typical structure
wallet_address String,
market_id String,
shares Decimal(18, 8),
entry_price Decimal(18, 8),
current_price Nullable(Decimal(18, 8)),
unrealized_pnl Nullable(Decimal(18, 2)),
updated_at DateTime
```

**Common Queries**:
- Wallet positions: `WHERE wallet_address = '0x...'`
- Positions by market: `WHERE market_id = '0x...'`
- Large positions: `WHERE shares > 1000`

---

### fact_pnl
**Purpose**: Calculated P&L aggregations
**Key Columns**: wallet_address, realized_pnl, unrealized_pnl, total_pnl

```sql
-- Typical structure
wallet_address String,
realized_pnl Decimal(18, 2),
unrealized_pnl Decimal(18, 2),
total_pnl Decimal(18, 2),
total_trades UInt32,
win_rate Float64,
calculated_at DateTime
```

**Common Queries**:
- Total PnL: `SELECT total_pnl FROM fact_pnl WHERE wallet_address = '0x...'`
- Top performers: `ORDER BY total_pnl DESC LIMIT 50`
- Profitable wallets: `WHERE total_pnl > 0`

---

## System Tables

### system.tables
**Purpose**: Metadata about all tables
```sql
SELECT
  name,
  engine,
  total_rows,
  formatReadableSize(total_bytes) as size
FROM system.tables
WHERE database = 'default'
ORDER BY total_bytes DESC
```

### system.columns
**Purpose**: Column information for all tables
```sql
SELECT
  table,
  name,
  type,
  default_expression
FROM system.columns
WHERE database = 'default' AND table = 'trades_raw'
ORDER BY position
```

---

## Common Table Patterns

### Finding Tables by Pattern
```sql
-- Find all tables with 'wallet' in name
SELECT name FROM system.tables
WHERE database = 'default'
  AND name LIKE '%wallet%'
```

### Checking Table Coverage
```sql
-- Check date range
SELECT
  min(timestamp) AS earliest,
  max(timestamp) AS latest,
  count(*) AS rows,
  count(DISTINCT wallet_address) AS unique_wallets
FROM trades_raw
```

### Checking Table Size
```sql
SELECT
  name AS table_name,
  formatReadableSize(total_bytes) AS size,
  total_rows AS rows
FROM system.tables
WHERE database = 'default'
  AND name IN ('trades_raw', 'wallet_metrics_daily', 'market_resolutions')
ORDER BY total_bytes DESC
```

---

## Join Patterns

### Trades + Resolutions
```sql
SELECT
  t.wallet_address,
  t.market_id,
  t.shares,
  t.entry_price,
  r.winning_index,
  r.payout_numerators
FROM trades_raw t
LEFT JOIN market_resolutions r
  ON lower(replaceAll(t.market_id, '0x', '')) = lower(replaceAll(r.condition_id, '0x', ''))
WHERE t.wallet_address = '0x...'
```

### Trades + Positions
```sql
SELECT
  t.wallet_address,
  t.market_id,
  sum(t.shares) AS total_shares,
  avg(t.entry_price) AS avg_entry_price,
  p.current_price,
  p.unrealized_pnl
FROM trades_raw t
LEFT JOIN wallet_positions p
  ON t.wallet_address = p.wallet_address
  AND t.market_id = p.market_id
GROUP BY t.wallet_address, t.market_id, p.current_price, p.unrealized_pnl
```

---

## Table Discovery Commands

### List All Tables
```sql
SHOW TABLES FROM default
```

### Get Table Schema
```sql
DESCRIBE TABLE default.trades_raw
```

### Get Table Create Statement
```sql
SHOW CREATE TABLE trades_raw
```

### Search for Column
```sql
SELECT
  table,
  name AS column_name,
  type
FROM system.columns
WHERE database = 'default'
  AND name LIKE '%condition%'
```

---

## Quick Reference

| Command | Purpose |
|---------|---------|
| `SHOW TABLES` | List all tables |
| `DESCRIBE TABLE {name}` | Show table schema |
| `SELECT count(*) FROM {table}` | Get rowcount |
| `SELECT * FROM {table} LIMIT 10` | Sample data |
| `SHOW CREATE TABLE {name}` | Get CREATE statement |

**Always Remember**:
- Normalize condition_id for joins (IDN pattern)
- Arrays are 1-indexed (CAR pattern)
- Use WHERE clauses for performance
- Add LIMIT to exploratory queries
