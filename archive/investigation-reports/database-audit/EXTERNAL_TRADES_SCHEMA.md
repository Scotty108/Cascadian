# external_trades_raw Table Schema

**Purpose:** Generic landing zone for trades from external sources (Dome, Dune, Polymarket Subgraph, Data API) that are NOT captured by our CLOB pipeline.

**Created:** Phase 1 of C2 External Data Ingestion mission
**Agent:** C2 - External Data Ingestion

---

## Table Definition

```sql
CREATE TABLE external_trades_raw
(
  -- Source Tracking
  source                  LowCardinality(String),  -- 'dome', 'dune', 'polymarket_api', 'subgraph', etc.
  ingested_at             DateTime DEFAULT now(),  -- Server timestamp of ingestion
  external_trade_id       String,                  -- Upstream unique ID for deduplication

  -- Wallet & Market
  wallet_address          String,                  -- EOA or proxy (lowercase, no 0x)
  condition_id            String,                  -- Normalized (lowercase, no 0x, 64 chars)
  market_question         String DEFAULT '',       -- For debugging

  -- Trade Details
  side                    LowCardinality(String),  -- 'YES'/'NO' or outcome label
  outcome_index           Int32 DEFAULT -1,        -- Numeric index if available
  shares                  Float64,                 -- Number of shares
  price                   Float64,                 -- Per share (0-1)
  cash_value              Float64 DEFAULT 0.0,     -- price * shares if given
  fees                    Float64 DEFAULT 0.0,     -- If available

  -- Timestamps & Blockchain
  trade_timestamp         DateTime,                -- When trade occurred
  tx_hash                 String DEFAULT ''        -- Blockchain hash if available
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(trade_timestamp)
ORDER BY (condition_id, wallet_address, trade_timestamp, external_trade_id);
```

---

## Column Descriptions

### Source Tracking

| Column | Type | Purpose |
|--------|------|---------|
| `source` | LowCardinality(String) | Identifies data origin: `'dome'`, `'dune'`, `'polymarket_api'`, `'subgraph'`, etc. |
| `ingested_at` | DateTime | Server timestamp when row was inserted (auto-generated) |
| `external_trade_id` | String | Unique ID from upstream source for deduplication |

### Wallet & Market

| Column | Type | Purpose |
|--------|------|---------|
| `wallet_address` | String | Trader wallet (lowercase, no `0x` prefix) |
| `condition_id` | String | Market condition ID (lowercase, no `0x`, 64 chars) |
| `market_question` | String | Optional market question for debugging/human readability |

### Trade Details

| Column | Type | Purpose |
|--------|------|---------|
| `side` | LowCardinality(String) | Trade direction: `'YES'`/`'NO'` or generic outcome label |
| `outcome_index` | Int32 | Numeric outcome index (0, 1, 2, etc.) if available, else -1 |
| `shares` | Float64 | Number of shares traded |
| `price` | Float64 | Price per share (0-1 probability range) |
| `cash_value` | Float64 | `price * shares` if provided by upstream, else 0.0 |
| `fees` | Float64 | Trading fees if available, else 0.0 |

### Timestamps & Blockchain

| Column | Type | Purpose |
|--------|------|---------|
| `trade_timestamp` | DateTime | When the trade occurred (from upstream source) |
| `tx_hash` | String | Blockchain transaction hash if on-chain or provided by source |

---

## Indexes

For fast query performance:

```sql
CREATE INDEX idx_external_trades_wallet
  ON external_trades_raw (wallet_address)
  TYPE bloom_filter(0.01) GRANULARITY 1;

CREATE INDEX idx_external_trades_condition
  ON external_trades_raw (condition_id)
  TYPE bloom_filter(0.01) GRANULARITY 1;

CREATE INDEX idx_external_trades_source
  ON external_trades_raw (source)
  TYPE bloom_filter(0.01) GRANULARITY 1;
```

---

## Design Principles

### 1. Source Agnostic
Schema accommodates data from multiple external sources:
- **Dome:** P&L platform with aggregated trade data
- **Dune Analytics:** Blockchain analytics with SQL interface
- **Polymarket Subgraph:** GraphQL endpoint for blockchain events
- **Polymarket Data API:** Official REST API
- Future sources (manually added CSV, third-party APIs, etc.)

### 2. Minimal Required Fields
Only essential fields are required:
- `source` - Track data origin
- `wallet_address` - Who traded
- `condition_id` - What market
- `shares`, `price` - Trade size and value
- `trade_timestamp` - When it occurred
- `external_trade_id` - Deduplication key

Optional fields (`cash_value`, `fees`, `tx_hash`, `market_question`) default to empty/zero if not provided.

### 3. Normalization Rules
All data sources must normalize to these standards:
- **Wallet addresses:** Lowercase, no `0x` prefix
- **Condition IDs:** Lowercase, no `0x` prefix, exactly 64 hex characters
- **Timestamps:** UTC DateTime
- **Shares/Price:** Float64 (no strings or scientific notation)

### 4. Deduplication Strategy
`external_trade_id` should be unique per source:
- Dome: Use their trade ID
- Dune: Use `tx_hash + log_index` or similar
- Subgraph: Use GraphQL entity ID
- Data API: Use API-provided trade ID

If source doesn't provide unique IDs, construct one:
```typescript
external_trade_id = `${source}_${wallet}_${condition_id}_${timestamp}_${shares}`
```

---

## Usage Examples

### Insert Trade from Dome
```typescript
await clickhouse.insert({
  table: 'external_trades_raw',
  values: [{
    source: 'dome',
    external_trade_id: 'dome_trade_12345',
    wallet_address: 'cce2b7c71f21e358b8e5e797e586cbc03160d58b',
    condition_id: '293fb49f43b12631ec4ad0617d9c0efc0eacce33416ef16f68521427daca1678',
    market_question: 'Will Satoshi move any Bitcoin in 2025?',
    side: 'YES',
    outcome_index: 0,
    shares: 1000.0,
    price: 0.947,
    cash_value: 947.0,
    fees: 0.0,
    trade_timestamp: '2025-09-15 14:30:00',
    tx_hash: ''
  }],
  format: 'JSONEachRow'
});
```

### Insert Trade from Polymarket Subgraph
```typescript
await clickhouse.insert({
  table: 'external_trades_raw',
  values: [{
    source: 'subgraph',
    external_trade_id: 'polymarket_0x1234abcd',
    wallet_address: 'cce2b7c71f21e358b8e5e797e586cbc03160d58b',
    condition_id: 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1',
    market_question: '',  // Subgraph may not provide this
    side: 'NO',
    outcome_index: 1,
    shares: 19999.99,
    price: 0.930,
    cash_value: 0.0,  // Calculate ourselves
    fees: 0.0,
    trade_timestamp: '2025-09-20 09:45:12',
    tx_hash: '0xabcdef1234567890...'
  }],
  format: 'JSONEachRow'
});
```

### Query by Wallet
```sql
SELECT
  source,
  condition_id,
  side,
  shares,
  price,
  trade_timestamp
FROM external_trades_raw
WHERE wallet_address = 'cce2b7c71f21e358b8e5e797e586cbc03160d58b'
ORDER BY trade_timestamp DESC;
```

### Query by Source
```sql
SELECT
  source,
  COUNT(*) as trade_count,
  COUNT(DISTINCT wallet_address) as unique_wallets,
  COUNT(DISTINCT condition_id) as unique_markets,
  SUM(cash_value) as total_volume
FROM external_trades_raw
GROUP BY source;
```

### Check for Duplicates
```sql
SELECT
  external_trade_id,
  COUNT(*) as cnt
FROM external_trades_raw
GROUP BY external_trade_id
HAVING COUNT(*) > 1;
```

---

## Relationship to Other Tables

### Does NOT Replace
- `clob_fills` - CLOB trades remain primary source
- `pm_trades` - View over CLOB data
- `pm_wallet_market_pnl_resolved` - P&L views (C1's domain)

### Complements Via UNION
- Phase 2 creates `pm_trades_with_external` view
- UNIONs `pm_trades` (CLOB) + `external_trades_raw` (AMM/external)
- C1 can switch PnL calculations to use unified view

### Data Flow
```
External Sources (Dome, Dune, Subgraph)
    ↓
Scripts (203-ingest-*.ts)
    ↓
external_trades_raw (this table)
    ↓
pm_trades_with_external (UNION view)
    ↓
P&L Calculations (C1's domain)
```

---

## Validation Queries

### After Ingestion
```sql
-- Expected: 21 trades for xcnstrategy across 6 ghost markets
SELECT
  COUNT(*) as total_trades,
  COUNT(DISTINCT condition_id) as unique_markets,
  SUM(shares) as total_shares
FROM external_trades_raw
WHERE wallet_address = 'cce2b7c71f21e358b8e5e797e586cbc03160d58b'
  AND condition_id IN (
    '293fb49f43b12631ec4ad0617d9c0efc0eacce33416ef16f68521427daca1678',
    'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1',
    'bff3fad6e9c96b6e3714c52e6d916b1ffb0f52cdfdb77c7fb153a8ef1ebff608',
    'e9c127a8c35f045d37b5344b0a36711084fa20c2fc1618bf178a5386f90610be',
    'ce733629b3b1bea0649c9c9433401295eb8e1ba6d572803cb53446c93d28cd44',
    'fc4453f83b30fdad8ac707b7bd11309aa4c4c90d0c17ad0c4680d4142d4471f7'
  );
-- Expected: total_trades = 21, unique_markets = 6, total_shares ≈ 23,890.13
```

### Data Quality Checks
```sql
-- No NULL required fields
SELECT
  COUNT(*) as null_wallet,
  SUM(CASE WHEN condition_id = '' THEN 1 ELSE 0 END) as empty_condition,
  SUM(CASE WHEN shares = 0 THEN 1 ELSE 0 END) as zero_shares,
  SUM(CASE WHEN price < 0 OR price > 1 THEN 1 ELSE 0 END) as invalid_price
FROM external_trades_raw
WHERE wallet_address = ''
   OR condition_id = ''
   OR shares IS NULL
   OR price IS NULL;
-- Expected: All zeros
```

---

## Maintenance

### Adding New Data Source
1. Choose unique `source` identifier (e.g., `'new_api'`)
2. Map upstream fields to schema columns
3. Normalize wallet addresses and condition_ids
4. Generate unique `external_trade_id`
5. Insert via `clickhouse.insert()` with `format: 'JSONEachRow'`

### Deduplication
`MergeTree` engine does NOT auto-dedupe. To handle duplicates:
```sql
-- Option 1: Use INSERT ... SELECT DISTINCT
INSERT INTO external_trades_raw
SELECT DISTINCT * FROM external_trades_raw_staging;

-- Option 2: Filter at query time
SELECT * FROM external_trades_raw
WHERE external_trade_id IN (
  SELECT external_trade_id
  FROM external_trades_raw
  GROUP BY external_trade_id
  HAVING COUNT(*) = 1
);
```

### Cleanup
```sql
-- Drop trades from specific source
ALTER TABLE external_trades_raw
DELETE WHERE source = 'bad_source';

-- Drop all trades (for testing)
TRUNCATE TABLE external_trades_raw;
```

---

## Next Steps

**Phase 2:** Create `pm_trades_with_external` UNION view
- Combines `pm_trades` (CLOB) + `external_trades_raw` (AMM/external)
- C1 can switch P&L queries to use unified view

**Phase 3:** Implement data source connector
- Start with Polymarket Subgraph (fastest)
- Fetch 21 trades for xcnstrategy + 6 ghost markets
- Validate against Dome stats

**Phase 4:** Sanity checks and handoff
- Verify trade count: 21 trades
- Verify share volume: ~23,890.13 shares
- Compute provisional P&L impact
- Handoff to C1

---

**Agent:** C2 - External Data Ingestion
**File:** `EXTERNAL_TRADES_SCHEMA.md`
**Status:** Phase 1 Complete
**Script:** `scripts/201-create-external-trades-table.ts`
