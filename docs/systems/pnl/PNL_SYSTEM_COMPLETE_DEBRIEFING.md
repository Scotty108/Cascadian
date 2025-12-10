# PnL System Complete Debriefing

> **For New Agents / Systems Taking Over This Work**
>
> This document captures EVERYTHING we know about the Cascadian PnL system as of December 5, 2025. Read this completely before making any changes.

---

## Executive Summary: The Paradox That Killed Our Approach

**Before TRADER_STRICT filtering:** 50% accuracy (8/16 wallets within 5% of UI)
**After TRADER_STRICT filtering:** 3.2% accuracy (1/31 wallets within 5% of UI)

**The filtering made things WORSE.** This document explains why, what we've tried, and what the next agent should do differently.

---

## Table of Contents

1. [The Mission](#1-the-mission)
2. [The Data Sources](#2-the-data-sources)
3. [The Engines We Built](#3-the-engines-we-built)
4. [The Current Engine: V23c](#4-the-current-engine-v23c)
5. [What TRADER_STRICT Does](#5-what-trader_strict-does)
6. [The 100-Wallet Test Results](#6-the-100-wallet-test-results)
7. [Why It Works on Some, Fails on Others](#7-why-it-works-on-some-fails-on-others)
8. [The Root Causes We've Identified](#8-the-root-causes-weve-identified)
9. [What We've Tried](#9-what-weve-tried)
10. [Recommendation: Abandon TRADER_STRICT](#10-recommendation-abandon-trader_strict)
11. [Complete File Reference](#11-complete-file-reference)

---

## 1. The Mission

**Goal:** Calculate P&L (Profit & Loss) for any Polymarket wallet and have it match what Polymarket's UI shows.

**Target Accuracy:** Within 5% of what Polymarket displays on `https://polymarket.com/profile/{wallet}`

**Current State:** 3.2% accuracy with current approach (31 wallets tested).

---

## 2. The Data Sources

### 2.1 Primary Data Tables (ClickHouse)

| Table | Rows (approx) | Description | Trust Level |
|-------|---------------|-------------|-------------|
| `pm_trader_events_v2` | ~803M | Raw CLOB trade events from Polymarket order book | **SOURCE OF TRUTH** |
| `pm_market_metadata` | ~200k | Market info from Gamma API (token_ids, outcomes, prices) | HIGH |
| `pm_unified_ledger_v7` | ~300M | Unified ledger combining CLOB + CTF events | **STALE** - Token mapping old |
| `pm_condition_resolutions` | ~100k | Market resolutions (payout_numerators like [0,1] or [1,0]) | HIGH |
| `pm_ctf_events` | ~50M | ERC-1155 conditional token events (splits, merges, redemptions) | HIGH |
| `pm_erc1155_transfers` | ~10M | ERC-1155 transfer events | MEDIUM |
| `pm_token_to_condition_map_v4` | ~1M | Maps token_id → condition_id | **INCOMPLETE** |

### 2.2 Critical Data Relationships

```
pm_trader_events_v2 (trades)
    │
    ├── token_id ──────────────────────> pm_market_metadata.token_ids[] (Array)
    │                                    (JOIN: token_id IN token_ids array)
    │
    └── [mapped via token_id] ────────> condition_id
                                              │
                                              └───> pm_condition_resolutions
                                                    (payout_numerators for resolved markets)
```

### 2.3 The Token Mapping Problem

**The Unified Ledger is STALE.** Here's why:

1. `pm_trader_events_v2` contains raw trades with `token_id`
2. `pm_unified_ledger_v7` is built by joining with `pm_token_to_condition_map_v4`
3. That mapping table was built at a point in time and hasn't been updated
4. New tokens traded after the mapping was built → **MISSING from ledger**
5. Result: V23c queries return empty results for recent wallets

**Coverage Issue:**
- `pm_trader_events_v2`: 803M rows (SOURCE OF TRUTH)
- `pm_unified_ledger_v7` CLOB events: ~300M rows
- Coverage: ~37% of trades are mapped to condition_id

### 2.4 Price Oracle Sources

V23c uses this priority for marking positions:

1. **Resolution price** (from `pm_condition_resolutions.payout_numerators`) - 0 or 1 for binary
2. **UI prices** (from `pm_market_metadata.outcome_prices`) - Current market prices
3. **Last trade price** - Wallet's own most recent trade price
4. **$0.50 default** - Final fallback

---

## 3. The Engines We Built

We've built **28+ engine versions**. Here's the lineage:

### Engine Evolution

| Version | Formula | Status | Accuracy |
|---------|---------|--------|----------|
| V1-V10 | Various | Abandoned | < 50% |
| V11_POLY | FIFO cost basis | Reference only | ~60% on pure traders |
| V17 | FROZEN CANONICAL | `cash_flow + final_shares * resolution_price` | Frozen for Cascadian |
| V20 | Aggregate formula | Achieved 0.01% on test wallets | Works for resolved markets |
| V22 | Split/Merge aware | **FAILED** - Double counting trap | -200% errors |
| V23 | State machine + V20 formula | Canonical base | Depends on data quality |
| V23c | V23 + UI Price Oracle | **CURRENT** | 3.2% (with STRICT filter) |

### The V22 Trap (Critical Context)

V22 tried to be "smarter" by tracking Split/Merge events separately:
- **Split:** Lock $1 USDC → Get 1 YES + 1 NO token (cost basis each $0.50)
- **Merge:** Burn 1 YES + 1 NO → Get $1 USDC back

The trap: V22 counted MERGE revenue without deducting SPLIT cost → **massive fake profits**

**Lesson:** Don't try to be clever. The simple V20 formula works.

---

## 4. The Current Engine: V23c

### 4.1 Location
```
lib/pnl/shadowLedgerV23c.ts
```

### 4.2 Core Formula
```
PnL = cash_flow + (final_tokens * mark_price)
```

Where:
- `cash_flow` = Sum of all USDC in/out (negative for buys, positive for sells)
- `final_tokens` = Current token balance
- `mark_price` = Resolution price (if resolved) OR UI price OR $0.50

### 4.3 Data Flow

```
1. loadLedgerEventsForWallet(wallet)
   └── Query pm_unified_ledger_v7 for CLOB events
   └── Returns: LedgerEvent[] (often EMPTY due to stale mapping!)

2. loadRawTradesFallback(wallet)  [BYPASS SURGERY]
   └── Query pm_trader_events_v2 directly
   └── JOIN with pm_market_metadata via token_id IN token_ids
   └── Returns: LedgerEvent[] from fresh data

3. Merge events (dedupe by event_id)
   └── Combined = ledgerEvents + fallbackEvents

4. ShadowLedgerEngine.processEvents(combined)
   └── State machine processes chronologically
   └── Tracks: quantity, costBasis, cashFlow per position

5. Load price oracles:
   └── loadResolutionPrices() → Map<conditionId|outcomeIndex, price>
   └── loadUIMarketPrices() → Map<conditionId|outcomeIndex, price>

6. Apply resolutions & calculate result
   └── engine.applyResolutions(wallet, resolutionPrices)
   └── engine.getWalletResult(wallet, priceOracle)
```

### 4.4 The Direct Bypass (V23c Lines 229-287)

Because the unified ledger is stale, V23c includes a "bypass" that reads directly from `pm_trader_events_v2` and joins with `pm_market_metadata`:

```sql
WITH token_map AS (
  SELECT
    arrayJoin(token_ids) as token_id,
    condition_id,
    indexOf(token_ids, arrayJoin(token_ids)) - 1 as outcome_index
  FROM pm_market_metadata
  WHERE length(token_ids) > 0
)
SELECT
  t.trader_wallet, tm.condition_id, tm.outcome_index,
  -- Sign logic for USDC and tokens...
FROM pm_trader_events_v2 t
INNER JOIN token_map tm ON t.token_id = tm.token_id
WHERE lower(t.trader_wallet) = lower('${wallet}')
```

**Problem:** This still misses tokens not in `pm_market_metadata.token_ids`.

---

## 5. What TRADER_STRICT Does

### 5.1 Location
```
lib/pnl/walletClassifier.ts
```

### 5.2 The Theory

The idea was: "V23c can't accurately calculate PnL for wallets with non-CLOB activity. Let's filter to only 'pure traders' where it should work."

### 5.3 TRADER_STRICT Criteria

A wallet is TRADER_STRICT if ALL of these are true:

1. **No Split events** (split_events === 0)
2. **No Merge events** (merge_events === 0)
3. **Inventory consistent** (|ledger_tokens - clob_tokens| <= 5.0)
4. **Not transfer-heavy** (incoming_transfer_value < $100)

### 5.4 The Implementation

```typescript
// checkInventoryConsistency()
SELECT
  sum(token_delta) as net_tokens_ledger,
  sumIf(token_delta, source_type = 'CLOB') as net_tokens_clob
FROM pm_unified_ledger_v7
WHERE lower(wallet_address) = lower('${wallet}')

// is_consistent = |net_tokens_ledger - net_tokens_clob| <= 5.0
```

### 5.5 Why It Backfired

The inventory check compares `pm_unified_ledger_v7` totals. But:
- The ledger is STALE
- For recent wallets, `net_tokens_ledger` ≈ 0 (nothing mapped)
- But `net_tokens_clob` (from raw trades) shows real activity
- Result: **Nearly ALL wallets fail the consistency check!**

From the 100-wallet test:
- 69 wallets excluded for "Inventory Mismatch"
- Only 31 passed the filter
- Of those 31, only 1 matched UI within 5%

---

## 6. The 100-Wallet Test Results

### 6.1 Test Script
```
scripts/pnl/proof-of-accuracy.ts
```

### 6.2 Results File
```
data/proof-of-accuracy-results.json
```

### 6.3 Summary

| Metric | Value |
|--------|-------|
| Total Sampled | 100 |
| Passed TRADER_STRICT | 31 (31%) |
| Excluded | 69 (69%) |
| Valid Comparisons | 31 |
| Within 5% | 1 (3.2%) |
| Within 10% | 1 (3.2%) |

### 6.4 Exclusion Breakdown

| Reason | Count |
|--------|-------|
| Inventory Mismatch | 69 |

### 6.5 Failure Patterns in PASSED Wallets

| Pattern | Example | Count |
|---------|---------|-------|
| UI shows $0, V23c shows loss | Wallet 26: UI=$0, V23c=-$4,228 | ~12 |
| Sign inversion | Wallet 6: UI=$43.72, V23c=-$24.35 | ~5 |
| Magnitude difference (>10x) | Wallet 2: UI=$3,548, V23c=$12,846 | ~8 |
| Almost correct | Wallet 23: UI=$0, V23c=$0 (only match!) | 1 |

---

## 7. Why It Works on Some, Fails on Others

### 7.1 The Successful Cases

The 8/16 wallets that matched in the earlier (non-STRICT) test shared these traits:
- **Fully resolved positions** - All their trades were in markets that have resolved
- **Recent activity mapped** - Their tokens happened to be in `pm_market_metadata`
- **Simple trading patterns** - Buy, hold, market resolves, done

### 7.2 The Failure Modes

#### Mode 1: Token Mapping Gaps
Wallet trades token `X`. Token `X` is not in `pm_market_metadata.token_ids`.
Result: Trade is invisible to V23c. Cash flow incomplete → Wrong PnL.

#### Mode 2: Resolution Data Missing
Wallet has position in condition `Y`. Condition `Y` resolved but isn't in `pm_condition_resolutions`.
Result: Position marked at UI price instead of resolution price → Wrong PnL.

#### Mode 3: Price Oracle Mismatch
UI uses real-time orderbook prices. We use `pm_market_metadata.outcome_prices` which may be stale.
Result: Unrealized PnL calculation differs.

#### Mode 4: Dust and Rounding
UI displays rounded values. We calculate precise values.
Result: Small absolute differences become large percentage errors for small balances.

#### Mode 5: UI Filtering
UI may exclude certain market types (e.g., resolved as "No contest").
We include everything.
Result: Different totals.

---

## 8. The Root Causes We've Identified

### 8.1 Root Cause #1: Stale Token Mapping

**`pm_unified_ledger_v7`** was built with a token mapping from some point in the past. New tokens are not mapped.

**Evidence:**
- 69% of random wallets have "inventory mismatch"
- The mismatch is between ledger (stale) and CLOB (fresh)
- This isn't real inventory mismatch - it's mapping coverage gap

### 8.2 Root Cause #2: Incomplete Market Metadata

**`pm_market_metadata`** should have `token_ids` for every market. But:
- Some markets don't have token_ids populated
- Some token_ids are malformed or don't match CLOB format
- The Gamma API that populates this is not comprehensive

### 8.3 Root Cause #3: Resolution Coverage Gap

**`pm_condition_resolutions`** doesn't have all resolutions:
- Some resolved markets missing
- Some have malformed `payout_numerators`
- Timing: Resolution events happen after market close but ingestion may miss them

### 8.4 Root Cause #4: The TRADER_STRICT Paradox

TRADER_STRICT was designed to filter to "good" wallets. But:
- The filter uses the STALE ledger as ground truth
- Recent active wallets → appear as "inventory mismatch"
- We're filtering OUT the exact wallets we need to test

---

## 9. What We've Tried

### 9.1 Engine Iterations (V1-V28)

- V1-V10: Various aggregate formulas
- V11_POLY: FIFO cost basis tracking
- V17: Frozen canonical (still used for Cascadian production)
- V20: Best aggregate formula (0.01% on test wallets)
- V22: Split/Merge accounting (FAILED - double counting)
- V23: State machine approach
- V23b: Last trade price oracle
- V23c: UI price oracle (CURRENT)

### 9.2 Data Quality Fixes

- Refreshed `pm_market_metadata` from Gamma API
- Built `pm_token_to_condition_map_v4`
- Created `pm_unified_ledger_v7` (but it's now stale)
- Added "direct bypass" to read from raw tables

### 9.3 Classification Approaches

- MAKER classification (has splits/merges)
- TRADER_STRICT classification (inventory consistent)
- ERROR_RATE routing (which engine is accurate)

### 9.4 Accuracy Tests

- 16-wallet benchmark: 50% accuracy (no filter)
- 100-wallet proof-of-accuracy: 3.2% accuracy (with STRICT filter)

---

## 10. Recommendation: Abandon TRADER_STRICT

### 10.1 The Evidence

**Before TRADER_STRICT (16 wallets, no filter):**
- 8/16 within 5% = **50% accuracy**

**After TRADER_STRICT (100 wallets, filtered to 31):**
- 1/31 within 5% = **3.2% accuracy**

### 10.2 What This Tells Us

TRADER_STRICT is filtering based on STALE DATA. It's excluding wallets that are actually fine and including wallets that have data gaps.

### 10.3 Recommended Next Steps

1. **Abandon TRADER_STRICT filtering entirely**
   - The filter is broken because it relies on stale ledger data

2. **Fix the root cause: Token mapping**
   - Rebuild `pm_unified_ledger_v7` with fresh mapping
   - OR: Always use direct bypass from raw tables

3. **Use simpler accuracy measurement**
   - Pick 50 random wallets
   - Calculate V23c (no filter)
   - Compare to UI
   - Measure: How many within 5%?

4. **Focus on data completeness, not wallet selection**
   - Ensure `pm_market_metadata.token_ids` covers all traded tokens
   - Ensure `pm_condition_resolutions` has all resolutions
   - Ensure price oracle is fresh

### 10.4 Quick Win

Run the 16-wallet benchmark WITHOUT the STRICT filter and see if we still get 50%. If yes, the path forward is clear: fix data quality, not wallet filtering.

---

## 11. Complete File Reference

### 11.1 Core Engine Files

| File | Purpose |
|------|---------|
| `lib/pnl/shadowLedgerV23.ts` | V23 base engine (FROZEN CANONICAL) |
| `lib/pnl/shadowLedgerV23c.ts` | V23c with UI Price Oracle (CURRENT) |
| `lib/pnl/walletClassifier.ts` | TRADER_STRICT classification |

### 11.2 Test Scripts

| Script | Purpose |
|--------|---------|
| `scripts/pnl/proof-of-accuracy.ts` | 100-wallet validation test |
| `scripts/pnl/real-world-accuracy-test.ts` | 16-wallet benchmark |
| `scripts/pnl/benchmark-v23c.ts` | V23c benchmark runner |

### 11.3 Data Files

| File | Contents |
|------|----------|
| `data/proof-of-accuracy-results.json` | 100-wallet test results (3.2% accuracy) |
| `data/real-world-accuracy-results-v23c.json` | 16-wallet results (50% accuracy) |

### 11.4 Documentation

| Doc | Purpose |
|-----|---------|
| `docs/READ_ME_FIRST_PNL.md` | PnL system entry point |
| `docs/systems/pnl/PNL_METRIC_SPEC.md` | V17 frozen spec |
| `docs/systems/pnl/ENGINE_STATUS_2025_12_04.md` | V23 status |
| This file | Complete debriefing |

---

## Appendix A: Key SQL Patterns

### A.1 Deduplicating CLOB Trades (REQUIRED)

```sql
SELECT ... FROM (
  SELECT
    event_id,
    any(side) as side,
    any(usdc_amount) / 1000000.0 as usdc,
    any(token_amount) / 1000000.0 as tokens
  FROM pm_trader_events_v2
  WHERE trader_wallet = '0x...' AND is_deleted = 0
  GROUP BY event_id
) ...
```

### A.2 Token → Condition Mapping

```sql
WITH token_map AS (
  SELECT
    arrayJoin(token_ids) as token_id,
    condition_id,
    indexOf(token_ids, arrayJoin(token_ids)) - 1 as outcome_index
  FROM pm_market_metadata
  WHERE length(token_ids) > 0
)
SELECT *
FROM pm_trader_events_v2 t
INNER JOIN token_map tm ON t.token_id = tm.token_id
WHERE lower(t.trader_wallet) = lower('0x...')
```

### A.3 Resolution Price Lookup

```sql
SELECT
  condition_id,
  payout_numerators  -- "[0,1]" means outcome 0 loses, outcome 1 wins
FROM pm_condition_resolutions
WHERE condition_id = '0x...'
  AND is_deleted = 0
```

---

## Appendix B: The V20 Formula (Golden Standard)

This formula achieves 0.01% accuracy on test wallets:

```
realized_pnl = cash_flow + (final_tokens * resolution_price)
```

Where:
- `cash_flow` = SUM(usdc_delta) for all events
- `final_tokens` = SUM(token_delta) for all events
- `resolution_price` = 0 or 1 from `payout_numerators`

**Do not try to be clever.** This simple formula works.

---

## Appendix C: Contact & Sign-off

**Prepared by:** Claude 1
**Date:** December 5, 2025
**Session:** 100-Wallet Proof of Accuracy

**Key insight:** The TRADER_STRICT approach made accuracy WORSE (50% → 3.2%). The next agent should abandon this approach and focus on data quality instead of wallet filtering.

---

*End of debriefing.*
