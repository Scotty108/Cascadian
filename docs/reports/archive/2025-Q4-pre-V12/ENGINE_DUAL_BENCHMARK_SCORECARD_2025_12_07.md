# Engine Dual Benchmark Scorecard

**Date:** 2025-12-07
**Status:** Complete
**Sample Size:** 8-10 wallets (CLOB-only, transfer-free, |PnL| >= $200)

## Executive Summary

Tested V11, V29, and V23C PnL engines against two ground truths:
- **Dome** - Realized PnL (closed positions)
- **UI (Polymarket)** - Total PnL (realized + unrealized)

### Winner by Metric

| Benchmark | Best Engine | Pass Rate | Median % Error |
|-----------|-------------|-----------|----------------|
| **Dome (Realized)** | V23C | 10% | 64% |
| **UI (Total)** | **V29** | **50%** | **3.8%** |

**Recommendation:** Use **V29** for copy-trade leaderboard UI parity.

---

## Detailed Results

### Dome Validation (Realized PnL) - 10 Wallets

| Engine | Pass Rate | Median % Error | Median $ Error | Avg Time |
|--------|-----------|----------------|----------------|----------|
| V11 | 10% (1/10) | 100% | $3,615 | 4.5s |
| V29 | 10% (1/10) | 91% | $12,357 | 7.0s |
| **V23C** | **10% (1/10)** | **64%** | **$1,365** | 22.5s |

**Key Issues:**
- V11: Returns $0 for many wallets (data gaps)
- V29: Sign disagreements, massive overestimates
- V23C: Lower error but still inconsistent

### UI Validation (Total PnL) - 8 Wallets

| Engine | Pass Rate | Median % Error | Median $ Error | Avg Time |
|--------|-----------|----------------|----------------|----------|
| V11 | 25% (2/8) | 100% | $1,818 | 636ms |
| **V29** | **50% (4/8)** | **3.8%** | **$2,271** | 363ms |
| V23C | 12.5% (1/8) | 57% | $2,055 | 3.7s |

**V29 Wins:**
- 50% pass rate (best)
- 3.8% median error (best)
- 363ms average time (fastest)

---

## Wallet-by-Wallet Analysis

### Perfect Matches (All Engines Pass)

| Wallet | UI Total | Dome Realized | All Engines |
|--------|----------|---------------|-------------|
| `0x258a6d3f...` | $102,200 | $102,200 | $102,200 |

This wallet has no active positions, so UI = Dome = All engines.

### V29 Best Performance

| Wallet | UI Total | V29 Total | Error |
|--------|----------|-----------|-------|
| `0x0122006b...` | $244.10 | $244.10 | 0% |
| `0x199aefef...` | $1,718.11 | $1,718.12 | <0.01% |
| `0x57c22158...` | $59,818.80 | $62,089.35 | 3.8% |

### V29 Worst Failures

| Wallet | UI Total | V29 Total | Issue |
|--------|----------|-----------|-------|
| `0xe62d0223...` | $48,596 | $501,774 | 932% error (massive overestimate) |
| `0x01cedeca...` | -$1,890 | $46,797 | Sign disagreement |

---

## Engine Characteristics

### V11 (CLOB-Only with Rounding)
- **Pros:** Fast, consistent formula
- **Cons:** Returns $0 for many wallets, missing data coverage
- **Use Case:** Not recommended due to data gaps

### V29 (Inventory Tracking, Condition-Level Pooled Cost)
- **Pros:** Best UI parity, fastest compute time
- **Cons:** Some outliers with massive overestimates
- **Use Case:** **Copy-trade leaderboard (UI-facing)**

### V23C (Shadow Ledger, UI Price Oracle)
- **Pros:** Most conservative estimates
- **Cons:** Slow (22s avg), high error on UI total
- **Use Case:** Not recommended for production

---

## Recommendations

### For Copy-Trade Leaderboard

1. **Use V29** as the primary engine for total PnL display
   - 50% pass rate against UI (best of all engines)
   - 3.8% median error (best of all engines)
   - Fast compute (363ms avg)

2. **Filter outliers** - V29 has occasional massive overestimates
   - Implement sanity checks (e.g., total PnL < 10x realized)
   - Flag wallets with |PnL| > $500K for manual review

3. **Do not rely on Dome for total PnL** - Dome is realized-only
   - Use Dome as a sanity check for realized component

### Future Improvements

1. **Investigate V29 outliers** - Why does `0xe62d0223...` show $501K vs $48K UI?
2. **Expand sample size** - Run on 100+ wallets for statistical significance
3. **Add unrealized position tracking** - V29 may be double-counting active positions

---

## Files Generated

| File | Description |
|------|-------------|
| `tmp/clob_10_wallets.json` | Test wallet set |
| `tmp/ui_10_wallets.json` | UI PnL scraped via Playwright |
| `tmp/realized_vs_dome_10.json` | Dome validation results |
| `tmp/total_vs_ui_10.json` | UI validation results |

---

## Appendix: Raw Pass/Fail Matrix

### UI Validation (8 wallets)

| Wallet | UI PnL | V11 | V29 | V23C |
|--------|--------|-----|-----|------|
| `0x0122...` | $244 | PASS | PASS | FAIL |
| `0x0148...` | -$75 | FAIL | FAIL | FAIL |
| `0x01ce...` | -$1,890 | FAIL | FAIL | FAIL |
| `0x199a...` | $1,718 | FAIL | PASS | FAIL |
| `0x258a...` | $102,200 | PASS | PASS | PASS |
| `0x569e...` | -$73,453 | FAIL | FAIL | FAIL |
| `0x57c2...` | $59,819 | FAIL | PASS | FAIL |
| `0xe62d...` | $48,596 | FAIL | FAIL | FAIL |

**V29 passes:** 4/8 (50%)
**V11 passes:** 2/8 (25%)
**V23C passes:** 1/8 (12.5%)
