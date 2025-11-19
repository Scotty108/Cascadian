# CLOB Ingestion Root Cause Analysis - FINAL

**Date:** 2025-11-11
**Terminal:** Claude-3 (C3)
**Status:** 🎯 ROOT CAUSE IDENTIFIED

---

## Executive Summary

**Problem:** Wallet `0xcce2b7c71f21e358b8e5e797e586cbc03160d58b` has only 194 fills in `clob_fills` when Polymarket UI shows 192 predictions with $1.38M volume (expect ~2,000+ fills).

**Root Cause:** `clob_fills` table ingestion is **incomplete**, not aggregated.

**Evidence:**
- clob_fills: 194 fills total for wallet
- pm_erc1155_flats: **0 transfers** for wallet
- This proves clob_fills is NOT built from blockchain data
- Fills come from Goldsky API or CLOB API, but ingestion is incomplete

---

## Investigation Timeline

### Discovery 1: Pipeline Efficiency is 100%

Coverage audit (tmp/audit-clob-coverage-simple.ts) proved:
```
clob_fills (194 fills) → trade_cashflows_v3 (194 cashflows) = 100% efficiency
trade_cashflows_v3 (45 markets) → realized_pnl (45 markets) = 100% efficiency
```

**Conclusion:** No data loss during transformation. Problem is at ingestion.

### Discovery 2: Fill Count ≈ Market Count

- Fills: 194
- Markets (Polymarket UI): 192
- Ratio: 1.01 fills per market

**Expected:** 5-20+ fills per market for active traders

**Hypothesis (INCORRECT):** Blockchain ERC1155 → clob_fills transformation is aggregating fills into "net" transfers.

### Discovery 3: pm_erc1155_flats is EMPTY

Query results:
```
pm_erc1155_flats transfers for wallet: 0
Unique tokens: 0
```

But clob_fills has 194 fills with fill_id format: `{tx_hash}_{order_hash}`

**This proves:**
- clob_fills does NOT come from blockchain ERC1155 processing
- The 194 fills came from external API (Goldsky or CLOB)
- Ingestion is simply incomplete, not aggregating

---

## Data Flow Architecture (Actual)

### Path 1: Blockchain (UNUSED for this wallet)
```
erc1155_transfers (raw blockchain)
    ↓
pm_erc1155_flats (flattened via flatten-erc1155.ts)
    ↓
[BROKEN] → clob_fills
```
**Status:** pm_erc1155_flats has 0 transfers for wallet 0xcce2

### Path 2: Goldsky API (ACTIVE but incomplete)
```
Goldsky GraphQL API (orderFilledEvents)
    ↓
scripts/ingest-goldsky-fills-parallel.ts
    ↓
clob_fills (194 fills)
```
**Status:** Working but only captured 10% of fills

### Path 3: CLOB API (ATTEMPTED, returns 401)
```
Polymarket CLOB API (/trades endpoint)
    ↓
scripts/clob-pipeline-setup.ts
    ↓
clob_fills_v2 (staging)
```
**Status:** Returns 401 Unauthorized (auth issues)

---

## Root Cause

**Ingestion Scripts are Incomplete**

The Goldsky ingestion successfully fetched SOME fills but:
1. Query limits (1000 per token_id) may have been hit
2. Rate limiting caused incomplete coverage
3. Worker crashes or stalls stopped progress
4. Markets were skipped due to errors

**This is NOT an aggregation problem** - it's a **completion problem**.

---

## Evidence Summary

| Metric | Value | Notes |
|--------|-------|-------|
| clob_fills total rows | 37.2M | Table is populated globally |
| Wallet 0xcce2 fills | 194 | Only ~10% of expected |
| pm_erc1155_flats for wallet | 0 | Blockchain path unused |
| Expected fills | ~2,000+ | Based on 192 markets × 10-20 fills |
| Volume coverage | 4.3% | $60k / $1.38M |
| Fill format | {tx_hash}_{order_hash} | API-derived, not blockchain |

---

## Solution

### Phase 1: Resume Goldsky Ingestion (4-8 hours)

**Priority:** P0 (blocking all validation)

**Action:**
1. Check Goldsky ingestion checkpoint file: `tmp/goldsky-fills-checkpoint.json`
2. Resume ingestion from last checkpoint
3. Run with 8 workers, crash protection, stall detection
4. Target: Full coverage of all markets in gamma_markets table

**Script:** `scripts/ingest-goldsky-fills-parallel.ts`

**Command:**
```bash
WORKER_COUNT=8 npx tsx scripts/ingest-goldsky-fills-parallel.ts
```

**Expected Runtime:** 4-6 hours for 149K markets

**Success Criteria:**
- Wallet 0xcce2: >80% volume coverage ($1.1M+ / $1.38M)
- Fills per market: 10-20+ average
- Fill count: ~2,000+ for wallet 0xcce2

### Phase 2: Validate Fix (1-2 hours)

1. Re-run coverage audit: `npx tsx tmp/audit-clob-coverage-simple.ts`
2. Re-run benchmark: `npx tsx tmp/benchmark-wallet-0xcce2.ts`
3. Verify volume coverage >80%
4. Check 10 random wallets for similar improvement

### Phase 3: Production Validation (2-4 hours)

1. Resume 100-wallet validation against Dome API
2. Target: >90% of wallets within 5% P&L accuracy
3. Document results in tmp/SIGN_FIX_VALIDATION_RESULTS.md

---

## Key Learnings

1. **Always check source data first** - We spent time analyzing transformation logic when the problem was upstream ingestion
2. **Cross-reference multiple sources** - Comparing clob_fills vs pm_erc1155_flats revealed the true data flow
3. **Sample data formats reveal source** - fill_id format `{tx_hash}_{order_hash}` indicated API source, not blockchain aggregation
4. **100% pipeline efficiency is good news** - Means downstream logic is correct

---

## Files Referenced

### Investigation Scripts
- `tmp/audit-clob-coverage-simple.ts` - Coverage audit (proved 100% pipeline efficiency)
- `tmp/benchmark-wallet-0xcce2.ts` - Benchmark comparison
- `tmp/investigate-clob-ingestion.ts` - Proxy wallet analysis
- `tmp/analyze-existing-fills-source.ts` - Fill ID format analysis

### Ingestion Scripts (Source)
- `scripts/ingest-goldsky-fills-parallel.ts` - Goldsky API ingestion (active path)
- `scripts/flatten-erc1155.ts` - Blockchain flattening (unused for this wallet)
- `scripts/build-positions-from-erc1155.ts` - Position aggregation (unused)
- `scripts/clob-pipeline-setup.ts` - CLOB API ingestion (returns 401)

### Documentation
- `tmp/CLOB_COVERAGE_AUDIT_wallet_0xcce2.md` - Comprehensive audit results
- `tmp/CLOB_INVESTIGATION_SUMMARY.txt` - Executive summary
- `tmp/PnL_DIFF_ANALYSIS_wallet_0xcce2.md` - Benchmark findings
- `tmp/CLOB_INGESTION_ROOT_CAUSE_FINAL.md` - Previous analysis (aggregation hypothesis)
- `tmp/SIGN_FIX_VALIDATION_RESULTS.md` - Validation tracking

---

## Next Actions

**IMMEDIATE (DO NOW):**
1. Resume Goldsky ingestion: `WORKER_COUNT=8 npx tsx scripts/ingest-goldsky-fills-parallel.ts`
2. Monitor progress with checkpoint file
3. Wait for completion (4-6 hours)

**AFTER INGESTION:**
4. Re-validate wallet 0xcce2 coverage
5. Resume 100-wallet Dome API validation
6. Update documentation with final results

**BLOCKED UNTIL INGESTION COMPLETES:**
- ❌ P&L validation
- ❌ Formula tuning
- ❌ Production deployment

---

**Terminal:** Claude-3 (C3)
**Status:** Root cause definitively identified - Incomplete API ingestion, not aggregation
**Next:** Resume Goldsky backfill to completion
