# P&L Difference Analysis: Wallet 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b

**Analysis Date:** 2025-11-11
**Analyst:** Claude-3 (Terminal C3)

---

## Executive Summary

**CRITICAL FAILURE:** CLOB ingestion is missing **76.6% of markets** and **95.7% of volume** for this wallet.

- **Market Coverage:** 45 / 192 markets (23.4%)
- **Volume Coverage:** $60k / $1.38M (4.3%)
- **P&L Error:** $155k (163.3%)

This wallet confirms the pattern observed in wallet 0x1699 - **CLOB ingestion is systematically broken**.

---

## Ground Truth (Polymarket UI)

| Metric | Value |
|--------|-------|
| **Net P&L** | +$95,363.53 (PROFIT) |
| **Gains** | +$206,781.48 |
| **Losses** | -$111,417.95 |
| **Predictions** | 192 |
| **Volume** | $1,380,000 |
| **Open Positions** | $151,400 |

---

## Our Calculation

| Metric | Value |
|--------|-------|
| **Net P&L** | -$60,360.22 (LOSS) |
| **Gains** | +$5,716.14 |
| **Losses** | -$66,076.36 |
| **Markets** | 45 |

---

## External Validation

| Source | P&L |
|--------|-----|
| **Dome API** | +$87,030.51 (PROFIT) |
| **Polymarket UI** | +$95,363.53 (PROFIT) |
| **Our Calculation** | -$60,360.22 (LOSS) |

**Dome-UI difference:** $8,333 (8.7%) - Within acceptable range
**Our-UI difference:** $155,724 (163%) - CATASTROPHIC ERROR

---

## Data Coverage Analysis

### CLOB Fills (Source Data)
```
Total fills: 194
Unique conditions: 45
Volume: $59,635.83

Expected: ~2,000 fills, 192 conditions, $1.38M volume
Actual coverage: ~10% fills, 23% markets, 4% volume
```

### Trade Cashflows (Processed Data)
```
Total cashflows: 194
Unique markets: 45
Volume: $59,635.83

Pipeline efficiency: 100% (no data loss in transformation)
```

### Realized P&L (Final Calculation)
```
Markets: 45
Total P&L: -$60,360.22

Coverage: 23.4% of expected markets
```

---

## Top Markets by P&L

| Rank | Condition ID | P&L |
|------|--------------|-----|
| 1 | 6541d506c7a337b8... | -$64,054 |
| 2 | a0811c97f529d627... | +$3,069 |
| 3 | 7decaf7834aa2fda... | +$1,900 |
| 4 | 7bdc006d11b7dff2... | +$720 |
| 5 | 8e02dc3233cf073a... | -$418 |

**Note:** The single largest loss (-$64k) accounts for most of our calculated P&L. This may be a formula error on a high-volume market.

---

## Root Cause Analysis

### Issue #1: CLOB Ingestion Failure (PRIMARY BLOCKER)

**Evidence:**
- Only 45 / 192 markets captured (23.4%)
- Only $60k / $1.38M volume captured (4.3%)
- Missing ~147 markets (~1,940 fills)

**Suspected Causes:**
1. **Proxy wallet resolution incomplete**
   - Wallet may trade through multiple proxy contracts
   - Our mapping may only capture 1-2 proxies

2. **Time range gaps**
   - Backfill may not cover full trading history
   - Recent trades may not be ingested

3. **CLOB API pagination**
   - May be stopping after first page
   - Missing bulk of historical fills

4. **Over-filtering**
   - Deduplication logic may be too aggressive
   - Valid fills may be excluded

### Issue #2: P&L Formula Sign Error (SECONDARY)

**Evidence:**
- Our calc shows -$60k LOSS
- Dome/UI show +$87k/+$95k PROFIT
- This is a **$155k sign flip**

**Even with full data, formula is broken.**

**Suspected Causes:**
1. BUY/SELL direction inverted
2. Cost basis sign wrong
3. Payout calculation reversed

---

## Data Pipeline Health

| Stage | Input | Output | Efficiency |
|-------|-------|--------|------------|
| CLOB Ingestion | ??? | 194 fills | **BROKEN** |
| Cashflow Processing | 194 fills | 194 cashflows | ✅ 100% |
| P&L Calculation | 45 markets | 45 markets | ✅ 100% |

**Conclusion:** Pipeline logic is correct. Source data is missing.

---

## Comparison with Wallet 0x1699

| Metric | Wallet 0x1699 | Wallet 0xcce2 | Pattern |
|--------|---------------|---------------|---------|
| **Expected Markets** | ~70 | 192 | - |
| **Captured Markets** | 30 | 45 | - |
| **Coverage** | 43% | 23% | ❌ SYSTEMATIC FAILURE |
| **Volume Coverage** | ~6% | 4% | ❌ CATASTROPHIC |

**BOTH WALLETS SHOW THE SAME FAILURE PATTERN.**

This is **not wallet-specific** - it's a **systemic CLOB ingestion issue**.

---

## Recommendations

### Immediate Actions (Priority Order)

1. **Investigate CLOB Ingestion Pipeline**
   - [ ] Check proxy wallet resolution for wallet 0xcce2
   - [ ] Verify CLOB API query parameters
   - [ ] Check pagination implementation
   - [ ] Audit filtering/deduplication logic
   - [ ] Compare against Polymarket's internal API

2. **Validate Coverage on More Wallets**
   - [ ] Test 5-10 random wallets
   - [ ] Calculate actual coverage distribution
   - [ ] Identify if any wallets have >80% coverage

3. **Fix CLOB Ingestion**
   - [ ] Implement multi-proxy support
   - [ ] Fix pagination if broken
   - [ ] Expand time range if needed
   - [ ] Re-backfill all wallets

4. **Fix P&L Formula** (After ingestion fixed)
   - [ ] Investigate sign flip
   - [ ] Validate cost basis calculation
   - [ ] Test on wallets with full data

### Do NOT Proceed With:
- ❌ 100-wallet validation (data is too incomplete)
- ❌ Production deployment (results are 163% off)
- ❌ Formula tuning (need full data first)

---

## Success Criteria (Post-Fix)

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| **Market Coverage** | >80% | 23% | ❌ FAILED |
| **Volume Coverage** | >80% | 4% | ❌ FAILED |
| **P&L Error** | <5% | 163% | ❌ FAILED |

**None of the criteria are met. System is not production-ready.**

---

## Files Generated

- `tmp/benchmark-wallet-0xcce2-results.json` - Raw metrics
- `tmp/PnL_DIFF_ANALYSIS_wallet_0xcce2.md` - This analysis
- `tmp/DIAGNOSIS_ROOT_CAUSE.md` - Technical deep dive on wallet 0x1699

---

**Conclusion:** CLOB ingestion must be fixed before any further P&L validation work.
