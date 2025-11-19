# TRUE COVERAGE CRISIS: Phase 1 Insufficient

**Date:** 2025-11-08
**Analysis Type:** Ground Truth Coverage Calculation
**Status:** 🚨 CRITICAL - Phase 1 Approach Inadequate

---

## Executive Summary

The TRUE coverage calculation reveals a **severe data quality crisis**:

- **Transaction Coverage:** 99.77% (looks good)
- **BUT Wallet Coverage:** Only 1.61% of wallets have ≥80% of trades covered
- **Verdict:** ❌ **PHASE 1 INSUFFICIENT** - Blockchain backfill required

---

## The Paradox Explained

### What Looks Good (But Isn't)

```
Total unique transactions: 33,689,815
Recoverable with Phase 1: 33,612,817
Transaction coverage: 99.77% ✅
```

This makes it look like we can recover nearly everything from existing tables.

### The Real Problem (Wallet-Level View)

```
Total wallets: 996,109
Wallets with ≥80% coverage: 16,045 (1.61%) ❌
Wallets with ≥90% coverage: 6,656 (0.67%) ❌
Wallets with ≥95% coverage: 4,796 (0.48%) ❌
```

**What this means:** 98.39% of wallets have incomplete trading histories with <80% coverage.

---

## Why This Matters

### For P&L Calculation
- **Cannot compute accurate P&L** if we're missing 20%+ of trades per wallet
- Positions will be wrong
- Realized gains/losses will be incorrect
- Unrealized P&L will be nonsensical

### For Smart Money Tracking
- **Cannot identify smart money** if we can't see their full trading history
- Win rates will be skewed
- Volume metrics will be understated
- ROI calculations will be garbage

### For Strategy Execution
- **Cannot copy trade reliably** if we don't know what positions wallets actually hold
- Risk models will be based on incomplete data
- Alerts will fire on phantom trades

---

## Source Table Breakdown

All three source tables show ~50% coverage at the row level:

| Table | Valid Rows | Total Rows | Coverage |
|-------|-----------|------------|----------|
| `vw_trades_canonical` | 80,109,651 | 157,541,131 | **50.85%** |
| `trades_raw_enriched_final` | 86,100,149 | 166,913,053 | **51.58%** |
| `trade_direction_assignments` | 65,010,262 | 129,599,951 | **50.16%** |

**Interpretation:** The high transaction coverage (99.77%) comes from UNION DISTINCT deduplication, but individual rows within each table are only 50% valid.

---

## Why Transaction Coverage ≠ Wallet Coverage

The 99.77% transaction coverage is **misleading** because:

1. **Deduplication effect:** UNION DISTINCT collapses duplicates across tables
2. **Sparse distribution:** Valid condition_ids are distributed unevenly across wallets
3. **High-volume wallets bias:** A few whales with complete data inflate the transaction count
4. **Long-tail problem:** 98% of wallets are small/medium traders with gaps

### Example Scenario

```
Wallet A (whale): 10,000 trades, 100% valid → 10,000 valid txs
Wallet B (normal): 100 trades, 50% valid → 50 valid txs
Wallet C (normal): 100 trades, 50% valid → 50 valid txs
...
Wallet Z (normal): 100 trades, 50% valid → 50 valid txs

Total: 10,000 + (999 × 50) = 59,950 valid / 109,900 total = 54.5%
Transaction coverage: Still appears high due to whale volume
Wallet coverage: 1/1000 = 0.1% have ≥80% coverage ❌
```

---

## Root Cause: condition_id Gaps

The fundamental issue is that **50% of rows are missing valid condition_ids**:

```sql
-- Invalid patterns we're filtering out:
condition_id_norm = ''                           -- Empty
condition_id_norm = concat('0x', repeat('0',64)) -- All zeros
length(replaceAll(condition_id_norm, '0x', '')) != 64  -- Wrong length
```

**Why are these missing?**
1. Early Polymarket trades (pre-ERC1155 era)
2. API failures during backfill
3. Blockchain indexing gaps
4. Markets that never resolved
5. Trades in markets that were deleted/hidden

---

## Verdict & Recommendation

### ❌ Phase 1 (Existing Tables) = INSUFFICIENT

**Cannot ship `fact_trades_v1` with Phase 1 approach** because:
- 98.39% of wallets have <80% coverage
- P&L will be wrong for nearly all users
- Smart money detection will fail
- Copy trading will be unreliable

### ✅ Phase 2 (Blockchain Backfill) = REQUIRED

**Must implement blockchain reconstruction** to:
1. Recover missing condition_ids from ERC1155 Transfer events
2. Map token_ids back to markets via CTF Exchange contracts
3. Validate against CLOB API data
4. Achieve ≥85% wallet coverage threshold

---

## Next Steps

1. **STOP Phase 1 implementation** - Do not build `fact_trades_v1` yet
2. **START Phase 2 planning** - Design blockchain backfill pipeline
3. **Estimate effort** - How long will Phase 2 take?
4. **Alternative approach?** - Can we ship a limited beta with high-coverage wallets only?

---

## Coverage Threshold Gates

From CLAUDE.md Stable Pack:

```
Global wallet coverage ≥80%: Required for production
Per-wallet coverage ≥80%: Required for individual wallet P&L
High confidence coverage ≥95%: Required for smart money flagging
```

**Current status:**
- Global wallet coverage: 1.61% ❌ (need 80%)
- Per-wallet ≥80%: 1.61% ❌ (need 80%+)
- High confidence ≥95%: 0.48% ❌ (need for smart money)

**All gates failed.**

---

## Questions for Product Decision

1. **Can we launch with 1.61% wallet coverage?**
   - Maybe if we show "beta" badge and warn users?
   - Only enable P&L for wallets with ≥80% coverage?

2. **How much time do we have for Phase 2?**
   - Days? Weeks? Months?
   - Is there pressure to ship now?

3. **Alternative: Hybrid approach?**
   - Ship Phase 1 for high-coverage wallets only
   - Run Phase 2 backfill in background
   - Gradually expand coverage

4. **What's the MVP feature set?**
   - Just portfolio tracking (lower quality OK)?
   - Or smart money alerts (high quality required)?

---

## Technical Appendix

### Query Used for Analysis

See: `/Users/scotty/Projects/Cascadian-app/calculate-true-coverage.ts`

### Key Metrics

```
Total unique transactions: 33,689,815
Recoverable transactions: 33,612,817
Transaction coverage: 99.77%

Total wallets: 996,109
Wallets ≥80% coverage: 16,045 (1.61%)
Wallets ≥90% coverage: 6,656 (0.67%)
Wallets ≥95% coverage: 4,796 (0.48%)
```

### Valid condition_id Definition

```sql
condition_id_norm != ''
AND condition_id_norm != concat('0x', repeat('0',64))
AND length(replaceAll(condition_id_norm, '0x', '')) = 64
```

---

**Bottom Line:** We cannot proceed with Phase 1. The wallet coverage is catastrophically low. Phase 2 blockchain backfill is mandatory.
