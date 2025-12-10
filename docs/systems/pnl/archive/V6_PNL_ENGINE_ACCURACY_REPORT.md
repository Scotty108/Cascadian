# V6 PnL Engine Accuracy Report

**Date:** 2025-11-30
**Status:** Experiment Complete
**Verdict:** NegRisk tracking helps high-volume wallets but harms others with flat cost basis

---

## Executive Summary

We implemented and tested a V6 PnL engine that adds NegRisk conversion tracking with $0.26 cost basis to V3's average cost method to see if it would improve accuracy.

**Result: Massive improvement for worst wallet, but overall WORSE due to cost basis overfitting.**

| Metric | V3 (Average Cost) | V6 (+ NegRisk @$0.26) | Difference |
|--------|-------------------|----------------------|------------|
| Sign Accuracy | 77.6% | 77.6% | 0% |
| Median Error | 24.2% | 87.5% | +63.3% (WORSE) |
| Mean Error | 48.6% | 146.5% | +97.9% (WORSE) |
| Exact Matches (<1%) | 4 | 3 | -1 |

**Key Finding:** The $0.26 cost basis was calibrated on a single high-volume wallet and doesn't generalize.

---

## Hypothesis

Based on the Root Cause Investigation identifying NegRisk conversions as the source of sign mismatches for wallets selling more tokens than they buy, we hypothesized that tracking NegRisk acquisitions with a fixed cost basis would improve accuracy.

**Expected improvement:** Sign accuracy from 77.6% to 85%+, median error <15%
**Actual result:** One spectacular fix (+175pp), but 10 wallets regressed by >100pp each

---

## Implementation

### V6 Engine: `lib/pnl/uiActivityEngineV6.ts`

Key changes from V3:

```typescript
// Standard cost basis for NegRisk conversions
const NEGRISK_COST_BASIS = 0.26; // Calibrated on worst wallet

// NegRisk acquisitions loaded from vw_negrisk_conversions view
const negRiskAcquisitions = await getNegRiskAcquisitionsForWallet(wallet);

// Converted to synthetic BUY events
case 'NEGRISK_ACQUISITION':
  negrisk_acquisition_count++;
  negrisk_tokens_acquired += event.qty_tokens;
  negrisk_cost_basis += event.usdc_notional;
  state.position_cost += event.usdc_notional;
  state.position_qty += event.qty_tokens;
  break;
```

### NegRisk View: `vw_negrisk_conversions`

```sql
CREATE VIEW vw_negrisk_conversions AS
SELECT
    lower(to_address) as wallet,
    tx_hash,
    block_number,
    block_timestamp,
    lower(from_address) as source_contract,
    token_id as token_id_hex,
    reinterpretAsUInt64(reverse(unhex(substring(value, 3)))) / 1000000.0 as shares,
    0.5 as cost_basis_per_share
FROM pm_erc1155_transfers
WHERE lower(from_address) IN (
    '0xd91e80cf2e7be2e162c6513ced06f1dd0da35296',  -- NegRisk Adapter
    '0xc5d563a36ae78145c45a50134d48a1215220f80a'   -- NegRisk CTF
)
```

View stats:
- 15.6M total events
- 774K unique wallets
- $4.03B total shares
- $2.02B implied cost basis (@$0.50)

---

## Test Results

### Validation Set: 50 Known Wallets (49 processed, 1 query size error)

### Focus Wallets (From Implementation Plan)

| Wallet | UI PnL | V3 PnL | V6 PnL | V3 Error | V6 Error | Verdict |
|--------|--------|--------|--------|----------|----------|---------|
| 0x4ce73141... | +$332K | -$283K | +$364K | -185% | +9.6% | **V6 FIXED!** |
| 0x8e9eedf2... | +$360K | -$73K | -$95K | -120% | -126% | Both wrong |
| 0x12d6ccc... | +$150K | $0 | $0 | -100% | -100% | No data |

### Sign Accuracy

| Engine | Correct Signs | Accuracy |
|--------|--------------|----------|
| V3 | 38/49 | 77.6% |
| V6 | 38/49 | 77.6% |

**Sign changes:**
- Fixed by V6: 1 wallet (0x4ce73141...)
- Broken by V6: 1 wallet (0x9d36c904...)
- Net change: 0

### Error Distribution

| Threshold | V3 Count | V6 Count | Delta |
|-----------|----------|----------|-------|
| Within 1% | 4 (8%) | 3 (6%) | -1 |
| Within 5% | 5 (10%) | 5 (10%) | 0 |
| Within 10% | 11 (22%) | 9 (18%) | -2 |
| Within 15% | 15 (31%) | 11 (22%) | -4 |
| Within 25% | 27 (55%) | 15 (31%) | -12 |
| Within 50% | 31 (63%) | 19 (39%) | -12 |

### NegRisk Correlation

| Category | Count | V6 Better |
|----------|-------|-----------|
| Wallets WITH NegRisk | 32 | 8 (25%) |
| Wallets WITHOUT NegRisk | 17 | 0 (0%) |

Total NegRisk acquisitions: 46,750 events
Total NegRisk tokens: 29.5M
Total NegRisk cost basis: $7.7M

---

## Why V6 Made Things Worse Overall

### The Core Problem: Cost Basis Doesn't Generalize

The $0.26 cost basis was calibrated on wallet 0x4ce73141... which has:
- 25,583 NegRisk events
- 16M NegRisk tokens acquired
- Sells 10x more than buys via CLOB

For this wallet, $0.26 produces excellent results (+9.6% error vs -185% in V3).

**However**, for wallets with fewer NegRisk events:
- Lower token volumes mean the cost basis has outsized impact
- $0.26 is TOO LOW for typical conversions
- Results in inflated realized PnL when selling

### Top 5 Regressions

| Wallet | V3 Error | V6 Error | NegRisk Events | Issue |
|--------|----------|----------|----------------|-------|
| 0xa60acdbd... | +9.3% | +2058% | 7 | Small NR count, cost too low |
| 0xbc51223c... | -35.6% | +860% | 7 | Small NR count, cost too low |
| 0x2a019dc0... | +14.8% | +395% | 840 | Moderate NR count, cost too low |
| 0x89915ad0... | -96% | -411% | 1 | Single NR event, cost too low |
| 0x1f0a3435... | +24.5% | +284% | 4,487 | High NR, but wrong cost |

### Pattern: $0.26 is Wrong for Most Wallets

For wallets where V6 worked:
- 0x4ce73141...: 25,583 NR events → Perfect
- 0xcce2b7c7...: 92 NR events → Improved
- 0xc02147de...: 349 NR events → Improved

For wallets where V6 failed:
- 0xa60acdbd...: 7 NR events → 2000%+ worse
- 0x1f0a3435...: 4,487 NR events → 259% worse

The cost basis needs to be **wallet-specific** or **event-specific**, not flat.

---

## Alternative Approaches Not Yet Tried

### 1. Dynamic Cost Basis

Instead of flat $0.26, calculate from market prices at conversion time:
```typescript
// Lookup price at block_timestamp
const priceAtConversion = await getMarketPrice(tokenId, blockTimestamp);
const costBasis = shares * priceAtConversion;
```

**Pros:** More accurate per-event
**Cons:** Requires price lookup infrastructure, slow

### 2. $0.50 Cost Basis (Standard Split Price)

Earlier test showed $0.50 made worst wallet WORSE (-$3.47M vs -$282K).
For most wallets, $0.50 may be closer to reality.

### 3. USDC Flow Tracking

Track actual USDC spent on NegRisk conversions rather than imputing cost basis:
```sql
-- Match NegRisk ERC1155 transfers to USDC transfers in same tx
SELECT
  nr.wallet,
  nr.tx_hash,
  usdc.value as actual_usdc_spent
FROM vw_negrisk_conversions nr
JOIN usdc_transfers usdc ON nr.tx_hash = usdc.tx_hash
```

**Pros:** Actual cost, not estimated
**Cons:** Requires USDC transfer data, complex joins

### 4. Don't Track NegRisk at All (V3 Approach)

Accept that NegRisk-heavy wallets have sign issues, focus on:
- Improving data completeness (6 wallets returning $0)
- Better redemption tracking
- Alternative PnL methodologies

---

## Conclusion

### V6 Status: Not Recommended for Production

The V6 engine with NegRisk tracking at flat $0.26 cost basis provides a spectacular fix for one extreme wallet but causes regressions for 24/32 wallets with NegRisk activity.

### Key Learnings

1. **NegRisk IS the source of sign mismatches** for high-volume traders
2. **Flat cost basis doesn't work** - needs to be dynamic or wallet-specific
3. **$0.26 was overfitted** to a single extreme case
4. **The approach is valid** but implementation needs refinement

### Files

| File | Purpose | Status |
|------|---------|--------|
| `lib/pnl/uiActivityEngineV6.ts` | V6 engine with NegRisk | Experimental |
| `scripts/pnl/create-vw-negrisk-conversions.ts` | View creation script | Complete |
| `scripts/pnl/comprehensive-v3-v6-validation.ts` | Validation script | Complete |

### What Would Actually Improve V6

1. **Dynamic cost basis** - lookup price at conversion time
2. **Higher base cost** - try $0.50 or $0.40 instead of $0.26
3. **Wallet-specific calibration** - different cost for different wallet profiles
4. **Actual USDC tracking** - join with USDC transfers to get real cost

### Next Steps

1. **Keep V3 as production engine** - it's better overall
2. **Archive V6** - useful learning but not production-ready
3. **Investigate $0 PnL wallets** - 6 wallets returning $0 need data fixes
4. **Try $0.50 cost basis** - may be better for typical wallets
5. **Build USDC flow tracking** - for accurate cost basis

---

## Appendix: Full Results Table

| Wallet | UI PnL | V3 PnL | V6 PnL | V3 Error | V6 Error | NR Events |
|--------|--------|--------|--------|----------|----------|-----------|
| 0xa60acdbd1d | $38.84 | $42.44 | $838.23 | +9.3% | +2058% | 7 |
| 0x8c2758e0fe | -$34.00 | -$34.00 | -$34.00 | +0.0% | +0.0% | 0 |
| 0xb0adc6b10f | $124.22 | $115.24 | $118.21 | -7.2% | -4.8% | 2 |
| 0xedc0f2cd17 | $75.5K | $87.4K | $86.5K | +15.8% | +14.6% | 101 |
| ... | ... | ... | ... | ... | ... | ... |
| 0x4ce73141db | **$332.6K** | **-$282.8K** | **$364.4K** | **-185%** | **+9.6%** | **25,583** |
| ... | ... | ... | ... | ... | ... | ... |

See validation script output for full 49-wallet results.

---

*Report generated by Claude Code - 2025-11-30*
*Signed: Claude 1*
