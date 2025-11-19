# AMM Coverage Implementation - Action Plan

**Date:** 2025-11-15  
**Objective:** Achieve 100% Polymarket market coverage by adding AMM/ERC1155 data source  
**Current State:** 79.16% coverage (CLOB only)  
**Target State:** 100% coverage (CLOB + AMM via ERC1155)  
**Timeline:** Execute tomorrow (2025-11-16)

---

## Executive Summary

Today's investigation confirmed:
- ✅ CLOB fills cover 79% of markets (118,660 markets)
- ✅ ERC1155 transfers contain ALL trades (CLOB + AMM)
- ✅ We have token mapping table (`ctf_token_map`) with 92.82% coverage
- ❌ "Activity Subgraph" is NOT trade data (it's CTF operations only)
- 🎯 Path to 100%: Use hybrid CLOB + ERC1155 approach

**Key Discovery:** The remaining 21% of markets (31,248 markets) either:
1. Have zero trading activity (99.989%)
2. Are high-volume and need pagination (13+ markets)
3. Use AMM-only trading (rare but possible)

---

## Tomorrow's Implementation Plan

### Phase 1: Infrastructure (2-3 hours)

#### 1.1 Create ERC1155 Trade Reconstruction Service
**File:** `lib/polymarket/erc1155-trades.ts`

**Purpose:** Convert raw ERC1155 transfers into structured trade data

**Key Functions:**
```typescript
// Get all transfers for a market
async function getMarketTransfers(conditionId: string): Promise<Transfer[]>

// Filter out non-trade transfers (mints, burns, internal)
function filterTradeTransfers(transfers: Transfer[]): Transfer[]

// Detect trade direction (buy vs sell)
function inferTradeDirection(transfer: Transfer): 'buy' | 'sell'

// Calculate implied price from transfer ratios
function calculateImpliedPrice(transfer: Transfer): number | null

// Convert transfers to unified Trade format
function transfersToTrades(transfers: Transfer[]): Trade[]
```

**Implementation Notes:**
- Filter `from_address !== '0x0000...'` and `to_address !== '0x0000...'`
- Exclude known system addresses (CTF Exchange, FPMM contracts)
- Group by `tx_hash` to find matching collateral transfers
- Price calculation: Look for USDC transfer in same tx

#### 1.2 Create Hybrid Data Service
**File:** `lib/polymarket/hybrid-data-service.ts`

**Purpose:** Intelligently route between CLOB and ERC1155 sources

**Key Functions:**
```typescript
// Main entry point - automatically selects best source
async function getMarketTrades(conditionId: string): Promise<Trade[]>

// Check if market has CLOB data
async function hasCLOBData(conditionId: string): Promise<boolean>

// Check if market has token mappings
async function hasTokenMappings(conditionId: string): Promise<boolean>

// Cache source determination to avoid repeated checks
function cacheDataSource(conditionId: string, source: 'clob' | 'erc1155' | 'none'): void
```

**Caching Strategy:**
```typescript
// In-memory cache with TTL
const dataSourceCache = new Map<string, {
  source: 'clob' | 'erc1155' | 'none';
  timestamp: number;
  ttl: number; // 1 hour for 'none', 24 hours for others
}>();
```

#### 1.3 Update Existing Trade Endpoints
**Files to modify:**
- `app/api/markets/[id]/trades/route.ts`
- `lib/polymarket/trades.ts`

**Changes:**
```typescript
// Before (CLOB only):
const trades = await getCLOBTrades(conditionId);

// After (Hybrid):
import { getMarketTrades } from '@/lib/polymarket/hybrid-data-service';
const trades = await getMarketTrades(conditionId);
```

---

### Phase 2: ERC1155 Reconstruction (3-4 hours)

#### 2.1 Build Token Transfer Query
**Critical Schema Details:**

```typescript
// ctf_token_map schema (CONFIRMED):
{
  token_id: string;          // ERC1155 token ID
  condition_id_norm: string; // 64-char hex, NO 0x prefix
  question: string;
  outcome: string;
  outcomes_json: string;
  source: string;
  created_at: DateTime;
}

// erc1155_transfers schema (CONFIRMED):
{
  tx_hash: string;
  log_index: number;
  block_number: number;
  block_timestamp: DateTime;
  contract: string;
  token_id: string;          // Links to ctf_token_map.token_id
  from_address: string;
  to_address: string;
  value: string;
  operator: string;
}
```

**Query Pattern:**
```sql
-- Step 1: Get token IDs for market
WITH market_tokens AS (
  SELECT token_id, outcome
  FROM ctf_token_map
  WHERE condition_id_norm = '${conditionIdNormalized}'
)
-- Step 2: Get all transfers for those tokens
SELECT
  t.block_timestamp as timestamp,
  t.token_id,
  m.outcome,
  t.from_address,
  t.to_address,
  t.value,
  t.tx_hash,
  t.block_number
FROM erc1155_transfers t
INNER JOIN market_tokens m ON t.token_id = m.token_id
WHERE 
  -- Exclude mints (from zero address)
  t.from_address != '0x0000000000000000000000000000000000000000'
  -- Exclude burns (to zero address)
  AND t.to_address != '0x0000000000000000000000000000000000000000'
ORDER BY t.block_timestamp DESC
```

#### 2.2 Trade Direction Detection

**Strategy 1: Collateral Flow (Most Accurate)**
```typescript
// Look for USDC transfers in same transaction
async function getCollateralTransfer(txHash: string): Promise<Transfer | null> {
  const query = `
    SELECT from_address, to_address, value
    FROM erc20_transfers  -- If we have this table
    WHERE tx_hash = '${txHash}'
      AND token_address = '${USDC_ADDRESS}'
  `;
  // Direction: If user receives outcome tokens + sends USDC = BUY
  // Direction: If user sends outcome tokens + receives USDC = SELL
}
```

**Strategy 2: Address Role Detection (Fallback)**
```typescript
// Known contract addresses
const KNOWN_CONTRACTS = [
  '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E', // CTF Exchange
  // Add FPMM addresses, LP addresses, etc.
];

function inferDirection(transfer: Transfer): 'buy' | 'sell' | 'unknown' {
  if (KNOWN_CONTRACTS.includes(transfer.from_address)) {
    return 'buy';  // User receiving from pool
  }
  if (KNOWN_CONTRACTS.includes(transfer.to_address)) {
    return 'sell'; // User sending to pool
  }
  return 'unknown'; // P2P transfer
}
```

#### 2.3 Price Calculation

**Approach A: From Collateral Transfer**
```typescript
// If we have paired USDC transfer:
const price = usdcAmount / outcomeTokenAmount;
```

**Approach B: Historical Average (Fallback)**
```typescript
// Use most recent CLOB price for same market
const lastCLOBPrice = await getLastCLOBPrice(conditionId, outcome);
return lastCLOBPrice || null; // null if no price available
```

**Approach C: Market Oracle (Future)**
```typescript
// Query Polymarket price API at block timestamp
// Requires: Block number → timestamp → Polymarket API historical price
```

---

### Phase 3: Testing & Validation (2-3 hours)

#### 3.1 Test Cases

**Test Case 1: Pure CLOB Market (Should use CLOB)**
```typescript
const conditionId = '0x...'; // High-volume market known to have CLOB fills
const trades = await getMarketTrades(conditionId);
assert(trades.length > 0);
assert(trades[0].source === 'clob');
```

**Test Case 2: Zero-Trade Market (Should return empty)**
```typescript
const conditionId = '0x54625984...'; // Our test market from today
const trades = await getMarketTrades(conditionId);
assert(trades.length === 0);
```

**Test Case 3: Market Missing from CLOB (Should use ERC1155)**
```typescript
// Find a market with:
// - No CLOB fills
// - Has token mappings
// - Has ERC1155 transfers
const testMarket = await findAMMOnlyMarket();
const trades = await getMarketTrades(testMarket.conditionId);
assert(trades.length > 0);
assert(trades[0].source === 'erc1155');
```

**Test Case 4: Coverage Verification**
```sql
-- Count markets by data source
SELECT
  CASE
    WHEN clob_count > 0 THEN 'clob'
    WHEN erc1155_count > 0 THEN 'erc1155'
    ELSE 'no_data'
  END as source,
  count(*) as market_count
FROM (
  SELECT
    g.condition_id,
    (SELECT count(*) FROM clob_fills c 
     WHERE c.condition_id = g.condition_id) as clob_count,
    (SELECT count(*) FROM erc1155_transfers e 
     WHERE e.token_id IN (
       SELECT token_id FROM ctf_token_map 
       WHERE condition_id_norm = lower(replace(g.condition_id, '0x', ''))
     )) as erc1155_count
  FROM gamma_markets g
  LIMIT 1000  -- Sample for testing
)
GROUP BY source;
```

#### 3.2 Validation Queries

**Verify ERC1155 gives more coverage:**
```sql
-- Markets with no CLOB but have ERC1155
SELECT count(*) as amm_only_markets
FROM gamma_markets g
WHERE lower(replaceAll(g.condition_id, '0x', '')) NOT IN (
  SELECT DISTINCT lower(replaceAll(condition_id, '0x', ''))
  FROM clob_fills
)
AND lower(replaceAll(g.condition_id, '0x', '')) IN (
  SELECT DISTINCT condition_id_norm
  FROM ctf_token_map
  WHERE token_id IN (
    SELECT DISTINCT token_id FROM erc1155_transfers
  )
);
```

**Expected results:**
- Some markets will show ERC1155 activity but no CLOB
- This proves AMM-only trading exists
- If zero, confirms all "missing" markets truly have no trades

---

### Phase 4: Performance Optimization (1-2 hours)

#### 4.1 Add Database Indices
```sql
-- Index on ctf_token_map for faster lookups
CREATE INDEX IF NOT EXISTS idx_ctf_condition_norm 
ON ctf_token_map(condition_id_norm);

-- Index on erc1155_transfers for token_id lookups
CREATE INDEX IF NOT EXISTS idx_erc1155_token_id 
ON erc1155_transfers(token_id);

-- Composite index for filtered queries
CREATE INDEX IF NOT EXISTS idx_erc1155_token_addresses
ON erc1155_transfers(token_id, from_address, to_address);
```

#### 4.2 Implement Query Caching
```typescript
// Cache ERC1155 trade results (longer TTL since historical data)
const tradeCache = new LRUCache<string, Trade[]>({
  max: 1000,  // Cache 1000 markets
  ttl: 1000 * 60 * 60 * 24,  // 24 hour TTL
});

async function getMarketTradesWithCache(conditionId: string): Promise<Trade[]> {
  const cached = tradeCache.get(conditionId);
  if (cached) return cached;
  
  const trades = await getMarketTrades(conditionId);
  tradeCache.set(conditionId, trades);
  return trades;
}
```

#### 4.3 Batch Token Mapping Lookups
```typescript
// Instead of querying per market, batch load mappings
async function preloadTokenMappings(conditionIds: string[]): Promise<void> {
  const normalized = conditionIds.map(id => 
    id.toLowerCase().replace('0x', '')
  );
  
  const query = `
    SELECT condition_id_norm, token_id, outcome
    FROM ctf_token_map
    WHERE condition_id_norm IN (${normalized.map(id => `'${id}'`).join(',')})
  `;
  
  const results = await clickhouse.query({ query, format: 'JSONEachRow' });
  const mappings = await results.json();
  
  // Cache all mappings
  for (const mapping of mappings) {
    tokenMappingCache.set(mapping.condition_id_norm, mapping);
  }
}
```

---

## Critical Implementation Details

### ID Normalization (CRITICAL - Don't Forget!)

```typescript
// ALWAYS normalize condition IDs before queries
function normalizeConditionId(conditionId: string): string {
  return conditionId.toLowerCase().replace('0x', '');
}

// Different tables use different formats:
const CLOB_QUERY = `WHERE lower(replaceAll(condition_id, '0x', '')) = '${normalized}'`;
const TOKEN_MAP_QUERY = `WHERE condition_id_norm = '${normalized}'`;
const GAMMA_QUERY = `WHERE lower(replaceAll(condition_id, '0x', '')) = '${normalized}'`;
```

### Known System Addresses to Exclude

```typescript
const SYSTEM_ADDRESSES = {
  ZERO_ADDRESS: '0x0000000000000000000000000000000000000000',
  CTF_EXCHANGE: '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E',
  // TODO: Add FPMM addresses, LP addresses when identified
};

function isSystemAddress(address: string): boolean {
  return Object.values(SYSTEM_ADDRESSES).includes(address.toLowerCase());
}
```

### Error Handling

```typescript
// Graceful degradation
async function getMarketTrades(conditionId: string): Promise<Trade[]> {
  try {
    // Try CLOB first
    const clobTrades = await getCLOBTrades(conditionId);
    if (clobTrades.length > 0) {
      return clobTrades;
    }
  } catch (err) {
    console.error('CLOB query failed:', err);
  }
  
  try {
    // Fall back to ERC1155
    const erc1155Trades = await getERC1155Trades(conditionId);
    if (erc1155Trades.length > 0) {
      return erc1155Trades;
    }
  } catch (err) {
    console.error('ERC1155 query failed:', err);
  }
  
  // Both failed or no data
  return [];
}
```

---

## Success Metrics

### Before Implementation
- ✅ CLOB coverage: 79.16% (118,660 markets)
- ❌ AMM coverage: 0%
- ❌ Total coverage: 79.16%

### After Implementation (Target)
- ✅ CLOB coverage: 79.16% (118,660 markets)
- ✅ AMM coverage: ~13-20% (estimated 20,000-31,000 markets)
- ✅ Total coverage: 92-100%
- ✅ Zero-trade markets: Correctly identified as having no activity

### Validation Queries

```sql
-- Final coverage check
WITH coverage AS (
  SELECT
    condition_id,
    EXISTS(SELECT 1 FROM clob_fills c 
           WHERE c.condition_id = g.condition_id) as has_clob,
    EXISTS(SELECT 1 FROM erc1155_transfers e 
           WHERE e.token_id IN (
             SELECT token_id FROM ctf_token_map 
             WHERE condition_id_norm = lower(replace(g.condition_id, '0x', ''))
           )) as has_erc1155
  FROM gamma_markets g
)
SELECT
  countIf(has_clob) as clob_markets,
  countIf(has_erc1155 AND NOT has_clob) as amm_only_markets,
  countIf(has_clob OR has_erc1155) as total_coverage,
  count(*) as total_markets,
  round(100.0 * countIf(has_clob OR has_erc1155) / count(*), 2) as coverage_pct
FROM coverage;
```

---

## Risks & Mitigations

### Risk 1: ERC1155 transfers include non-trade activity
**Mitigation:** 
- Filter out mints/burns (zero addresses)
- Exclude known system addresses
- Validate with sample markets

### Risk 2: Price calculation inaccurate
**Mitigation:**
- Start with "price unavailable" for ERC1155 trades
- Add pricing layer incrementally
- Document pricing limitations

### Risk 3: Performance degradation
**Mitigation:**
- Implement caching at every layer
- Use database indices
- Batch operations where possible
- Monitor query performance

### Risk 4: Token mapping gaps (7.18% of markets)
**Mitigation:**
- Accept this limitation (can't map what doesn't exist)
- Document as known constraint
- Consider backfilling token mappings from blockchain events

---

## File Structure

```
lib/
  polymarket/
    erc1155-trades.ts          # NEW - ERC1155 reconstruction
    hybrid-data-service.ts     # NEW - Intelligent routing
    trades.ts                  # MODIFY - Use hybrid service
    
scripts/
  test-erc1155-reconstruction.ts  # NEW - Validation script
  benchmark-hybrid-performance.ts # NEW - Performance testing
  
docs/
  operations/
    POLYMARKET_DATA_SOURCES.md     # CREATED TODAY ✅
    AMM_COVERAGE_ACTION_PLAN.md    # THIS FILE ✅
```

---

## Execution Checklist

**Tomorrow Morning (2025-11-16):**

- [ ] Review this document and POLYMARKET_DATA_SOURCES.md
- [ ] Create `lib/polymarket/erc1155-trades.ts`
- [ ] Create `lib/polymarket/hybrid-data-service.ts`
- [ ] Update `lib/polymarket/trades.ts` to use hybrid service
- [ ] Create test script for validation
- [ ] Run coverage validation query
- [ ] Document final coverage percentage
- [ ] Add caching layer
- [ ] Performance testing
- [ ] Update API endpoints to use new service

**Estimated Total Time:** 8-12 hours

**Expected Outcome:** 92-100% market coverage with graceful fallback

---

## Reference Documentation

- **Data Source Guide:** `/docs/operations/POLYMARKET_DATA_SOURCES.md`
- **Test Scripts:** 
  - `/scripts/compare-data-sources.ts`
  - `/scripts/test-activity-subgraph.ts`
  - `/scripts/check-token-map-schema.ts`

---

**Created:** 2025-11-15  
**Status:** Ready for execution  
**Priority:** P1 - Major coverage improvement  
**Owner:** Claude 1

---

**Notes for Claude 1 (Tomorrow):**

Hey tomorrow-me! Here's what we learned today:

1. **Activity Subgraph is a red herring** - It's NOT trade data, just CTF operations
2. **ERC1155 is the truth source** - Every trade creates a transfer, no exceptions
3. **Token mapping works** - `ctf_token_map` has 92% coverage with correct schema
4. **CLOB is subset of ERC1155** - Not the other way around
5. **ID normalization is critical** - Different tables, different formats (with/without 0x)

The path forward is clear. Just follow this plan and we'll have near-100% coverage by end of day.

Good luck! 🚀

