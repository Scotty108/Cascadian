# Polymarket Trading Analytics: Technical Analysis

## Current State vs. Target State

### Table Schema Comparison

#### Target Schema (ChatGPT's Plan)

```sql
-- 1. Proxy Wallets (EOA → Proxy mapping)
CREATE TABLE pm_user_proxy_wallets (
  user_eoa          String,
  proxy_wallet      String PRIMARY KEY,
  source            String,  -- 'approval' or 'inferred'
  first_seen_block  UInt32,
  last_seen_block   UInt32
);

-- 2. Flattened ERC1155 Transfers
CREATE TABLE pm_erc1155_flats (
  tx_hash       String,
  log_index     UInt32,
  block_number  UInt32,
  block_time    DateTime,
  operator      String,
  from_addr     String,
  to_addr       String,
  token_id      String,
  amount        String,
  PRIMARY KEY (tx_hash, log_index)
);

-- 3. Token ID → Market Mapping
CREATE TABLE pm_tokenid_market_map (
  token_id       String PRIMARY KEY,
  market_id      String,
  outcome_id     String,
  outcome_label  String,
  event_id       String
);

-- 4. CLOB Fills (Trading Executions)
CREATE TABLE pm_trades (
  fill_id         String PRIMARY KEY,  -- Unique from CLOB API
  tx_hash         String,
  wallet          String,  -- proxy_wallet
  market_id       String,
  outcome_id      String,
  side            String,  -- 'buy' or 'sell'
  price           Decimal,
  size            Decimal,
  fee             Decimal,
  ts              DateTime
);

-- 5. Wallet Positions (Computed)
CREATE TABLE pm_wallet_positions (
  wallet          String,
  market_id       String,
  outcome_id      String,
  net_position    Decimal,
  avg_cost_basis  Decimal,
  realized_pnl    Decimal,
  fees_paid       Decimal,
  PRIMARY KEY (wallet, market_id, outcome_id)
);

-- 6. Funding Flows (USDC deposits/withdrawals only)
CREATE TABLE pm_wallet_funding (
  wallet            String PRIMARY KEY,
  total_deposits    Decimal,
  total_withdrawals Decimal,
  net_funding       Decimal
);
```

#### Current Schema (Actual Implementation)

```sql
-- 1. pm_user_proxy_wallets ✅ MOSTLY CORRECT
CREATE TABLE pm_user_proxy_wallets (
  user_eoa         LowCardinality(String),  -- ✅
  proxy_wallet     String,                   -- ✅
  source           LowCardinality(String) DEFAULT 'onchain',  -- ⚠️ Should be 'approval' or 'inferred'
  first_seen_block UInt32,                   -- ✅
  last_seen_block  UInt32,                   -- ✅
  first_seen_at    DateTime,                 -- ➕ Extra (good)
  last_seen_at     DateTime DEFAULT now(),   -- ➕ Extra (good)
  is_active        UInt8 DEFAULT 1           -- ➕ Extra (tracks revocations)
)
ENGINE = ReplacingMergeTree()  -- ✅ Good for dedup
PRIMARY KEY (proxy_wallet)
ORDER BY (proxy_wallet);

-- 2. pm_erc1155_flats ⚠️ INCOMPLETE
CREATE TABLE pm_erc1155_flats (
  block_number  UInt32,        -- ✅
  block_time    DateTime,      -- ✅
  tx_hash       String,        -- ✅
  log_index     UInt32,        -- ✅
  operator      String,        -- ✅
  from_addr     String,        -- ✅
  to_addr       String,        -- ✅
  token_id      String,        -- ✅
  amount        String         -- ✅
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(block_time)  -- ✅ Good partitioning
ORDER BY (block_number, tx_hash, log_index);

-- ❌ CRITICAL ISSUE: TransferBatch rows have token_id='0x' and amount='0x' (placeholders)

-- 3. pm_tokenid_market_map ✅ CORRECT
CREATE TABLE pm_tokenid_market_map (
  token_id       String,        -- ✅
  market_id      LowCardinality(String),  -- ✅
  outcome_index  UInt8,         -- ✅
  outcome_label  String,        -- ✅
  condition_id   String,        -- ➕ Extra (good)
  market_title   String,        -- ➕ Extra (good)
  source         LowCardinality(String) DEFAULT 'gamma_api'  -- ➕ Extra (good)
)
ENGINE = ReplacingMergeTree()
PRIMARY KEY (token_id)
ORDER BY (token_id);

-- 4. pm_trades ⚠️ INCOMPLETE
CREATE TABLE pm_trades (
  proxy_wallet     String,       -- ✅
  market_id        String,       -- ✅
  outcome          String,       -- ⚠️ Should be outcome_id, not label
  side             LowCardinality(String),  -- ✅
  shares           String,       -- ⚠️ Should be Decimal128(10)
  execution_price  Decimal128(10),  -- ✅
  fee              String,       -- ⚠️ Should be Decimal128(10), currently hardcoded "0"
  ts               DateTime,     -- ✅
  tx_hash          String,       -- ✅
  order_hash       String,       -- ✅
  source           LowCardinality(String) DEFAULT 'clob_api'  -- ✅
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (proxy_wallet, ts, tx_hash);

-- ❌ MISSING: fill_id (unique identifier for dedup)
-- ❌ MISSING: Primary key on fill_id for upsert logic
-- ⚠️ No ReplacingMergeTree, may duplicate fills on re-runs

-- 5. pm_wallet_positions ❌ DOES NOT EXIST
-- Current: Only in-memory aggregation in build-positions-from-erc1155.ts

-- 6. pm_wallet_funding ❌ DOES NOT EXIST
-- Current: Queried ad-hoc in validate-three.ts
```

---

## Data Flow Analysis

### Current Flow (Partial)

```
┌─────────────────────────────────────────────────────────────────┐
│ SOURCE DATA (ClickHouse)                                        │
├─────────────────────────────────────────────────────────────────┤
│ erc1155_transfers (TransferSingle + TransferBatch)              │
│ erc20_transfers (USDC deposits/withdrawals)                     │
└──────────────────┬──────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 1: Flatten ERC1155                                         │
│ Script: flatten-erc1155.ts                                      │
├─────────────────────────────────────────────────────────────────┤
│ ✅ TransferSingle: Decode token_id + amount from data          │
│ ❌ TransferBatch: BROKEN - stores placeholder 0x values        │
│                                                                  │
│ Output: pm_erc1155_flats                                        │
└──────────────────┬──────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 2: Build Proxy Mapping                                     │
│ Script: build-approval-proxies.ts                               │
├─────────────────────────────────────────────────────────────────┤
│ ✅ Extract ApprovalForAll events                               │
│ ✅ Decode EOA and proxy from topics                            │
│ ❌ MISSING: Fallback inference from operator→EOA               │
│                                                                  │
│ Output: pm_user_proxy_wallets                                   │
└──────────────────┬──────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 3: Build Token Mapping                                     │
│ Script: map-tokenid-to-market.ts                                │
├─────────────────────────────────────────────────────────────────┤
│ ✅ Fetch markets from Gamma API                                │
│ ✅ Derive token IDs from condition ID                          │
│ ⚠️ May miss markets not in Gamma                               │
│                                                                  │
│ Output: pm_tokenid_market_map                                   │
└──────────────────┬──────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 4: Ingest CLOB Fills                                       │
│ Script: ingest-clob-fills.ts                                    │
├─────────────────────────────────────────────────────────────────┤
│ ⚠️ Fetches only first 1000 fills per wallet (no pagination)   │
│ ⚠️ Hardcodes fee to "0"                                        │
│ ❌ No exponential backoff for rate limits                      │
│ ❌ No resume checkpoints                                        │
│ ❌ No deduplication (may insert duplicates)                    │
│                                                                  │
│ Output: pm_trades                                               │
└──────────────────┬──────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 5: Build Positions (IN-MEMORY ONLY)                        │
│ Script: build-positions-from-erc1155.ts                         │
├─────────────────────────────────────────────────────────────────┤
│ ✅ Join pm_erc1155_flats + pm_tokenid_market_map               │
│ ✅ Aggregate by proxy + token_id                               │
│ ❌ NO PERSISTENT TABLE - just console output                   │
│ ❌ No PnL calculation                                           │
│                                                                  │
│ Output: NONE (console only)                                     │
└──────────────────┬──────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────────┐
│ STEP 6: Validate Known Wallets                                  │
│ Script: validate-three.ts                                       │
├─────────────────────────────────────────────────────────────────┤
│ ✅ Resolve proxy via API                                       │
│ ✅ Count trades from pm_trades                                 │
│ ⚠️ Query USDC flows ad-hoc (not from table)                   │
│ ⚠️ No PnL comparison                                           │
│ ⚠️ No volume comparison                                        │
│                                                                  │
│ Output: Console validation report                               │
└─────────────────────────────────────────────────────────────────┘
```

### Target Flow (Complete)

```
┌─────────────────────────────────────────────────────────────────┐
│ SOURCE DATA (ClickHouse)                                        │
├─────────────────────────────────────────────────────────────────┤
│ erc1155_transfers (ALL events decoded properly)                 │
│ erc20_transfers (USDC only for funding)                         │
└──────────────────┬──────────────────────────────────────────────┘
                   │
                   ▼
         ┌─────────┴─────────┐
         │                   │
         ▼                   ▼
┌───────────────┐   ┌───────────────┐
│ Flatten       │   │ Build Proxy   │
│ ERC1155       │   │ Mapping       │
│               │   │               │
│ ✅ Singles   │   │ ✅ Approvals │
│ ✅ Batches   │   │ ✅ Fallback  │
└───────┬───────┘   └───────┬───────┘
        │                   │
        │      ┌────────────┘
        │      │
        ▼      ▼
┌───────────────────────┐
│ Build Token Mapping   │
│ (Gamma + CLOB APIs)   │
└───────┬───────────────┘
        │
        ▼
┌───────────────────────┐
│ Ingest CLOB Fills     │
│ ✅ Full pagination   │
│ ✅ Backoff & retry   │
│ ✅ Checkpoints       │
│ ✅ Deduplication     │
└───────┬───────────────┘
        │
        ▼
┌───────────────────────┐
│ Compute Positions     │
│ & PnL                 │
│ ✅ Persistent table  │
│ ✅ Realized PnL      │
│ ✅ Unrealized PnL    │
└───────┬───────────────┘
        │
        ▼
┌───────────────────────┐
│ Separate Funding      │
│ Flows                 │
│ ✅ USDC in/out       │
│ ✅ Not trade volume  │
└───────┬───────────────┘
        │
        ▼
┌───────────────────────┐
│ Quality Gates         │
│ ✅ Data validation   │
│ ✅ Coverage checks   │
└───────┬───────────────┘
        │
        ▼
┌───────────────────────┐
│ Validate Known        │
│ Wallets               │
│ ✅ 100% accuracy     │
└───────────────────────┘
```

---

## Critical Gaps Analysis

### Gap 1: TransferBatch Decoding 🔥 CRITICAL

**Current Code** (`flatten-erc1155.ts` lines 169-186):
```typescript
for await (const raw of batchReader) {
  const row = JSON.parse(raw.toString("utf8"));

  // ❌ BROKEN: Stores placeholders instead of decoding
  batchBatch.push({
    block_number: row.block_number,
    block_time: row.block_time,
    tx_hash: row.tx_hash,
    log_index: row.log_index,
    operator: row.operator,
    from_addr: row.from_addr,
    to_addr: row.to_addr,
    token_id: "0x",    // ❌ PLACEHOLDER
    amount: "0x",      // ❌ PLACEHOLDER
  });
}
```

**Required Fix**:
```typescript
import { Interface } from 'ethers';

const ERC1155_ABI = [
  'event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)'
];
const iface = new Interface(ERC1155_ABI);

for await (const raw of batchReader) {
  const row = JSON.parse(raw.toString("utf8"));

  // ✅ Decode ABI
  const decoded = iface.parseLog({
    topics: [
      '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb',  // event signature
      row.topics[1],  // operator
      row.topics[2],  // from
      row.topics[3],  // to
    ],
    data: row.data
  });

  const ids = decoded.args.ids;      // uint256[]
  const values = decoded.args.values; // uint256[]

  // ✅ Create one row per id/value pair
  for (let i = 0; i < ids.length; i++) {
    batchBatch.push({
      block_number: row.block_number,
      block_time: row.block_time,
      tx_hash: row.tx_hash,
      log_index: row.log_index,
      operator: row.operator,
      from_addr: row.from_addr,
      to_addr: row.to_addr,
      token_id: '0x' + ids[i].toString(16).padStart(64, '0'),
      amount: '0x' + values[i].toString(16).padStart(64, '0'),
    });
  }
}
```

**Impact**: Without this fix, all multi-token transfers are lost (unknown % of total volume)

---

### Gap 2: CLOB Fills Pagination 🔥 CRITICAL

**Current Code** (`ingest-clob-fills.ts` line 114):
```typescript
const fills = await fetchFillsForWallet(proxy, 10000);
```

**Problem**: `fetchFillsForWallet` function (lines 27-49):
- Only calls API once with `limit=10000`
- No pagination loop
- If wallet has >10k fills, we miss them all

**Required Fix**:
```typescript
async function fetchAllFillsForWallet(wallet: string): Promise<ClobFill[]> {
  const allFills: ClobFill[] = [];
  let nextCursor: string | null = null;
  let page = 0;

  do {
    try {
      const url = `${CLOB_API}/trades?trader=${wallet}&limit=1000${
        nextCursor ? `&cursor=${nextCursor}` : ''
      }`;

      // Exponential backoff retry
      let retries = 0;
      let response;

      while (retries < 5) {
        response = await fetch(url);

        if (response.status === 429) {
          const delay = Math.min(1000 * Math.pow(2, retries), 30000);
          console.log(`Rate limited on ${wallet}, retry in ${delay}ms`);
          await sleep(delay);
          retries++;
          continue;
        }

        if (response.ok) break;

        retries++;
        await sleep(500 * retries);
      }

      if (!response.ok) {
        console.log(`Failed to fetch fills for ${wallet} after retries`);
        break;
      }

      const data = await response.json();
      const fills = data.data || [];
      allFills.push(...fills);

      nextCursor = data.next_cursor || null;
      page++;

      console.log(`  Page ${page}: ${fills.length} fills, total: ${allFills.length}`);

      // Rate limit between pages
      await sleep(200);

    } catch (e) {
      console.log(`Error fetching fills for ${wallet}:`, e.message);
      break;
    }
  } while (nextCursor);

  return allFills;
}
```

**Impact**: HolyMoses7 likely has 2000+ fills, we're only getting first 1000

---

### Gap 3: Fill Deduplication ⚠️ HIGH

**Current Code** (`ingest-clob-fills.ts` line 134):
```typescript
await ch.insert({
  table: "pm_trades",
  values: batch,
  format: "JSONEachRow",
});
```

**Problem**:
- Uses `INSERT` not `UPSERT`
- No unique constraint
- Re-running script will create duplicates

**Required Fix**:
```sql
-- Change table engine
CREATE TABLE pm_trades (
  fill_id          String,  -- ADD: Unique ID from CLOB API
  proxy_wallet     String,
  market_id        String,
  outcome_id       String,
  side             LowCardinality(String),
  shares           Decimal128(10),
  execution_price  Decimal128(10),
  fee_paid         Decimal128(10),
  ts               DateTime,
  tx_hash          String,
  order_hash       String,
  source           LowCardinality(String) DEFAULT 'clob_api'
)
ENGINE = ReplacingMergeTree(ts)  -- Use ReplacingMergeTree
PRIMARY KEY (fill_id)
ORDER BY (fill_id, ts);
```

```typescript
// Add fill_id to inserts
batch.push({
  fill_id: fill.id,  // ✅ From CLOB API response
  proxy_wallet: proxy,
  market_id: fill.market || fill.outcome,
  outcome_id: fill.outcome,
  side: fill.side === 'BUY' ? 'buy' : 'sell',
  shares: parseFloat(fill.size),
  execution_price: parseFloat(fill.price),
  fee_paid: parseFloat(fill.fee || '0'),
  ts: new Date(fill.timestamp * 1000).toISOString(),
  tx_hash: fill.transactionHash,
  order_hash: fill.orderHash,
  source: 'clob_api',
});
```

**Impact**: Current runs may have duplicates, skewing volume metrics

---

### Gap 4: Missing Positions Table ⚠️ HIGH

**Current State**: `build-positions-from-erc1155.ts` only prints to console

**Required**: Create persistent table with PnL

```sql
CREATE TABLE pm_wallet_positions (
  proxy_wallet      String,
  market_id         String,
  outcome_id        String,
  token_id          String,

  -- Position quantities
  total_bought      Decimal128(10),
  total_sold        Decimal128(10),
  net_position      Decimal128(10),

  -- Cost basis
  total_cost        Decimal128(10),
  avg_buy_price     Decimal128(10),
  avg_sell_price    Decimal128(10),

  -- Realized PnL
  realized_pnl      Decimal128(10),
  fees_paid         Decimal128(10),

  -- Unrealized PnL
  current_price     Decimal128(10),
  unrealized_pnl    Decimal128(10),

  -- Metadata
  first_trade_ts    DateTime,
  last_trade_ts     DateTime,
  is_open           UInt8,

  updated_at        DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
PRIMARY KEY (proxy_wallet, market_id, outcome_id)
ORDER BY (proxy_wallet, market_id, outcome_id, updated_at);
```

**Population Query**:
```sql
INSERT INTO pm_wallet_positions
SELECT
  p.proxy_wallet,
  m.market_id,
  m.outcome_id,
  e.token_id,

  -- Quantities from ERC1155
  sumIf(CAST(e.amount AS Decimal128(10)), e.to_addr = p.proxy_wallet) AS total_bought,
  sumIf(CAST(e.amount AS Decimal128(10)), e.from_addr = p.proxy_wallet) AS total_sold,
  total_bought - total_sold AS net_position,

  -- Prices from CLOB fills
  sumIf(t.execution_price * t.shares, t.side = 'buy') AS total_cost,
  avgIf(t.execution_price, t.side = 'buy') AS avg_buy_price,
  avgIf(t.execution_price, t.side = 'sell') AS avg_sell_price,

  -- Realized PnL: (sell_price - avg_buy_price) * shares_sold
  sumIf((t.execution_price - avg_buy_price) * t.shares, t.side = 'sell') AS realized_pnl,
  sum(t.fee_paid) AS fees_paid,

  -- Unrealized PnL (requires current price - TODO)
  0 AS current_price,
  0 AS unrealized_pnl,

  min(e.block_time) AS first_trade_ts,
  max(e.block_time) AS last_trade_ts,
  if(net_position != 0, 1, 0) AS is_open,

  now() AS updated_at

FROM pm_erc1155_flats e
JOIN pm_user_proxy_wallets p
  ON (e.to_addr = p.proxy_wallet OR e.from_addr = p.proxy_wallet)
JOIN pm_tokenid_market_map m
  ON e.token_id = m.token_id
LEFT JOIN pm_trades t
  ON t.proxy_wallet = p.proxy_wallet
  AND t.outcome_id = m.outcome_id

GROUP BY proxy_wallet, market_id, outcome_id, token_id;
```

**Impact**: Can't validate PnL accuracy without this table

---

### Gap 5: Funding Flow Separation ⚠️ MEDIUM

**Current**: USDC flows queried ad-hoc in `validate-three.ts` (lines 88-113)

**Required**: Separate table to distinguish deposits from trading

```sql
CREATE TABLE pm_wallet_funding (
  proxy_wallet        String,
  total_deposits      Decimal128(10),
  total_withdrawals   Decimal128(10),
  net_funding         Decimal128(10),
  deposit_count       UInt32,
  withdrawal_count    UInt32,
  first_deposit_ts    DateTime,
  last_activity_ts    DateTime
)
ENGINE = ReplacingMergeTree(last_activity_ts)
PRIMARY KEY (proxy_wallet)
ORDER BY (proxy_wallet, last_activity_ts);

-- Populate
INSERT INTO pm_wallet_funding
SELECT
  proxy_wallet,
  sumIf(CAST(value AS Decimal128(10)) / 1e6, to_address = proxy_wallet) AS total_deposits,
  sumIf(CAST(value AS Decimal128(10)) / 1e6, from_address = proxy_wallet) AS total_withdrawals,
  total_deposits - total_withdrawals AS net_funding,
  countIf(to_address = proxy_wallet) AS deposit_count,
  countIf(from_address = proxy_wallet) AS withdrawal_count,
  minIf(block_time, to_address = proxy_wallet) AS first_deposit_ts,
  max(block_time) AS last_activity_ts
FROM erc20_transfers
WHERE lower(contract) = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174'  -- USDC
  AND (
    lower(to_address) IN (SELECT proxy_wallet FROM pm_user_proxy_wallets)
    OR lower(from_address) IN (SELECT proxy_wallet FROM pm_user_proxy_wallets)
  )
GROUP BY proxy_wallet;
```

**Impact**: Can compare trading PnL vs funding to detect discrepancies

---

## Validation Strategy

### Known Wallet Test Matrix

| Wallet | EOA | Expected Trades | Min Acceptable (70%) | Polymarket Profile |
|--------|-----|-----------------|---------------------|-------------------|
| HolyMoses7 | `0xa4b366...87b8` | 2,182 | 1,527 | [Link](https://polymarket.com/profile/0xa4b366ad22fc0d06f1e934ff468e8922431a87b8) |
| niggemon | `0xeb6f0a...25f0` | 1,087 | 761 | [Link](https://polymarket.com/profile/0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0) |
| Wallet3 | `0xcce2b7...58b` | 0 | 0 | [Link](https://polymarket.com/profile/0xcce2b7c71f21e358b8e5e797e586cbc03160d58b) |

### Validation Queries

```sql
-- 1. Resolve proxy for HolyMoses7
SELECT proxy_wallet
FROM pm_user_proxy_wallets
WHERE lower(user_eoa) = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8';
-- Expected: Should return exactly 1 proxy

-- 2. Count trades for HolyMoses7 proxy
SELECT count(*) AS trade_count
FROM pm_trades
WHERE proxy_wallet = '<proxy_from_step_1>';
-- Expected: >= 1527 (target: ~2182)

-- 3. Calculate PnL for HolyMoses7
SELECT
  sum(realized_pnl) AS total_realized_pnl,
  sum(unrealized_pnl) AS total_unrealized_pnl,
  sum(fees_paid) AS total_fees
FROM pm_wallet_positions
WHERE proxy_wallet = '<proxy_from_step_1>';
-- Expected: Within 5% of Polymarket profile

-- 4. Check funding flow for HolyMoses7
SELECT
  total_deposits,
  total_withdrawals,
  net_funding
FROM pm_wallet_funding
WHERE proxy_wallet = '<proxy_from_step_1>';
-- Expected: net_funding should NOT equal trading volume
```

---

## Performance Considerations

### ClickHouse Query Optimization

1. **Partition Pruning**: Use `toYYYYMM(block_time)` partitioning
2. **Index Usage**: Ensure queries filter on PRIMARY KEY columns first
3. **Join Order**: Always filter small tables first (proxies, then trades, then transfers)

### Estimated Data Volumes

```
erc1155_transfers:        ~50M rows (assuming 10M markets × 5 transfers avg)
erc20_transfers:          388M rows (USDC only, given)
pm_user_proxy_wallets:    ~100K rows (unique proxies)
pm_tokenid_market_map:    ~20K rows (10K markets × 2 outcomes avg)
pm_trades:                ~10M rows (fills from CLOB API)
pm_erc1155_flats:         ~50M rows (flattened transfers)
pm_wallet_positions:      ~1M rows (active positions)
pm_wallet_funding:        ~100K rows (wallets with deposits)
```

### Expected Query Times

- Proxy lookup: <10ms (indexed on proxy_wallet)
- Trade count for wallet: <100ms (partitioned by ts, filtered by proxy)
- Position aggregation: <500ms (join 3 tables, aggregated)
- Full validation run: ~30s (3 wallets × 10s each)

---

## API Dependency Analysis

### Gamma API
- **Endpoint**: `https://gamma-api.polymarket.com/markets`
- **Rate Limit**: Unknown (appears unlimited)
- **Response**: Market metadata (condition_id, outcomes, title)
- **Reliability**: High (stable API)
- **Fallback**: CLOB markets endpoint

### CLOB API
- **Endpoint**: `https://clob.polymarket.com/trades`
- **Rate Limit**: Unknown ⚠️ (must test)
- **Authentication**: None for read operations
- **Pagination**: Cursor-based (assumed, needs verification)
- **Reliability**: Medium (may rate limit)
- **Fallback**: None (critical dependency)

### Strapi API (Proxy Resolution)
- **Endpoint**: `https://strapi-matic.poly.market/user/trades`
- **Rate Limit**: Unknown
- **Response**: `proxyWallet` field
- **Reliability**: Medium
- **Fallback**: On-chain ApprovalForAll events (already implemented)

---

## Risk Mitigation

### Risk Matrix

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| CLOB API rate limits | 🔴 High | 🟡 Medium | Exponential backoff, checkpoints |
| TransferBatch decoding fails | 🔴 High | 🟢 Low | Test on small sample first |
| Token mapping incomplete | 🟡 Medium | 🟡 Medium | Add CLOB markets fallback |
| Proxy resolution gaps | 🟡 Medium | 🟡 Medium | Add operator→EOA inference |
| PnL calculation errors | 🟡 Medium | 🟢 Low | Validate against known wallets |

### Rollback Plan

If Phase 1 fails:
1. Keep existing `pm_erc1155_flats` with TransferSingle only
2. Document coverage gap (missing TransferBatch)
3. Proceed with validation at reduced accuracy

If Phase 2 fails (CLOB API):
1. Use smaller sample of proxies (top 1000)
2. Document coverage as "partial"
3. Target 50% accuracy instead of 70%

---

## Success Criteria

### P0 Must-Haves
- ✅ HolyMoses7: >= 1527 trades (70% of 2182)
- ✅ niggemon: >= 761 trades (70% of 1087)
- ✅ Wallet3: exactly 0 trades
- ✅ No TransferBatch rows with `token_id='0x'`
- ✅ All proxies have EOA mapping

### P1 Should-Haves
- ✅ HolyMoses7: >= 1964 trades (90% of 2182)
- ✅ niggemon: >= 978 trades (90% of 1087)
- ✅ PnL within 5% of Polymarket profile
- ✅ Token mapping coverage >= 80%

### P2 Nice-to-Haves
- ✅ HolyMoses7: 2182 trades (100%)
- ✅ niggemon: 1087 trades (100%)
- ✅ PnL within 1% of Polymarket profile
- ✅ All environment variables configured
- ✅ Resume checkpoints work

---

## Next Actions

### Immediate (Today)
1. Install ethers: `npm install ethers`
2. Create `scripts/find-ct-address.ts`
3. Fix TransferBatch in `scripts/flatten-erc1155.ts`
4. Test on small batch (100 rows)

### Tomorrow Morning
5. Fix CLOB pagination in `scripts/ingest-clob-fills.ts`
6. Add deduplication (fill_id primary key)
7. Run full ingestion for 3 known wallets

### Tomorrow Afternoon
8. Create `scripts/build-positions.ts` with PnL table
9. Enhance `scripts/validate-known-wallets.ts`
10. Run final validation

---

**Document Version**: 1.0
**Last Updated**: 2025-11-06
**Status**: Analysis Complete, Ready for Implementation
