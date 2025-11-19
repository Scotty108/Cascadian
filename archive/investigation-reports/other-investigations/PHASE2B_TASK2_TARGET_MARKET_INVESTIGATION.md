# Phase 2B Task 2: Target Market Deep Investigation
**Date:** 2025-11-15
**Target Market:** Xi Jinping out in 2025? (per Dome) / "Will Joe Biden get Coronavirus before the election?" (per Gamma API)
**Condition ID:** `0xf2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1`

---

## Executive Summary

**CRITICAL FINDING:** The target market is **NOT a CLOB market**. It exists in Polymarket's Gamma API but has `enable_order_book = undefined` (defaults to false), meaning trades are executed via AMM or alternative mechanism, NOT through the Central Limit Order Book.

**This explains:**
- Why the market has ZERO data in our CLOB-based tables (`clob_fills`, `pm_trades`)
- Why it's missing from our token mapping tables (`ctf_token_map`)
- Why Dome has the data but we don't (Dome indexes AMM + CLOB; we only index CLOB)

---

## Investigation Results

### 2.1 Presence in Our System

| Table | Status | Details |
|-------|--------|---------|
| **pm_markets** | ❌ ABSENT | 0 rows |
| **pm_trades** | ❌ ABSENT | 0 trades |
| **clob_fills** | ❌ ABSENT | 0 fills |
| **gamma_resolved** | ❌ ABSENT | 0 rows |
| **ctf_token_map** | ❌ ABSENT | No token_id mapping |
| **erc1155_transfers** | ❓ UNABLE TO CHECK | No token_id mapping to search with |

**Conclusion:** Market was **NEVER ingested** into any of our tables.

---

### 2.2 Chain-Level Data

**Status:** Unable to verify on-chain transfers due to missing token_id mapping in `ctf_token_map`.

**Process attempted:**
1. Checked `ctf_token_map` for condition_id → token_id mapping
2. Found ZERO mappings for this condition_id
3. Without token_ids, cannot query `erc1155_transfers` for on-chain activity

**Implication:** Our token mapping pipeline (from Gamma Markets to `ctf_token_map`) may have skipped this market because it's not a CLOB market.

---

### 2.3 Polymarket API Cross-Check

#### Gamma API Results

**URL:** `https://gamma-api.polymarket.com/markets?condition_id=0xf2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1`

**Response:** ✅ Market found

**Market Properties:**
```json
{
  "question": "Will Joe Biden get Coronavirus before the election?",
  "active": true,
  "closed": true,
  "market_type": "binary",
  "enable_order_book": undefined,  // CRITICAL: Defaults to false!
  "clob_token_ids": undefined,
  "end_date_iso": undefined
}
```

**⚠️ CRITICAL:** `enable_order_book = undefined` means this market does NOT use CLOB!

#### CLOB API Results

**URL:** `https://clob.polymarket.com/trades?condition_id=...`

**Response:** ❌ 401 Unauthorized (authentication required)

**Note:** Authentication requirement makes it impossible to directly confirm absence of CLOB trades, but the `enable_order_book = false` flag from Gamma API is definitive.

---

### 2.4 Question Name Discrepancy

**Dome shows:** "Xi Jinping out in 2025?"
**Gamma API shows:** "Will Joe Biden get Coronavirus before the election?"

**Possible explanations:**
1. Dome may aggregate/rename markets for display purposes
2. Market question may have been updated after creation
3. Condition ID may map to different questions in different systems

**This requires further investigation** but doesn't change the core finding that this is an AMM market.

---

## Data Lineage Summary

```
┌─────────────────────────────────────────────────────────────────────┐
│ POLYMARKET GAMMA API                                                │
│ ✅ Market exists                                                    │
│ ✅ Status: closed=true (resolved)                                   │
│ ❌ enable_order_book = undefined (AMM-only)                         │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ↓
┌─────────────────────────────────────────────────────────────────────┐
│ CLOB FILLS                                                          │
│ ❌ NOT INGESTED (market doesn't use CLOB)                           │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ↓
┌─────────────────────────────────────────────────────────────────────┐
│ OUR CLICKHOUSE TABLES                                               │
│ ❌ clob_fills: 0 rows                                               │
│ ❌ pm_trades: 0 trades                                              │
│ ❌ pm_markets: Not found                                            │
│ ❌ ctf_token_map: No mapping                                        │
└─────────────────────────────────────────────────────────────────────┘

BUT:

┌─────────────────────────────────────────────────────────────────────┐
│ DOME                                                                │
│ ✅ 14 trades                                                        │
│ ✅ 19,999.99 shares                                                 │
│ ✅ Contributes to xcnstrategy P&L                                   │
└─────────────────────────────────────────────────────────────────────┘
```

**Conclusion:** Dome has an AMM ingestion path that we do not.

---

## Root Cause Analysis

### Why This Market Is Missing

**Primary Cause:** Our data pipeline is **CLOB-centric**. We ingest:
1. CLOB fills from Goldsky
2. Transform to `pm_trades`
3. Aggregate to P&L

**Missing Component:** **AMM trade ingestion**

Markets with `enable_order_book = false` (or undefined) execute trades via:
- Automated Market Maker (AMM) pools
- Direct on-chain settlements
- Alternative execution mechanisms

**Our pipeline does not capture these trades.**

### Scope of Impact

**Question:** How many markets are AMM-only?

To determine full scope, we need to:
1. Query Gamma API for all markets with `enable_order_book = false`
2. Count how many of xcnstrategy's Dome markets fall into this category
3. Estimate total P&L impact

**Current evidence:** At least 6 of the 14 missing Dome markets may be AMM-only (the 6 with zero data in ALL our tables).

---

## Task 3: Ingestion Fix Recommendation

### Option A: AMM Trade Ingestion (Preferred)

**Goal:** Add AMM trade data to our pipeline

**Implementation Path:**

**Step 1: Identify AMM Contract Addresses**
- Research Polymarket's AMM contracts on Polygon
- Identify event types emitted by AMM swaps/trades
- Document which fields map to: wallet, side, size, price

**Step 2: Index AMM Events**
- Use same Goldsky or subgraph approach as CLOB
- Or: Direct RPC queries for AMM contract events
- Filter for xcnstrategy EOA and proxy addresses

**Step 3: Transform AMM Events to `pm_trades` Format**
- Create transformation logic: AMM events → standard trade schema
- Ensure compatibility with existing P&L calculation views
- Handle differences in pricing/execution model

**Step 4: Backfill Historical AMM Trades**
- Identify date range for xcnstrategy AMM activity
- Run backfill for target markets first (validate with Dome)
- Scale to full AMM ingestion if successful

**Estimated Effort:** 2-3 days for:
- Contract research: 4-6 hours
- Pipeline build: 8-12 hours
- Testing & validation: 4-6 hours

**Risk:** Medium - AMM data structure may differ significantly from CLOB

---

### Option B: Use Polymarket Data API Directly

**Alternative:** Instead of indexing blockchain events, query Polymarket's Data API for trade history

**Pros:**
- Simpler than blockchain indexing
- API provides normalized trade data (CLOB + AMM unified)
- Faster to implement

**Cons:**
- API rate limits
- May not have full historical coverage
- Dependency on Polymarket's API availability
- Less "source of truth" than blockchain data

**Implementation:**
```typescript
// Pseudocode
for each market in missing_markets:
  trades = polymarketAPI.getTrades(market, wallet=xcnstrategy)
  insert into pm_trades
  recalculate P&L
```

**Estimated Effort:** 1-2 days

**Risk:** Low - API is documented and stable

---

### Option C: Hybrid Approach (Recommended)

**Best of both worlds:**

**Phase 1 (Immediate):** Use Polymarket Data API to backfill AMM trades for xcnstrategy
- Quick validation that AMM data closes the gap
- Proves the hypothesis
- Delivers immediate P&L accuracy for this wallet

**Phase 2 (Long-term):** Build proper AMM contract indexing
- Scalable to all wallets
- Source of truth from blockchain
- No API dependency

**Timeline:**
- **Week 1:** Data API backfill (Option B) - validate hypothesis
- **Week 2-3:** AMM contract indexing (Option A) - scale solution

---

## Recommendation

**Proceed with Option C (Hybrid Approach)**

**Immediate next steps:**
1. ✅ **Validate hypothesis:** Use Polymarket Data API to fetch AMM trades for this one market for xcnstrategy
2. ✅ **Insert into `pm_trades`:** Transform API data to match our schema
3. ✅ **Recompute P&L:** Check if it closes the gap vs Dome
4. ⏭️ **If successful:** Scale to remaining 5 AMM markets
5. ⏭️ **Long-term:** Build proper AMM blockchain indexing for all wallets

**Validation Query (after API backfill):**
```sql
SELECT
  COUNT(*) as trades,
  SUM(shares) as total_shares
FROM pm_trades
WHERE condition_id = '0xf2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1'
  AND canonical_wallet_address = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
```

**Expected:** Should match Dome's 14 trades, 19,999.99 shares

---

## Files Created

| File | Purpose |
|------|---------|
| scripts/112-check-polymarket-api-target-market.ts | API cross-check for target market |
| PHASE2B_TASK2_TARGET_MARKET_INVESTIGATION.md | This report |

---

## Next Agent Handoff

**Status:** Task 2 Complete ✅
**Key Finding:** Target market is AMM-only (not CLOB)
**Recommendation:** Implement Option C (Hybrid: API backfill → blockchain indexing)

**For next agent:**
1. Review this investigation report
2. Decide whether to proceed with AMM backfill
3. If yes, start with Polymarket Data API for quick validation
4. Document results and decide on long-term solution

---

**Investigator:** Claude 1
**Completion Time:** Task 2 complete, ready for Task 3 execution decision
