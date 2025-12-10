# V29 High-Coverage UI Validation Report

**Date:** 2025-12-07
**Benchmark Set:** `trader_strict_v2_2025_12_07`
**Coverage Filter:** >=95% resolution coverage
**Tolerance:** 6%

---

## Executive Summary

V29 total PnL validation against UI benchmarks on a **high-resolution-coverage subset** (>=95%) shows **0% pass rate**. Even with coverage gating, V29 fundamentally diverges from UI PnL values.

**Key Results:**
- **Total High-Coverage Wallets:** 22
- **Testable Wallets (|UI| > $100):** 14
- **Pass Rate (< 6% error):** 0/14 (0.0%)
- **Fail Rate (>= 6% error):** 14/14 (100.0%)

**Conclusion:** Coverage gating does NOT improve V29 vs UI accuracy. The discrepancy is NOT due to missing resolution data - it's a **fundamental calculation difference** between V29 and Polymarket UI.

---

## Coverage Filter Summary

| Coverage Band | Wallets | Conditions Range |
|---------------|---------|------------------|
| 100% coverage | 14 | 5 - 175 |
| 99-100% coverage | 3 | 172 - 740 |
| 95-99% coverage | 5 | 30 - 1256 |

**Note:** All 22 wallets have >=95% resolution coverage, meaning nearly all their traded conditions have resolution prices available.

---

## Validation Results

### Top 10 Worst Offenders (Sorted by % Error)

| Wallet | UI PnL | V29 Total | V29 Realized | V29 Unrealized | Abs Error | % Error |
|--------|--------|-----------|--------------|----------------|-----------|---------|
| 0xccf9...21f6 | $250 | -$1,913 | -$1,913 | $0 | $2,163 | 863.9% |
| 0xdf93...bdc8 | $5,000 | -$23,128 | -$20,931 | -$2,197 | $28,128 | 562.6% |
| 0xdfda...4fe6 | -$28,807 | $86,457 | $86,457 | $0 | $115,263 | 400.1% |
| 0xd2dd...8d79 | $172 | $854 | $854 | $0 | $682 | 396.5% |
| 0x4d6d...1ba1 | $3,792 | -$9,575 | -$9,575 | $0 | $13,367 | 352.5% |
| 0x2e41...f050 | $7,222 | $27,048 | $27,048 | $0 | $19,826 | 274.5% |
| 0x8eea...e285 | $213 | -$183 | -$185 | $3 | $395 | 185.9% |
| 0x688b...4fe1 | $95,000 | $341 | $341 | $0 | $94,659 | 99.6% |
| 0x17b4...4d48 | $98,000 | $4,915 | $4,929 | -$14 | $93,085 | 95.0% |
| 0x7a30...8abd | $2,440 | $675 | $731 | -$56 | $1,764 | 72.3% |

---

## Critical Patterns Observed

### Pattern 1: Sign Flips (UI Positive, V29 Negative)

4 wallets show UI reporting **positive** PnL while V29 reports **negative**:

| Wallet | UI | V29 | Coverage |
|--------|----|----|----------|
| 0xccf9...21f6 | +$250 | -$1,913 | 100% |
| 0xdf93...bdc8 | +$5,000 | -$23,128 | 95.2% |
| 0x4d6d...1ba1 | +$3,792 | -$9,575 | 96.7% |
| 0x8eea...e285 | +$213 | -$183 | 99.6% |

**Analysis:** Even with 100% coverage (0xccf9), V29 shows -$1,913 vs UI +$250. This is NOT a data gap issue.

### Pattern 2: Sign Flips (UI Negative, V29 Positive)

1 wallet shows opposite pattern:

| Wallet | UI | V29 | Coverage |
|--------|----|----|----------|
| 0xdfda...4fe6 | -$28,807 | +$86,457 | 100% |

**Analysis:** V29 shows $86K profit, UI shows $29K loss. Massive sign flip despite 100% coverage.

### Pattern 3: Massive Undercount (V29 < 5% of UI)

2 wallets show V29 capturing minimal value despite high coverage:

| Wallet | UI | V29 | Capture Rate | Coverage |
|--------|----|----|-------------|----------|
| 0x688b...4fe1 | $95,000 | $341 | 0.4% | 100% |
| 0x17b4...4d48 | $98,000 | $4,915 | 5.0% | 99.2% |

**Analysis:** Despite 100% coverage, V29 shows $341 vs UI $95K. This strongly suggests V29 is missing major event types (redemptions, settlements, etc.) that UI includes.

### Pattern 4: V29 Unrealized is Near-Zero

21/22 wallets show V29 unrealized = $0 or near-zero:

```
V29 Unrealized Distribution:
- $0: 18 wallets
- < $100: 3 wallets
- > $100: 1 wallet (0xdf93: -$2,197)
```

**Analysis:** V29 is treating nearly all positions as "realized only" which may explain massive undercounts if UI includes unrealized.

---

## Root Cause Analysis

### Hypothesis 1: V29 Excludes Major Event Types

**Evidence:**
- 0x688b: 100% coverage, UI=$95K, V29=$341 (0.4%)
- V29 unrealized is near-zero for 95% of wallets
- Sign flips occur despite 100% coverage

**Likely Missing:**
1. Redemptions/settlements (CTF ConditionResolution events)
2. Split/merge operations
3. Transfer gains/losses
4. Fee rebates or rewards

### Hypothesis 2: Different PnL Definitions

**V29 Definition:** `realizedPnl = cash_flow + final_shares * resolution_price`

**UI Definition (Unknown):** May include:
- Mark-to-market unrealized gains
- Pending redemptions
- Different cost basis methods

### Hypothesis 3: Event Filtering Issues

V29's `inventoryGuard` or `safeTraderStrict` filters may be excluding valid events that UI includes.

---

## Comparison: Coverage-Gated vs Full Cohort

| Metric | Full Cohort (42) | High-Cov (22) |
|--------|-----------------|---------------|
| Testable Wallets | 17 | 14 |
| Pass Rate (< 6%) | 0% | 0% |
| Median % Error | ~200% | ~200% |
| Sign Flips | 4 | 4 |

**Conclusion:** Coverage gating does NOT improve accuracy. The V29 vs UI discrepancy is fundamental, not due to missing resolution data.

---

## Files Generated

- `tmp/ui_wallets_trader_strict_v2_highcov.json` - 22 high-coverage wallets
- `tmp/ui_resolution_coverage_trader_strict_v2_2025_12_07.json` - Coverage data per wallet
- `tmp/v29_vs_ui_highcov_validation_2025_12_07.json` - Full validation results

---

## Recommended Next Steps

### P0: Deep Event-Type Audit
For wallet 0x688b (100% coverage, 99.6% undercount):
1. List ALL event types in `pm_unified_ledger_v8_tbl`
2. Compare with V29 event processing
3. Identify missing event types

### P1: Compare with Dome API
Run same high-coverage wallets against Dome API to determine if:
- V29 matches Dome (suggests UI uses different definition)
- V29 differs from Dome (suggests V29 bug)

### P2: Document UI vs V29 Definition Difference
Create formal spec documenting exactly what events/calculations each includes.

---

**Terminal 2 Signed: 2025-12-07**
**Status:** Coverage-gated validation complete - 0% pass rate confirms fundamental engine discrepancy
**Next Session:** Event-type audit on 100%-coverage wallet to identify missing PnL sources
