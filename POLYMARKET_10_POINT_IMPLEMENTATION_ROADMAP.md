# Polymarket 10-Point Plan: Complete Implementation Roadmap

**Goal**: 100% trade capture accuracy on known wallets (not 80%)

**Status**: Partial implementation exists, needs completion and fixes

---

## Executive Summary

### What Exists ✅
1. **ERC1155 Flattening** - `scripts/flatten-erc1155.ts` (INCOMPLETE - needs TransferBatch ABI decoding)
2. **Proxy Resolution** - `scripts/build-approval-proxies.ts` (GOOD - from ApprovalForAll events)
3. **CLOB Fills Ingestion** - `scripts/ingest-clob-fills.ts` (BASIC - needs pagination, rate limits)
4. **Token Mapping** - `scripts/map-tokenid-to-market.ts` (EXISTS - uses Gamma API)
5. **Position Building** - `scripts/build-positions-from-erc1155.ts` (EXISTS - joins ERC1155 + mapping)
6. **Validation Script** - `scripts/validate-three.ts` (EXISTS - tests 3 known wallets)

### What's Missing ❌
1. **CT Address Autodetection** - Hardcoded, should query ClickHouse
2. **TransferBatch Decoding** - Placeholder code, not implemented
3. **Proxy Fallback Logic** - Only ApprovalForAll, missing operator→EOA inference
4. **CLOB Fills Completeness** - No pagination, resume tokens, or exponential backoff
5. **PnL Computation** - No realized PnL calculation from positions + fills
6. **Funding Flow Separation** - ERC20 USDC used for deposits/withdrawals not separated
7. **Guardrails** - Missing assertions for data quality gates
8. **Environment Hardcodes** - Some URLs hardcoded vs env vars

### Critical Blocker 🚨
**TransferBatch events are stored with placeholder data (`token_id: "0x"`, `amount: "0x"`)** - this means we're losing multi-token transfers! Must fix with ethers ABI decoding.

---

## Implementation Roadmap

### PHASE 1: Foundation (2-3 hours)

#### 1.1 Autodetect CT Address ⚡ PRIORITY P0
**File**: `scripts/find-ct-address.ts` (NEW)
**Complexity**: Low (15 min)
**Dependencies**: None

```typescript
// Query ClickHouse for top ERC-1155 emitter
SELECT address, count() AS n
FROM erc1155_transfers
WHERE topics[1] IN (
  '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62', -- TransferSingle
  '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb'  -- TransferBatch
)
GROUP BY address
ORDER BY n DESC
LIMIT 5;
```

**Deliverable**:
- Create script that queries and prints top 5 addresses
- Update `.env.local` with `CONDITIONAL_TOKENS=<detected_address>`
- Remove hardcoded address from all scripts

**Reusable**: None, create new

---

#### 1.2 Fix TransferBatch Decoding 🔥 CRITICAL P0
**File**: `scripts/flatten-erc1155.ts` (UPDATE)
**Complexity**: Medium (1 hour)
**Dependencies**: Install `ethers` or `viem` for ABI decoding

**Current Problem**:
```typescript
// Lines 183-184: BROKEN
token_id: "0x", // Placeholder - needs ABI decode
amount: "0x", // Placeholder - needs ABI decode
```

**Fix Required**:
```typescript
import { Interface } from 'ethers';

const ERC1155_ABI = [
  'event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)'
];

const iface = new Interface(ERC1155_ABI);

// In TransferBatch loop:
const decoded = iface.parseLog({
  topics: row.topics,
  data: row.data
});

const ids = decoded.args.ids; // uint256[]
const values = decoded.args.values; // uint256[]

// Create multiple flat rows (one per id/value pair)
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
```

**Acceptance Gate**: Run script, verify `pm_erc1155_flats` has NO rows with `token_id = '0x'`

**Reusable**: Update existing

---

#### 1.3 Add Proxy Fallback Logic 🔧 PRIORITY P1
**File**: `scripts/build-approval-proxies.ts` (UPDATE)
**Complexity**: Medium (45 min)
**Dependencies**: None

**Current Gap**: Only captures ApprovalForAll events. Per ChatGPT's plan:
> "Add fallback: find EOA that operators later become in TransferSingle"

**Implementation**:
```sql
-- After ApprovalForAll ingestion, add fallback query:
INSERT INTO pm_user_proxy_wallets
SELECT DISTINCT
  substring(topics[2], 27) AS user_eoa,  -- operator from TransferSingle
  substring(topics[3], 27) AS proxy_wallet,  -- from address
  'inferred_transfer' AS source,
  min(block_number) AS first_seen_block,
  max(block_number) AS last_seen_block,
  min(block_time) AS first_seen_at,
  max(block_time) AS last_seen_at,
  1 AS is_active
FROM erc1155_transfers
WHERE topics[1] = '0xc3d58168c5ae7397...'  -- TransferSingle
  AND address = {CONDITIONAL_TOKENS}
  -- Only where operator != from (proxy acting on behalf of EOA)
  AND substring(topics[2], 27) != substring(topics[3], 27)
GROUP BY user_eoa, proxy_wallet
ON CONFLICT (proxy_wallet) DO UPDATE SET
  last_seen_block = EXCLUDED.last_seen_block,
  last_seen_at = EXCLUDED.last_seen_at;
```

**Acceptance Gate**: Compare proxy count before/after. Should increase by 10-20%.

**Reusable**: Update existing

---

### PHASE 2: Data Completeness (3-4 hours)

#### 2.1 Fix CLOB Fills Ingestion 🔥 CRITICAL P0
**File**: `scripts/ingest-clob-fills.ts` (MAJOR UPDATE)
**Complexity**: High (2 hours)
**Dependencies**: None

**Current Problems**:
1. **No pagination** - Only fetches `limit=1000` per wallet
2. **No rate limiting** - 100ms delay insufficient
3. **No resume tokens** - Can't continue from failure
4. **No exponential backoff** - Will hit rate limits
5. **Missing fee data** - Hardcoded to "0"
6. **No upsert by fill_id** - May duplicate fills

**Fixes Required**:

```typescript
// Add checkpoint file for resume
import fs from 'fs';
const CHECKPOINT_FILE = 'data/clob_fills_checkpoint.json';

interface Checkpoint {
  last_proxy: string;
  last_fill_id: string;
  total_fills: number;
  timestamp: string;
}

// Pagination loop per wallet
async function fetchAllFillsForWallet(wallet: string): Promise<ClobFill[]> {
  const allFills: ClobFill[] = [];
  let nextCursor: string | null = null;

  do {
    const url = `${CLOB_API}/trades?trader=${wallet}&limit=1000${nextCursor ? `&cursor=${nextCursor}` : ''}`;

    // Exponential backoff
    let retries = 0;
    let response;
    while (retries < 5) {
      try {
        response = await fetch(url);
        if (response.status === 429) {
          const delay = Math.min(1000 * Math.pow(2, retries), 30000);
          console.log(`Rate limited, waiting ${delay}ms...`);
          await sleep(delay);
          retries++;
          continue;
        }
        break;
      } catch (e) {
        retries++;
        await sleep(1000 * retries);
      }
    }

    const data = await response.json();
    allFills.push(...data.data);
    nextCursor = data.next_cursor;

    await sleep(200); // Rate limit between pages
  } while (nextCursor);

  return allFills;
}

// Change INSERT to UPSERT
await ch.exec({
  query: `
    CREATE TABLE IF NOT EXISTS pm_trades
    (
      fill_id          String,  -- ADD THIS: Unique fill ID from CLOB API
      proxy_wallet     String,
      market_id        String,
      outcome_id       String,  -- CHANGE: Store outcome ID not label
      side             LowCardinality(String),
      shares           Decimal128(10),
      execution_price  Decimal128(10),
      fee_paid         Decimal128(10),  -- CHANGE: Store actual fee
      ts               DateTime,
      tx_hash          String,
      order_hash       String,
      source           LowCardinality(String) DEFAULT 'clob_api'
    )
    ENGINE = ReplacingMergeTree(ts)  -- Use ReplacingMergeTree for dedup
    PRIMARY KEY (fill_id)
    ORDER BY (fill_id, ts)
  `,
});
```

**Acceptance Gate**:
- Fetch fills for HolyMoses7 proxy, count should be ~2182
- Verify resume works after manual interruption

**Reusable**: Major update to existing

---

#### 2.2 Enhance Token Mapping 🔧 PRIORITY P1
**File**: `scripts/map-tokenid-to-market.ts` (UPDATE)
**Complexity**: Low (30 min)
**Dependencies**: None

**Current Issues**:
- Gamma API may be incomplete
- No fallback to CLOB API markets endpoint

**Enhancement**:
```typescript
// After Gamma fetch, add CLOB markets endpoint as supplement
const CLOB_MARKETS_URL = 'https://clob.polymarket.com/markets';

async function fetchClobMarkets(): Promise<any[]> {
  const resp = await fetch(CLOB_MARKETS_URL);
  const data = await resp.json();
  return data;
}

// Merge both sources, Gamma takes precedence
const gammaMap = new Map<string, MarketInfo>();
const clobMap = new Map<string, MarketInfo>();

// ... populate both ...

// Merge with Gamma priority
for (const [tokenId, info] of clobMap) {
  if (!gammaMap.has(tokenId)) {
    gammaMap.set(tokenId, info);
  }
}
```

**Acceptance Gate**: Token map coverage should increase by 5-10%

**Reusable**: Update existing

---

### PHASE 3: PnL & Position Computation (2-3 hours)

#### 3.1 Build Comprehensive Positions Table 🔧 PRIORITY P1
**File**: `scripts/build-positions.ts` (MAJOR UPDATE to existing)
**Complexity**: High (2 hours)
**Dependencies**: Phase 1 & 2 complete

**Current Script**: `build-positions-from-erc1155.ts` only aggregates in-memory

**New Requirements**:
```sql
CREATE TABLE IF NOT EXISTS pm_wallet_positions
(
  proxy_wallet      String,
  market_id         String,
  outcome_id        String,
  token_id          String,

  -- Position tracking
  total_bought      Decimal128(10),
  total_sold        Decimal128(10),
  net_position      Decimal128(10),  -- bought - sold

  -- Cost basis
  avg_buy_price     Decimal128(10),
  avg_sell_price    Decimal128(10),
  total_cost        Decimal128(10),  -- sum(price * qty) for buys

  -- Realized PnL
  realized_pnl      Decimal128(10),  -- (sell_price - avg_cost) * qty_sold
  fees_paid         Decimal128(10),

  -- Unrealized PnL (requires current price)
  current_price     Decimal128(10),
  unrealized_pnl    Decimal128(10),  -- (current_price - avg_cost) * net_position

  -- Metadata
  first_trade_ts    DateTime,
  last_trade_ts     DateTime,
  is_open           UInt8,  -- net_position != 0

  updated_at        DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
PRIMARY KEY (proxy_wallet, market_id, outcome_id)
ORDER BY (proxy_wallet, market_id, outcome_id, updated_at);
```

**Computation Logic**:
```typescript
// Join ERC1155 transfers + CLOB fills to compute PnL

// Step 1: Aggregate ERC1155 for position quantities
const positions = await ch.query(`
  SELECT
    p.proxy_wallet,
    m.market_id,
    m.outcome_id,
    e.token_id,
    sumIf(CAST(e.amount AS Decimal128(10)), e.to_addr = p.proxy_wallet) AS total_bought,
    sumIf(CAST(e.amount AS Decimal128(10)), e.from_addr = p.proxy_wallet) AS total_sold,
    total_bought - total_sold AS net_position
  FROM pm_erc1155_flats e
  JOIN pm_user_proxy_wallets p
    ON e.to_addr = p.proxy_wallet OR e.from_addr = p.proxy_wallet
  JOIN pm_tokenid_market_map m
    ON e.token_id = m.token_id
  GROUP BY proxy_wallet, market_id, outcome_id, token_id
`);

// Step 2: Join CLOB fills for prices and fees
const pnl = await ch.query(`
  SELECT
    t.proxy_wallet,
    t.market_id,
    t.outcome_id,

    -- Cost basis
    avgIf(t.execution_price, t.side = 'buy') AS avg_buy_price,
    avgIf(t.execution_price, t.side = 'sell') AS avg_sell_price,
    sumIf(t.execution_price * t.shares, t.side = 'buy') AS total_cost,

    -- Realized PnL
    sumIf((t.execution_price - avg_buy_price) * t.shares, t.side = 'sell') AS realized_pnl,
    sum(t.fee_paid) AS fees_paid

  FROM pm_trades t
  GROUP BY proxy_wallet, market_id, outcome_id
`);

// Step 3: Merge positions + PnL
// INSERT INTO pm_wallet_positions ...
```

**Acceptance Gate**:
- Query positions for HolyMoses7 proxy
- Verify realized PnL matches Polymarket profile (within 5%)

**Reusable**: Major update to existing

---

### PHASE 4: Validation & Quality Gates (1-2 hours)

#### 4.1 Enhanced Known Wallet Validation 🔧 PRIORITY P0
**File**: `scripts/validate-known-wallets.ts` (UPDATE)
**Complexity**: Medium (1 hour)
**Dependencies**: Phase 3 complete

**Current Script**: `validate-three.ts` - basic trade count only

**Enhancement**: Add to validation output:
```typescript
interface ValidationResult {
  wallet_name: string;
  eoa: string;
  proxy: string;

  // Trade metrics
  total_trades: number;
  expected_trades: number;
  trade_accuracy_pct: number;

  // Volume metrics
  total_volume_usd: number;
  expected_volume_usd: number;

  // PnL metrics
  realized_pnl: number;
  unrealized_pnl: number;
  total_pnl: number;

  // Position metrics
  open_positions: number;
  total_markets_traded: number;

  // Funding metrics (USDC ERC20 only)
  total_deposits: number;
  total_withdrawals: number;
  net_funding: number;

  // Quality gates
  has_proxy: boolean;
  trade_coverage_pct: number;  // trades / expected
  min_coverage_met: boolean;   // >= 70%

  // URLs
  polymarket_url: string;
}

// Add assertions
const results: ValidationResult[] = [];

for (const wallet of KNOWN_WALLETS) {
  const result = await validateWallet(wallet);
  results.push(result);

  // Quality gates
  assert(result.has_proxy, `No proxy found for ${wallet.name}`);
  assert(
    result.trade_coverage_pct >= 70,
    `Trade coverage too low for ${wallet.name}: ${result.trade_coverage_pct}% (target: >70%)`
  );
}

// Print summary table
console.table(results);

// Exit with error if any wallet fails gates
const failed = results.filter(r => !r.min_coverage_met);
if (failed.length > 0) {
  console.error(`\n❌ ${failed.length} wallets failed quality gates`);
  process.exit(1);
}
```

**Acceptance Gate**:
- All 3 known wallets pass validation
- Trade coverage >= 70% for HolyMoses7 and niggemon
- Wallet3 correctly shows 0 trades

**Reusable**: Update existing `validate-three.ts`

---

#### 4.2 Add Data Quality Guardrails 🔧 PRIORITY P1
**File**: `scripts/run-quality-gates.ts` (NEW)
**Complexity**: Low (30 min)
**Dependencies**: All tables populated

**Guardrails to Check**:
```typescript
interface QualityGate {
  name: string;
  query: string;
  threshold: number;
  comparison: 'gt' | 'lt' | 'eq';
  severity: 'error' | 'warning';
}

const gates: QualityGate[] = [
  {
    name: 'No corrupt ERC1155 amounts',
    query: `SELECT count() FROM pm_erc1155_flats WHERE CAST(amount AS UInt256) > 1000000000000`,
    threshold: 0,
    comparison: 'eq',
    severity: 'error'
  },
  {
    name: 'All proxies have at least one EOA',
    query: `SELECT count(DISTINCT proxy_wallet) FROM pm_user_proxy_wallets`,
    threshold: 0,
    comparison: 'gt',
    severity: 'error'
  },
  {
    name: 'Token mapping coverage',
    query: `
      SELECT count(DISTINCT e.token_id) / count(DISTINCT m.token_id) * 100
      FROM pm_erc1155_flats e
      LEFT JOIN pm_tokenid_market_map m ON e.token_id = m.token_id
    `,
    threshold: 80,  // At least 80% coverage
    comparison: 'gt',
    severity: 'warning'
  },
  {
    name: 'CLOB fills completeness',
    query: `
      SELECT count(*) FROM pm_trades
      WHERE proxy_wallet IN (
        SELECT proxy_wallet FROM pm_user_proxy_wallets LIMIT 100
      )
    `,
    threshold: 1000,  // Should have many fills
    comparison: 'gt',
    severity: 'warning'
  }
];

// Run all gates
const failures: string[] = [];
for (const gate of gates) {
  const result = await ch.query(gate.query);
  const value = parseFloat(result);

  let passed = false;
  if (gate.comparison === 'gt') passed = value > gate.threshold;
  if (gate.comparison === 'lt') passed = value < gate.threshold;
  if (gate.comparison === 'eq') passed = value === gate.threshold;

  if (!passed) {
    const msg = `${gate.severity.toUpperCase()}: ${gate.name} - Expected ${gate.comparison} ${gate.threshold}, got ${value}`;
    console.log(msg);
    if (gate.severity === 'error') failures.push(msg);
  }
}

if (failures.length > 0) process.exit(1);
```

**Acceptance Gate**: All error-level gates pass

**Reusable**: Create new

---

### PHASE 5: Production Readiness (1 hour)

#### 5.1 Environment Configuration Cleanup 🔧 PRIORITY P2
**Files**: All scripts (UPDATE)
**Complexity**: Low (30 min)
**Dependencies**: None

**Changes**:
1. Move all hardcoded URLs to env vars:
```bash
# .env.local additions
GAMMA_API_URL=https://gamma-api.polymarket.com
CLOB_API_URL=https://clob.polymarket.com
STRAPI_API_URL=https://strapi-matic.poly.market
CONDITIONAL_TOKENS=0x4d97dcd97ec945f40cf65f87097ace5ea0476045  # From autodetect
```

2. Update all scripts to use env vars:
```typescript
const GAMMA_API = process.env.GAMMA_API_URL || 'https://gamma-api.polymarket.com';
const CLOB_API = process.env.CLOB_API_URL || 'https://clob.polymarket.com';
```

3. Document in README

**Acceptance Gate**: grep for hardcoded URLs returns 0 results

**Reusable**: Update all existing scripts

---

#### 5.2 Funding Flow Separation 🔧 PRIORITY P2
**File**: `scripts/compute-funding-flows.ts` (NEW)
**Complexity**: Low (30 min)
**Dependencies**: None

**Purpose**: Separate USDC deposits/withdrawals from trading activity

```sql
CREATE TABLE IF NOT EXISTS pm_wallet_funding
(
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

-- Populate from ERC20 USDC transfers ONLY
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

**Acceptance Gate**: Funding flows != trading volume for active traders

**Reusable**: Create new

---

## Execution Order & Timeline

### Day 1 Morning (3 hours)
1. **P0: Find CT Address** (15 min) - `scripts/find-ct-address.ts`
2. **P0: Fix TransferBatch** (1 hour) - Update `scripts/flatten-erc1155.ts`
3. **P0: Fix CLOB Ingestion** (2 hours) - Update `scripts/ingest-clob-fills.ts`

**Checkpoint**: Run `flatten-erc1155.ts`, verify no `0x` placeholders

---

### Day 1 Afternoon (3 hours)
4. **P1: Proxy Fallback** (45 min) - Update `scripts/build-approval-proxies.ts`
5. **P1: Token Mapping Enhancement** (30 min) - Update `scripts/map-tokenid-to-market.ts`
6. **P1: Build Positions Table** (2 hours) - Update `scripts/build-positions.ts`

**Checkpoint**: Query positions for HolyMoses7, verify data looks reasonable

---

### Day 2 Morning (2 hours)
7. **P0: Enhanced Validation** (1 hour) - Update `scripts/validate-known-wallets.ts`
8. **P1: Quality Gates** (30 min) - Create `scripts/run-quality-gates.ts`
9. **P2: Env Cleanup** (30 min) - Update all scripts

**Checkpoint**: Run validation, should pass all 3 wallets with >70% coverage

---

### Day 2 Afternoon (1 hour)
10. **P2: Funding Flows** (30 min) - Create `scripts/compute-funding-flows.ts`
11. **Final Validation** (30 min) - Run complete pipeline end-to-end

**Acceptance**:
- HolyMoses7: 2182 trades (target: >1527 = 70%)
- niggemon: 1087 trades (target: >761 = 70%)
- Wallet3: 0 trades (exact)

---

## Critical Dependencies

### External APIs
- ✅ ClickHouse (tables: `erc1155_transfers`, `erc20_transfers`)
- ✅ Gamma API (`https://gamma-api.polymarket.com/markets`)
- ✅ CLOB API (`https://clob.polymarket.com/trades`)
- ⚠️ CLOB API rate limits (unknown - will discover during testing)

### NPM Packages
- ✅ `@clickhouse/client` (already installed)
- ✅ `node-fetch` (already installed)
- ⚠️ `ethers` or `viem` (NEED TO INSTALL for ABI decoding)

### Environment Variables
```bash
# Already set
CLICKHOUSE_HOST=https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=8miOkWI~OhsDb
CLICKHOUSE_DATABASE=default

# Need to add
GAMMA_API_URL=https://gamma-api.polymarket.com
CLOB_API_URL=https://clob.polymarket.com
STRAPI_API_URL=https://strapi-matic.poly.market
CONDITIONAL_TOKENS=0x4d97dcd97ec945f40cf65f87097ace5ea0476045  # Will detect
```

---

## Known Wallet Test Targets

```typescript
const KNOWN_WALLETS = [
  {
    eoa: '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
    name: 'HolyMoses7',
    expected_trades: 2182,
    min_acceptable: 1527  // 70% threshold
  },
  {
    eoa: '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0',
    name: 'niggemon',
    expected_trades: 1087,
    min_acceptable: 761   // 70% threshold
  },
  {
    eoa: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
    name: 'Wallet3',
    expected_trades: 0,
    min_acceptable: 0
  }
];
```

---

## Success Metrics

### P0 Gates (Must Pass)
- ✅ TransferBatch events decoded (no `0x` placeholders)
- ✅ HolyMoses7 trade coverage >= 70% (>1527 trades)
- ✅ niggemon trade coverage >= 70% (>761 trades)
- ✅ Wallet3 correctly shows 0 trades
- ✅ All proxies have at least one EOA mapping
- ✅ No corrupt ERC1155 amounts (> 1e12)

### P1 Gates (Should Pass)
- ✅ Token mapping coverage >= 80%
- ✅ CLOB fills pagination works
- ✅ Realized PnL matches Polymarket within 5%
- ✅ Proxy fallback increases coverage by 10%+

### P2 Gates (Nice to Have)
- ✅ All URLs from environment variables
- ✅ Funding flows separated from trading volume
- ✅ Resume tokens work for interrupted CLOB fetches

---

## Risk Assessment

### High Risk 🔴
1. **CLOB API Rate Limits** - Unknown limits, may need aggressive backoff
   - Mitigation: Start with conservative 500ms delays, monitor 429 responses

2. **TransferBatch Decoding Complexity** - ABI parsing may have edge cases
   - Mitigation: Test on small batch first, validate output

### Medium Risk 🟡
3. **Token Mapping Gaps** - Gamma API may not have all markets
   - Mitigation: Add CLOB markets endpoint as fallback

4. **Proxy Resolution Completeness** - Some EOAs may not emit ApprovalForAll
   - Mitigation: Add operator→EOA inference from TransferSingle

### Low Risk 🟢
5. **PnL Calculation Accuracy** - Complex logic may have edge cases
   - Mitigation: Validate against known wallets with public profiles

---

## Ambiguities & Assumptions

### Ambiguities Requiring Clarification
1. **CLOB API Pagination Format**: Does it use cursor-based or offset-based?
   - **Assumption**: Cursor-based (check docs during implementation)

2. **Fee Data Availability**: Does CLOB API return fees per fill?
   - **Assumption**: Yes, in `fee` field (verify during testing)

3. **Token ID Encoding**: Is it `conditionId * 2 + outcomeIndex` or more complex?
   - **Assumption**: Simple encoding works for most cases (validate with Gamma)

4. **TransferBatch Frequency**: How many of total transfers are batches vs singles?
   - **Assumption**: <10% are batches (check after autodetect query)

### Assumptions
- ✅ ClickHouse tables `erc1155_transfers` and `erc20_transfers` already populated
- ✅ CLOB API is publicly accessible (no auth required for reads)
- ✅ Gamma API has no rate limits for market metadata
- ✅ Known wallet EOAs are correct and currently active

---

## Next Steps

### Immediate Actions (Start Here)
1. Install ethers: `npm install ethers`
2. Run autodetect: `npx tsx scripts/find-ct-address.ts`
3. Fix TransferBatch: Update `scripts/flatten-erc1155.ts`
4. Test on small batch: Re-run flatten script, verify output

### After Phase 1 Complete
5. Run CLOB ingestion: `npx tsx scripts/ingest-clob-fills.ts`
6. Check validation: `npx tsx scripts/validate-three.ts`
7. Assess gaps and proceed to Phase 2

---

## Files to Create
1. ✅ `scripts/find-ct-address.ts` (NEW)
2. ✅ `scripts/run-quality-gates.ts` (NEW)
3. ✅ `scripts/compute-funding-flows.ts` (NEW)

## Files to Update
1. ✅ `scripts/flatten-erc1155.ts` (TransferBatch decoding)
2. ✅ `scripts/build-approval-proxies.ts` (Proxy fallback)
3. ✅ `scripts/ingest-clob-fills.ts` (Pagination, backoff, checkpoints)
4. ✅ `scripts/map-tokenid-to-market.ts` (CLOB fallback)
5. ✅ `scripts/build-positions-from-erc1155.ts` → rename to `scripts/build-positions.ts` (Add PnL)
6. ✅ `scripts/validate-three.ts` → rename to `scripts/validate-known-wallets.ts` (Enhanced metrics)
7. ✅ All scripts (Environment variable cleanup)

## Files to Reuse (No Changes)
1. ✅ `lib/polymarket/resolver.ts` (Proxy resolution helpers)
2. ✅ `lib/polymarket/client.ts` (Gamma API client)

---

**Total Estimated Time**: 10-12 hours (1.5-2 days)

**Target Completion**: End of Day 2

**Confidence Level**: High (80%) - Most components exist, mainly need fixes and enhancements
