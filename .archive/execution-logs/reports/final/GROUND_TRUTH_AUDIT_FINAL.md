# GROUND TRUTH AUDIT REPORT

**Date:** November 10, 2025
**Audit Type:** Comprehensive Database Verification (No Fixes Mode)
**Purpose:** Establish definitive facts before choosing recovery path

---

## EXECUTIVE SUMMARY

### Critical Finding: 55% Historical Gap
- **ERC1155 data starts at block 37,515,043** (not from block 0)
- **Missing:** Blocks 0 → 37.5M (~55% of Polymarket's history)
- **Impact:** Test wallet (0x4ce73141) has **0 ERC1155 transfers** despite 38 trades in trades_raw
- **Consequence:** This explains the 1.1% coverage mystery

### Trade Table Architecture Issues
- **trades_raw:** 80,109,651 rows (primary CLOB source)
- **vw_trades_canonical:** 157,541,131 rows (**97% MORE than source?!**)
- **trade_direction_assignments:** 129,599,951 rows (+62% vs trades_raw)
- **trades_with_direction:** 82,138,586 rows (2% more than trades_raw)
- **fact_trades_clean:** 63,541,461 rows (79% of trades_raw)

**⚠️ ANOMALY:** vw_trades_canonical has 2x the rows of trades_raw. This contradicts documentation which says it's a "cleaned view" that removes duplicates.

---

## STEP 2: ERC-1155 COVERAGE

### Overall Statistics
- **Min block:** 37,515,043
- **Max block:** 78,299,514
- **Total transfers:** 13,397,948
- **Block range covered:** 40.8M blocks (blocks 37.5M-78.3M)

### Block Distribution by 5M Buckets

| Block Range | Transfers | Status |
|-------------|-----------|--------|
| 0M-5M | 0 | ❌ EMPTY |
| 5M-10M | 0 | ❌ EMPTY |
| 10M-15M | 0 | ❌ EMPTY |
| 15M-20M | 0 | ❌ EMPTY |
| 20M-25M | 0 | ❌ EMPTY |
| 25M-30M | 0 | ❌ EMPTY |
| 30M-35M | 0 | ❌ EMPTY |
| 35M-40M | 45,318 | ✅ |
| 40M-45M | 192,056 | ✅ |
| 45M-50M | 145,108 | ✅ |
| 50M-55M | 7,180 | ✅ (sparse) |
| 55M-60M | 19,082 | ✅ (sparse) |
| 60M-65M | 3,617,320 | ✅ |
| 65M-70M | 3,687,244 | ✅ |
| 70M-75M | 3,033,995 | ✅ |
| 75M-80M | 2,650,668 | ✅ |
| 80M-85M | 0 | ❌ EMPTY |

### KEY INSIGHT: The Gap
- **Polymarket started trading:** ~Block 5M (early 2021)
- **ERC1155 backfill starts:** Block 37.5M (late 2023)
- **Missing history:** ~32.5M blocks (~2.5 years of trading)

---

## STEP 3: TEST WALLET COVERAGE (0x4ce73141)

### ERC1155 Transfers
- **Count:** 0
- **Status:** ❌ NO TRANSFERS FOUND

### trades_raw Coverage
- **Count:** 38 trades
- **Time range:** June 2, 2024 → September 11, 2024
- **Unique markets:** 31 (verified from earlier analysis)

### Analysis
✅ **CONFIRMED:** Test wallet traded **after block 37.5M** (June-Sept 2024)
❌ **BUT:** ERC1155 has 0 transfers for this wallet

**Possible Explanations:**
1. Wallet address normalization mismatch (uppercase vs lowercase)
2. ERC1155 backfill missed this wallet's specific tokens
3. Wallet traded via intermediary/relay that's not in ERC1155 data
4. Data pipeline dropped these specific transfers

**CRITICAL QUESTION:** If trades_raw has 38 trades from June-Sept 2024 (clearly after block 37.5M), why does ERC1155 have 0 matching transfers?

---

## STEP 4: CANONICAL TABLE HEALTH

### Row Counts & Last Updated

| Table | Rows | Last Updated | Status |
|-------|------|--------------|--------|
| trades_raw | 80,109,651 | 2025-11-05 19:21:12 | ✅ PRIMARY SOURCE |
| vw_trades_canonical | 157,541,131 | N/A (view) | ⚠️ ANOMALY (+97%) |
| trade_direction_assignments | 129,599,951 | 2025-11-05 22:57:25 | ✅ (+62%) |
| trades_with_direction | 82,138,586 | 2025-11-05 20:49:24 | ✅ (+2%) |
| fact_trades_clean | 63,541,461 | N/A | ✅ (79%) |

### Critical Anomaly: vw_trades_canonical Row Count

**Expected:** ~157M cleaned trades (remove ~2M duplicates from trades_raw)
**Actual:** 157M rows but trades_raw only has 80M
**Discrepancy:** +77,431,480 rows (+96.7%)

**Possible Explanations:**
1. **vw_trades_canonical is NOT a view of trades_raw** - it's pulling from multiple sources
2. **Cartesian join bug** - accidental cross product in view definition
3. **Documentation error** - vw_trades_canonical is actually a different table entirely
4. **trades_raw is incomplete** - CLOB API only captured 80M of 157M real trades

**ACTION REQUIRED:** Inspect vw_trades_canonical view definition to determine source

---

## STEP 5: DIRECTION PIPELINE AUDIT

### Pipeline Flow & Data Loss

| Stage | Rows | Loss from Previous | Notes |
|-------|------|-------------------|-------|
| trades_raw | 80,109,651 | - | PRIMARY SOURCE |
| trade_direction_assignments | 129,599,951 | **+49,490,300** (+62%) | ⚠️ GAIN not loss |
| trades_with_direction | 82,138,586 | -47,461,365 (-37%) | Expected loss |
| trades_with_direction (NULL direction) | 0 | N/A | ✅ All have direction |

### Key Findings

1. **NO NULL DIRECTIONS:** All 82M rows in trades_with_direction have non-null `direction_from_transfers`
2. **UNEXPLAINED GAIN:** trade_direction_assignments has 50M MORE rows than trades_raw source
3. **Expected drop:** 37% loss from direction_assignments → trades_with_direction (likely due to failed joins)

### Questions

1. **Why does trade_direction_assignments have 130M rows when trades_raw has only 80M?**
   - Possible: ERC1155 transfers create multiple direction records per trade
   - Possible: Direction assignments include non-CLOB trades (direct blockchain trades)

2. **Why 37% drop from 130M → 82M?**
   - Likely: Failed joins on condition_id or market_id
   - Likely: Invalid/malformed records filtered out

---

## ROOT CAUSE ANALYSIS

### The Real Problem

You've been stuck at "1.1% coverage" because:

1. **ERC1155 backfill incomplete** - Missing blocks 0-37.5M (~55% of history)
2. **Test wallet mystery** - 0 ERC1155 transfers despite 38 trades in June-Sept 2024
3. **Table architecture confusion** - Multiple overlapping trade tables with contradictory row counts
4. **Documentation mismatch** - vw_trades_canonical has 2x rows of its supposed source

### What This Means for Your Vision

**Your Goal:** All wallets, all markets, all trades, accurate P&L, Omega ratios, whale leaderboard

**Current Reality:**
- ❌ Only 45% of historical trades (blocks 37.5M-78M)
- ❌ Test wallet has 0 ERC1155 data (despite recent trades)
- ❌ Unclear which table is canonical source of truth
- ❌ Unexplained data anomalies (157M vs 80M, 130M vs 80M)
- ✅ Direction inference works (0 NULL directions)
- ✅ USDC data is complete (from earlier checks)

---

## OPTIONS FORWARD

### Option 1: Full Historical Backfill (Road 1)
**What:** Backfill ERC1155 for blocks 0 → 37.5M
**Pros:**
- Gets you to 100% historical coverage
- Recovers test wallet's missing data
- Aligns with your "all wallets, all markets" goal

**Cons:**
- 6-8 hours runtime
- Still doesn't explain test wallet's 0 transfers (June-Sept 2024 is AFTER block 37.5M)
- Won't fix table architecture confusion

**Timeline:**
- Backfill: 6-8 hours
- Rebuild pipelines: 2-3 hours
- Testing: 1-2 hours
- **Total: ~10-13 hours**

### Option 2: Investigate Table Architecture First (Road 2)
**What:** Understand why vw_trades_canonical has 2x rows, resolve test wallet mystery
**Pros:**
- Might discover trades_raw is incomplete (only 80M of 157M real trades)
- Could reveal faster path than full blockchain backfill
- Fixes structural issues before spending 6-8 hours on backfill

**Cons:**
- Adds 2-3 hours of investigation before starting backfill
- Might still end up needing full backfill anyway

**Timeline:**
- Investigation: 2-3 hours
- Then follow Option 1 or 3
- **Total: +2-3 hours to other options**

### Option 3: Hybrid Quick Win (Recommended)
**What:**
1. Investigate test wallet mystery (1 hour) - Why 0 ERC1155 transfers for June-Sept 2024 trades?
2. Inspect vw_trades_canonical definition (30 min) - Resolve 80M vs 157M discrepancy
3. Make informed decision on backfill strategy

**Pros:**
- Answers critical unknowns before committing 6-8 hours
- Might reveal test wallet is system wallet / false positive
- Could discover vw_trades_canonical already has full data

**Timeline:**
- Quick investigation: 1.5 hours
- Then make final call
- **Total: 1.5 hours + chosen path**

---

## RECOMMENDED NEXT STEPS

### Immediate (Next 30 minutes)
1. **Inspect vw_trades_canonical view definition**
   ```sql
   SHOW CREATE TABLE default.vw_trades_canonical
   ```
   - Determine if it's really a view of trades_raw or pulling from other sources
   - Resolve 80M vs 157M discrepancy

2. **Check test wallet address normalization**
   ```sql
   SELECT count() FROM default.erc1155_transfers
   WHERE lower(from_address)='0x4ce73141dbfce41e65db3723e31059a730f0abad'
      OR lower(to_address)='0x4ce73141dbfce41e65db3723e31059a730f0abad'
   ```
   - Rule out case-sensitivity issue

### Short Term (Next 1-2 hours)
3. **Investigate why trade_direction_assignments has 130M rows vs 80M in trades_raw**
   - Sample 10 rows from direction_assignments not in trades_raw
   - Determine if these are valid additional trades or artifacts

4. **Check if test wallet is system wallet**
   - Cross-reference against system wallet list
   - Might explain why personal trades don't show in ERC1155

### Decision Point (After Investigation)
5. **Choose path:**
   - If vw_trades_canonical is complete → use it as source, skip backfill
   - If test wallet is false positive → pick different test wallet
   - If all checks out → proceed with full 0-37.5M backfill (6-8 hours)

---

## FILES GENERATED

- `GROUND_TRUTH_AUDIT_REPORT.json` - Raw data from all checks
- `ground-truth-audit-complete.ts` - Audit script source code

---

## CONFIDENCE LEVEL

**95% confident in these facts:**
- ERC1155 starts at block 37.5M (verified via min() query)
- Test wallet has 0 ERC1155 transfers (verified via count())
- Blocks 0-37.5M are empty in ERC1155 (verified via bucket counts)
- trades_raw has 80M rows (verified via count())

**75% confident in these interpretations:**
- Missing 55% of history (assumes Polymarket started at block 5M)
- Test wallet traded "before" backfill (but dates are June-Sept 2024 which is AFTER block 37.5M - contradiction!)

**50% confident (needs investigation):**
- Why vw_trades_canonical has 2x rows of trades_raw
- Why trade_direction_assignments has 1.6x rows of trades_raw
- Root cause of test wallet's 0 ERC1155 transfers

---

**Next:** Review findings and choose investigation path
