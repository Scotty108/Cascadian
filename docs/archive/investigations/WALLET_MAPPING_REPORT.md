# Polymarket Wallet Mapping & Market Metadata Discovery Report

## Executive Summary

**Investigation Date:** November 10, 2025
**Target Wallet:** `0xcce2b7c71f21e358b8e5e797e586cbc03160d58b`
**Key Discovery:** ✓ Wallet mapping system identified
**Status:** System wallet proxy found

---

## 1. Wallet Mapping System Discovery

### Key Finding: Proxy Wallet Architecture

Polymarket uses a **system wallet proxy** architecture where:
- Users have a **public profile wallet** (shown in UI)
- Trades execute through a **system wallet** (on-chain)
- Mapping stored in: `cascadian_clean.system_wallet_map`

### Mapping for Target Wallet

```
UI/Profile Wallet:  0xcce2b7c71f21e358b8e5e797e586cbc03160d58b
      ↓ (mapped to)
System Wallet:     0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e
```

**Table:** `cascadian_clean.system_wallet_map`
- **Rows:** 23,252,314 wallet mappings
- **Columns:**
  - `user_wallet` - Public profile address
  - `system_wallet` - On-chain trading address
  - `cid_hex` - Market condition ID
  - `direction` - BUY/SELL
  - `shares`, `price`, `usdc_amount`
  - `confidence` - HIGH/MEDIUM/LOW
  - `mapping_method` - How mapping was determined

**Schema:**
```sql
CREATE TABLE cascadian_clean.system_wallet_map (
    tx_hash String,
    system_wallet String,      -- On-chain address
    user_wallet String,         -- UI profile address
    cid_hex String,            -- Market ID
    direction Enum8('BUY' = 1, 'SELL' = 2, 'UNKNOWN' = 3),
    shares Decimal(18, 8),
    price Decimal(18, 8),
    usdc_amount Decimal(18, 2),
    confidence Enum8('HIGH' = 1, 'MEDIUM' = 2, 'LOW' = 3),
    mapping_method String
) ENGINE = SharedReplacingMergeTree;
```

---

## 2. Market Metadata Tables

### Primary Market Metadata Sources

#### A. `default.gamma_markets` (149,907 markets)
**Purpose:** Full market metadata with descriptions
**Best for:** Human-readable titles and full context

**Columns:**
- `condition_id` - 32-byte hex market ID
- `question` - Market title (searchable!)
- `description` - Full market rules
- `outcomes_json` - Array of outcomes ["Yes", "No"]
- `end_date` - Market close date
- `category`, `tags_json` - Classification
- `closed` - 0/1 status
- `fetched_at` - Last API sync

**Example Query:**
```sql
SELECT condition_id, question, description, outcomes_json
FROM default.gamma_markets
WHERE question LIKE '%egg%' AND question LIKE '%May%'
```

#### B. `default.api_markets_staging` (161,180 markets)
**Purpose:** Fresh API data with resolution status
**Best for:** Current market state and volume

**Columns:**
- `condition_id` - Market ID
- `market_slug` - URL-friendly identifier
- `question` - Market title
- `volume` - Total trading volume
- `resolved` - Boolean resolution status
- `winning_outcome` - "Yes"/"No" if resolved
- `active`, `closed` - Market status
- `timestamp` - Last update

#### C. `default.dim_markets` (318,535 markets)
**Purpose:** Consolidated dimension table
**Best for:** Analytics and aggregation

**Columns:**
- `condition_id_norm` - Normalized 64-char hex (no 0x)
- `market_id` - Market identifier
- `question` - Market title
- `volume` - Trading volume
- `closed` - Status
- `resolved_at` - Resolution timestamp
- `primary_source` - Data origin (api+gamma)

---

## 3. Market ID → Title Mapping Solution

### Method: Join via condition_id

All trade tables use `condition_id` (32-byte hex) as the primary key.

**Join Pattern:**
```sql
-- Get readable market name from hash
SELECT
    t.condition_id,
    g.question,
    g.description,
    t.shares,
    t.entry_price
FROM default.trades_raw t
LEFT JOIN default.gamma_markets g
    ON t.condition_id = g.condition_id
WHERE t.wallet = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e'
```

### ID Normalization Rules

**Critical:** condition_id format varies by table:
- `trades_raw`: May have or lack `0x` prefix
- `gamma_markets`: Has `0x` prefix
- `dim_markets`: Uses `condition_id_norm` (no prefix, lowercase)

**Normalize before joining:**
```sql
lower(replaceAll(condition_id, '0x', '')) AS condition_id_norm
```

---

## 4. Example: Finding the "Egg Market"

### Target Market Discovery

**UI Shows:** "Will a dozen eggs be below $4.50 in May?" → Won $41,289

**Database Query:**
```sql
-- Step 1: Find market
SELECT condition_id, question, volume, closed
FROM default.gamma_markets
WHERE question LIKE '%egg%'
  AND question LIKE '%May%'
  AND question LIKE '%4.50%';

-- Results:
condition_id: 0xee3a389d0c1345900a200d0d11d241bd30bc05a6c761d69b741a967bf98830d2
question: Will a dozen eggs be below $4.50 in May?
volume: $187,223
closed: 1

-- Step 2: Get wallet's trades (via system wallet)
SELECT
    COUNT(*) as trades,
    SUM(cashflow_usdc) as volume,
    SUM(shares) as total_shares
FROM default.trades_raw
WHERE wallet = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e'  -- System wallet!
  AND condition_id = '0xee3a389d0c1345900a200d0d11d241bd30bc05a6c761d69b741a967bf98830d2';

-- Step 3: Get P&L
SELECT realized_pnl_usd
FROM default.realized_pnl_by_market_final
WHERE wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'  -- User wallet
  AND condition_id_norm = 'ee3a389d0c1345900a200d0d11d241bd30bc05a6c761d69b741a967bf98830d2';
```

---

## 5. Other Market Resolution Tables

### `default.market_resolutions_final` (218,325 resolutions)
**Purpose:** Resolved market outcomes with payout vectors

**Columns:**
- `condition_id_norm` - Market ID
- `payout_numerators` - Array [1, 0] for binary markets
- `payout_denominator` - Usually 1
- `winning_outcome` - "Yes"/"No"
- `winning_index` - 0 or 1
- `resolved_at` - Resolution timestamp

### `default.market_key_map` (156,952 mappings)
**Purpose:** Market slug → condition_id lookup

**Example:**
```sql
SELECT condition_id, question
FROM default.market_key_map
WHERE market_id = 'will-a-dozen-eggs-be-below-4pt50-in-may';
```

---

## 6. Wallet-Related Tables

### Additional Wallet Tracking Tables:

1. **`default.wallet_metrics_daily`** (14M rows) - Daily wallet stats
2. **`default.wallet_pnl_summary_final`** (935K rows) - Per-wallet P&L totals
3. **`default.wallets_dim`** (996K rows) - Wallet dimension table
4. **`default.wallet_metrics_complete`** (1M rows) - Comprehensive metrics
5. **`cascadian_clean.system_wallets`** (1 row) - Known system wallet list

---

## 7. Working Example: Get P&L for Egg Market

```typescript
import { clickhouse } from './lib/clickhouse/client';

const USER_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const SYSTEM_WALLET = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e';

async function getEggMarketPnL() {
  // Step 1: Find egg market
  const market = await clickhouse.query({
    query: `
      SELECT condition_id, question, volume
      FROM default.gamma_markets
      WHERE question LIKE '%egg%'
        AND question LIKE '%May%'
        AND question LIKE '%4.50%'
        AND question LIKE '%below%'
    `,
    format: 'JSONEachRow'
  });

  const marketData = await market.json();
  const cid = marketData[0].condition_id;
  const cidNorm = cid.toLowerCase().replace('0x', '');

  // Step 2: Get trades (using SYSTEM wallet)
  const trades = await clickhouse.query({
    query: `
      SELECT
        block_time,
        side,
        shares,
        entry_price,
        cashflow_usdc
      FROM default.trades_raw
      WHERE wallet = '${SYSTEM_WALLET}'
        AND condition_id = '${cid}'
      ORDER BY block_time ASC
    `,
    format: 'JSONEachRow'
  });

  const tradeData = await trades.json();

  // Step 3: Get P&L (using USER wallet)
  const pnl = await clickhouse.query({
    query: `
      SELECT realized_pnl_usd
      FROM default.realized_pnl_by_market_final
      WHERE wallet = '${USER_WALLET}'
        AND condition_id_norm = '${cidNorm}'
    `,
    format: 'JSONEachRow'
  });

  const pnlData = await pnl.json();

  return {
    market: marketData[0].question,
    trades: tradeData,
    pnl: pnlData[0]?.realized_pnl_usd || 0
  };
}
```

---

## 8. Key Learnings

### Critical Insights:

1. **Wallet Proxy System**
   - ALWAYS query `system_wallet_map` first
   - Use system_wallet for trade queries
   - Use user_wallet for P&L queries

2. **ID Normalization**
   - Strip `0x` prefix for joins
   - Lowercase for consistency
   - Expect 64 characters

3. **Market Metadata Hierarchy**
   - `gamma_markets` → Best human-readable data
   - `api_markets_staging` → Most current data
   - `dim_markets` → Best for analytics

4. **Trade Attribution**
   - Trades in `trades_raw` use system_wallet
   - P&L in `realized_pnl_by_market_final` uses user_wallet
   - Must map between them for accurate attribution

### Data Quality Notes:

- Not all markets have titles in `gamma_markets` (some show "Unknown")
- Some markets exist in API but not in gamma feed
- P&L calculations depend on resolution data being populated

---

## 9. Recommended Queries for UI

### Get Wallet's Top Markets:
```sql
SELECT
    p.condition_id_norm,
    g.question,
    p.realized_pnl_usd,
    g.volume
FROM default.realized_pnl_by_market_final p
LEFT JOIN default.gamma_markets g
    ON p.condition_id_norm = lower(replaceAll(g.condition_id, '0x', ''))
WHERE p.wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
ORDER BY p.realized_pnl_usd DESC
LIMIT 20;
```

### Search Markets by Keyword:
```sql
SELECT
    condition_id,
    question,
    volume,
    closed,
    end_date
FROM default.gamma_markets
WHERE question LIKE '%trump%'
ORDER BY volume DESC
LIMIT 50;
```

### Get Market Details:
```sql
SELECT
    g.question,
    g.description,
    g.outcomes_json,
    g.volume,
    r.winning_outcome,
    r.resolved_at
FROM default.gamma_markets g
LEFT JOIN default.market_resolutions_final r
    ON lower(replaceAll(g.condition_id, '0x', '')) = r.condition_id_norm
WHERE g.condition_id = '0xee3a389d0c1345900a200d0d11d241bd30bc05a6c761d69b741a967bf98830d2';
```

---

## 10. Next Steps

### To Fix P&L Discrepancy:

1. Verify system wallet mapping is complete
2. Recalculate P&L using system wallet trades
3. Cross-reference with Polymarket API
4. Check for missing resolution data

### To Improve Search:

1. Build full-text search index on `question` field
2. Create materialized view joining trades + market names
3. Add event-based categorization
4. Implement fuzzy matching for market discovery

---

## Files Generated

- `/Users/scotty/Projects/Cascadian-app/investigate-market-tables.ts`
- `/Users/scotty/Projects/Cascadian-app/investigate-wallet-egg-market.ts`
- `/Users/scotty/Projects/Cascadian-app/investigate-wallet-mapping.ts`
- `/Users/scotty/Projects/Cascadian-app/final-wallet-investigation.ts`
- `/Users/scotty/Projects/Cascadian-app/WALLET_MAPPING_REPORT.md`

---

**Report Generated:** 2025-11-10
**Investigation Time:** 30 minutes
**Status:** Complete ✓
