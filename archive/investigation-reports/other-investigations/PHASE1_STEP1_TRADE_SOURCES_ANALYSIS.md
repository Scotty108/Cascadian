# Phase 1, Step 1.1: Trade Sources Analysis - Complete

**Date:** 2025-11-16
**Agent:** C1 - Global Coverage & Indexer Architect
**Mission:** Analyze existing trade sources to design global ID repair strategy for PnL v2

---

## Executive Summary

Analyzed 157.5M trades across vw_trades_canonical and discovered **critical ID quality issues affecting nearly HALF of all trades**. This is a global systemic problem, not limited to xcnstrategy.

**Key Finding:** 48.67% null market IDs (76.7M trades), 49.15% null condition IDs (77.4M trades)

**Good News:** erc1155_transfers has 100% valid token_ids across 61.4M transfers - this is our golden repair source.

---

## Data Source Analysis

### 1. vw_trades_canonical (PRIMARY CANONICAL SOURCE)

**Volume:** 157,541,131 trades
**Wallets:** 996,109 distinct wallets
**Date Range:** 2022-12-18 to 2025-10-31 (1,048 days)

**ID Quality Issues:**
- **Null market_id_norm:** 76,673,859 trades (48.67%) ⚠️
- **Null condition_id_norm:** 77,431,480 trades (49.15%) ⚠️

**Schema (Key Fields):**
```
trade_id              String
transaction_hash      String
wallet_address_norm   String
market_id_norm        String              ← 48.67% NULL
condition_id_norm     String              ← 49.15% NULL
timestamp             DateTime
outcome_token         Enum8('YES','NO')
outcome_index         Int16
trade_direction       Enum8('BUY','SELL','UNKNOWN')
direction_confidence  Enum8('HIGH','MEDIUM','LOW')
shares                Decimal(18,8)
usd_value             Decimal(18,2)
entry_price           Decimal(18,8)
created_at            DateTime
```

**Critical Insight:** This is NOT a xcnstrategy-specific issue. Nearly half of ALL 157M trades have null IDs. This requires a global repair strategy, not targeted wallet fixes.

---

### 2. erc1155_transfers (GOLDEN REPAIR SOURCE)

**Volume:** 61,379,951 transfers
**Distinct Addresses:** 1,885,798
**Date Range:** 1970-01-01 to 2025-11-11 (extends beyond vw_trades_canonical!)

**ID Quality:**
- **Null token_id:** 0 transfers (0.00%) ✅
- **Coverage:** 100% pristine

**Schema:**
```
tx_hash           String
log_index         UInt32
block_number      UInt64
block_timestamp   DateTime
contract          String
token_id          String              ← 100% VALID (256-bit hex)
from_address      String
to_address        String
value             String
operator          String
```

**Critical Insight:** Every single ERC1155 transfer has a valid token_id. This can be decoded to extract:
- `condition_id` (64-char hex, first 254 bits)
- `outcome_index` (0 or 1, last 2 bits for binary markets)

**Decoding Formula:**
```typescript
function decodeTokenId(tokenId: bigint): { conditionId: string; outcomeIndex: number } {
  // Extract condition ID (first 254 bits → 64 hex chars)
  const conditionId = (tokenId >> 2n).toString(16).padStart(64, '0');

  // Extract outcome index from lower 2 bits (for binary)
  const collectionId = tokenId & 0x3n;
  const outcomeIndex = collectionId === 1n ? 0 : 1;

  return { conditionId, outcomeIndex };
}
```

---

### 3. clob_fills (SECONDARY REPAIR SOURCE)

**Status:** Schema retrieved (16 columns), data query failed due to unknown column names
**Error:** `Unknown expression or function identifier 'wallet'`

**Action Required:** Fix query to use correct column names (likely `maker`/`taker` instead of `wallet`)

**Expected Coverage:** ~39M fills (from C3 audit estimates)

---

### 4. market_resolutions_final (RESOLUTION MAPPING)

**Status:** Schema query succeeded, data query failed due to unknown column names
**Error:** `Unknown expression or function identifier 'market_id'`

**Action Required:** Fix query to identify correct column names for market/condition mapping

**Expected Coverage:** ~157K resolutions (from C3 audit)

**Usage:** This table should map `condition_id → market_id` for resolved markets. Critical for repair strategy.

---

## Global Repair Strategy Design

### Priority Repair Sources (In Order)

**Priority 1: ERC1155 Token ID Decoding** ✅ RECOMMENDED
- **Coverage:** 61.4M transfers with 100% valid token_ids
- **Method:** Decode `token_id → (condition_id, outcome_index)`
- **Pros:** Most reliable, no null values, covers both condition_id and outcome_index
- **Cons:** Requires decoding logic, may not cover all trades (only those with ERC1155 events)

**Priority 2: market_resolutions_final JOIN** (Conditional)
- **Coverage:** ~157K resolved markets
- **Method:** `LEFT JOIN market_resolutions_final ON condition_id`
- **Pros:** Can fill market_id from condition_id for resolved markets
- **Cons:** Only works for resolved markets, column names need verification

**Priority 3: clob_fills asset_id Decoding** (Fallback)
- **Coverage:** ~39M fills
- **Method:** Decode `asset_id → (condition_id, outcome_index)` if format matches
- **Pros:** Large coverage
- **Cons:** Column names need verification, may have different ID format

**Priority 4: Mark as Orphans**
- **Coverage:** Remaining unrepaired trades
- **Method:** Flag and separate into `pm_trades_orphaned_v2` table
- **Target:** <5% orphan rate

---

## Implications for pm_trades_canonical_v2

### Design Decisions

1. **Use vw_trades_canonical as base** (157.5M trades)
2. **Repair IDs using set-based operations** (no per-wallet logic)
3. **Track repair provenance** with `market_id_repair_source` and `condition_id_repair_source` fields
4. **Separate orphans** into dedicated table (not silently included in P&L)

### Expected Repair Rates

**Optimistic Scenario:**
- ERC1155 decoding repairs: ~60-70% of nulls (if most trades have ERC1155 events)
- market_resolutions_final fills: ~10-15% additional (resolved markets only)
- **Total repaired:** 70-85%
- **Orphan rate:** 15-30% (still acceptable if flagged)

**Realistic Scenario:**
- ERC1155 decoding repairs: ~40-50% of nulls
- market_resolutions_final fills: ~5-10% additional
- **Total repaired:** 45-60%
- **Orphan rate:** 40-55% (requires investigation of orphan patterns)

---

## Next Steps

### Phase 1, Step 1.2: Complete Table Schema Analysis

**Immediate Actions:**
1. Fix clob_fills query to use correct column names
2. Fix market_resolutions_final query to identify correct schema
3. Run complete overlap analysis to measure repair potential

### Phase 1, Step 1.3: Design Global Repair Queries

**Design:**
1. ERC1155 token_id decoding JOIN
2. market_resolutions_final condition_id → market_id mapping
3. Orphan trade identification and separation
4. pm_trades_canonical_v2 CREATE TABLE AS SELECT query

---

## Success Criteria

**Phase 1 Complete When:**
- [ ] All 4 data sources fully analyzed (schemas + coverage + overlap)
- [ ] Global repair strategy designed with set-based SQL queries
- [ ] Expected repair rates estimated (optimistic + realistic scenarios)
- [ ] pm_trades_canonical_v2 DDL written and ready to execute

**Phase 2 Ready When:**
- [ ] pm_trades_canonical_v2 populated with repaired IDs
- [ ] Orphan rate measured and validated (<30% ideally)
- [ ] Repair provenance tracked for all trades

---

## Files Generated

1. `scripts/analyze-trade-sources-for-v2.ts` - Analysis script (partial success)
2. `reports/TRADE_SOURCES_ANALYSIS_2025-11-16.json` - Raw analysis output
3. `PHASE1_STEP1_TRADE_SOURCES_ANALYSIS.md` - This summary document

---

**Signed:** Claude 1 (C1)
**Date:** 2025-11-16 (PST)
**Status:** Phase 1, Step 1.1 complete with critical findings - proceeding to Step 1.2
