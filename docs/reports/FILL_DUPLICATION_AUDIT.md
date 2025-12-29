# Fill Duplication Audit Report

**Generated:** 2025-12-16T00:51:23.760Z

## Executive Summary

- **Wallets tested:** 5
- **Wallets with 0 rows (excluded from averages):** 1
- **Wallets with event_id duplicates:** 4 (80%)
- **Wallets with maker+taker pairs:** 4 (80%)

## Key Findings

### Duplication Rates (Average Across Wallets)

- **event_id duplicates:** 25.0%
- **transaction_hash duplicates:** 55.0%
- **Economic fill duplicates:** 32.4%

### Recommended Deduplication Strategy

**Recommendation:** Switch to `transaction_hash` as dedupe key.

- High event_id duplication suggests unreliable event_id generation
- transaction_hash is blockchain-canonical

### Maker-Only vs Full Deduplication

**Conclusion:** "Maker-only" filtering is a **HACK** that masks the real problem.

- 4/5 wallets have maker+taker pairs
- This suggests the same fill is being recorded twice with different roles
- **Root cause:** Insufficient deduplication, not intentional dual-perspective recording
- **Proper fix:** Deduplicate by economic fill identity (transaction_hash + amounts)

## Detailed Results

| Wallet | Total Rows | event_id Dupes | tx+log Dupes | Econ Dupes | Maker/Taker | M+T Pairs |
|--------|------------|----------------|--------------|------------|-------------|-----------|
| 0x35f0a66e... | 35138 | 3768 (10.7%) | 17224 (49.0%) | 5319 (15.1%) | 18500/12870 | 974 |
| 0x34393448... | 0 | 0 (NaN%) | 0 (NaN%) | 0 (NaN%) | 0/0 | 0 |
| 0x227c55d0... | 28506 | 10866 (38.1%) | 17145 (60.1%) | 13474 (47.3%) | 12605/5035 | 1915 |
| 0x222adc43... | 41700 | 9691 (23.2%) | 25901 (62.1%) | 12513 (30.0%) | 15799/16210 | 2820 |
| 0x0e5f632c... | 27337 | 7585 (27.7%) | 13317 (48.7%) | 10129 (37.1%) | 17417/2335 | 239 |

## Critical Observations

### Wallet 0x34393448... Has Zero Fills But V18 Shows -$8,259.78

This wallet has **0 rows in pm_trader_events_dedup_v2_tbl** yet V18 calculated -$8,259.78 PnL vs UI's $0.00.

**Possible explanations:**
1. **Data pipeline issue** - Fills were deleted or never ingested
2. **Table selection bug** - V18 is reading from a different table
3. **Wallet address mismatch** - Case sensitivity or normalization issue
4. **FPMM-only trades** - Wallet may only have AMM trades (not in CLOB fills table)

**Immediate action required:** Investigate why this wallet has PnL but no fills.

### Duplication Pattern Analysis

Across 4 wallets with data:
- **25% event_id duplication** - Moderate unreliability in event_id generation
- **55% transaction_hash duplication** - SEVERE: Over half of fills share transaction_hashes with other fills
- **32.4% economic duplication** - Even composite keys have significant duplicates

**Interpretation:** The high transaction_hash duplication (55%) suggests that multiple fills often occur in the same transaction. This is expected for market orders that match against multiple maker orders. However, event_id should still be unique per fill.

The fact that event_id has 25% duplication is concerning - it suggests event_ids are being reused or generated non-deterministically.

### Maker+Taker Double-Counting

**Evidence:** 4/5 wallets (80%) show maker+taker pairs where the same economic fill appears with both roles.

**Examples from console output:**
- Same transaction_hash, token_amount, usdc_amount
- Different event_ids (one maker, one taker)
- Both attributed to the SAME wallet

**This is the smoking gun for the 2x bug.**

## Root Cause Assessment

### Is "Maker-Only" a Hack or a Fix?

**Verdict: HACK**

The maker-only filter is masking a data quality issue, not solving the underlying problem. Here's why:

1. **Same fill recorded twice** - The examples show identical fills with different roles
2. **Should not happen** - A wallet is either the maker OR taker in a fill, never both
3. **Data pipeline bug** - Likely caused by joining CLOB fills with ERC1155 transfers incorrectly

**What "maker-only" does:**
- Arbitrarily drops one of the duplicate fills
- Happens to work because maker fills are more reliably recorded
- Breaks if taker-only fills exist (e.g., market orders against multiple makers)

**What we SHOULD do:**
- Fix the data pipeline to prevent dual-role attribution
- Use proper deduplication by economic fill identity
- Investigate why same fill gets both maker AND taker roles for one wallet

## Recommended Fix

### Phase 1: Immediate Tactical Fix (1-2 hours)

**Use transaction_hash as primary dedupe key:**

```sql
SELECT
  any(event_id) as event_id,
  any(role) as role,
  any(side) as side,
  any(token_amount) as token_amount,
  any(usdc_amount) as usdc_amount
FROM pm_trader_events_dedup_v2_tbl
WHERE trader_wallet = ?
GROUP BY transaction_hash, token_id
```

**Why this works:**
- Eliminates maker+taker duplication (same tx_hash groups together)
- Blockchain-canonical (transaction_hash is immutable)
- Simple to implement

**Trade-offs:**
- May lose granularity if multiple fills for same token in one transaction
- Doesn't fix the root cause

### Phase 2: Proper Economic Deduplication (4-6 hours)

**Use composite key capturing economic identity:**

```sql
SELECT
  any(event_id) as event_id,
  any(role) as role,
  any(side) as side,
  token_amount,
  usdc_amount
FROM pm_trader_events_dedup_v2_tbl
WHERE trader_wallet = ?
GROUP BY transaction_hash, token_id, token_amount, usdc_amount
```

**Why this is better:**
- Preserves multiple fills in same transaction with different amounts
- Still eliminates exact duplicates (same tx, token, and amounts)
- More precise than transaction_hash alone

### Phase 3: Root Cause Investigation (8-12 hours)

**Questions to answer:**
1. Why does the same fill appear with both maker AND taker roles for the same wallet?
2. Is this a JOIN issue in the data pipeline?
3. Are we ingesting from multiple sources that attribute roles differently?
4. Should we trust CLOB role field, or derive it from ERC1155 transfers?

**Recommended approach:**
- Trace one maker+taker pair back to raw data sources
- Compare CLOB fills vs ERC1155 transfers for that transaction
- Identify where dual-attribution occurs
- Fix at source

## Next Steps

1. **URGENT: Investigate wallet 0x34393448...** - Why 0 fills but -$8k PnL?
2. **Implement Phase 1 fix** - Switch to transaction_hash dedupe immediately
3. **Test on failing wallets** - Re-calculate PnL with new dedupe strategy
4. **Validate against UI** - Check if Phase 1 fix brings PnL closer to UI values
5. **Root cause investigation** - Trace maker+taker pairs to data pipeline bug
6. **Implement Phase 2** - Once validated, switch to economic composite key
7. **Document in PNL guide** - Add deduplication patterns to system documentation
