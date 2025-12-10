# Leaderboard Validation Plan - CLOB-First PnL

**Date:** 2025-12-07
**Status:** In Progress
**Goal:** Validate 100+ TRADER_STRICT CLOB-only wallets with near-100% accuracy

---

## Executive Summary

This document outlines the fastest path to a validated leaderboard for copy trading. We have two PnL engines with different characteristics:

| Engine | UI Match Rate | Description | Use Case |
|--------|---------------|-------------|----------|
| **V23c** | ~75% | Shadow Ledger with UI price oracle | Data validation (proves our data is correct) |
| **V29** | ~0% | Inventory Engine with metric separation | Leaderboard (separates realized vs resolved) |

### Key Insight: V29's Low Match Rate is INTENTIONAL

V29 doesn't match UI because:
1. V29 marks unresolved positions at $0.50 (conservative)
2. UI marks at live market price (mark-to-market)
3. V29 treats resolved-but-unredeemed as separate from realized
4. This divergence is what we WANT for the leaderboard

---

## Validation Strategy

### Phase 1: Data Correctness (V23c)
**Goal:** Prove our underlying data pipeline is correct

1. Run V23c on 100+ CLOB-only wallets
2. Compare against Playwright-scraped UI values
3. **Success Criteria:** 70%+ pass rate at 6% tolerance
4. If V23c matches UI → our data is trustworthy

### Phase 2: Leaderboard Metric (V29)
**Goal:** Use V29 for copy-trade ranking with documented definition

1. Run V29 on same wallets
2. Accept that V29 won't match UI (intentional)
3. Document the metric definition for users
4. **Ranking metric:** `V29.realizedPnl + V29.resolvedUnredeemedValue`

---

## Wallet Selection Criteria

### CLOB-Only TRADER_STRICT
```
Criteria:
- PositionSplit events = 0
- PositionsMerge events = 0
- CLOB trades >= 10 (minimum activity)
- UI presence confirmed (profile exists)
- |UI PnL| >= $100 (avoid noise)
```

### Current Validation Set
- 40 CLOB-only wallets from UI snapshot
- Includes wallets with $95K-$170K UI PnL
- Mix of profitable and losing wallets

---

## Engine Comparison

### V23c (Shadow Ledger)
```typescript
// Formula
totalPnl = cash_flow + tokens * (resolution_price OR ui_price)

// Price Oracle Priority
1. Resolution price (if resolved)
2. pm_market_metadata.outcome_prices (UI prices)
3. Last trade price
4. $0.50 default
```

### V29 (Inventory Engine)
```typescript
// Separated Metrics
realizedPnl     // Only actual cash events (CLOB sells + redemptions)
unrealizedPnl   // Unresolved positions at 0.5
resolvedUnredeemedValue  // Resolved but not redeemed

// UI Parity
uiParityPnl = realizedPnl + resolvedUnredeemedValue

// Ranking Metric
leaderboardPnl = realizedPnl + resolvedUnredeemedValue
```

---

## Metric Definition for Leaderboard

### Cascadian Realized PnL (V29-based)
```
Cascadian Realized PnL = V29.realizedPnl + V29.resolvedUnredeemedValue

Components:
1. CLOB Trading Gains/Losses - From orderbook sells
2. PayoutRedemption Gains/Losses - From claimed redemptions
3. Resolved Position Value - From resolved markets (even if not redeemed)
```

### How This Differs from Polymarket UI
| Event Type | Polymarket UI | Cascadian |
|------------|---------------|-----------|
| CLOB sell | Realized | Realized |
| Redemption | Realized | Realized |
| Resolved (not redeemed) | May show as unrealized | **Counts as Realized** |
| Unresolved position | Mark-to-market | $0 (conservative) |

### Why This Matters for Copy Trading
- Cascadian counts resolved wins immediately
- Users don't need to wait for redemption to see performance
- More accurate reflection of actual trader skill
- Avoids unrealized gains/losses fluctuating with market

---

## Validation Scripts

### 1. Build Validation Set
```bash
npx tsx scripts/pnl/build-clob-only-validation-set.ts 150
# Output: tmp/clob_only_validation_set.json
```

### 2. Check UI Snapshot Overlap
```bash
npx tsx scripts/pnl/check-snapshot-clob-only.ts
# Output: tmp/clob_only_from_snapshot.json
```

### 3. Run V23c vs V29 Comparison
```bash
npx tsx scripts/pnl/validate-v23c-v29-vs-ui.ts \
  tmp/clob_only_from_snapshot.json \
  tmp/v23c_v29_clob_only_validation.json \
  40
```

### 4. Scrape Additional UI Values (Playwright)
```bash
npx tsx scripts/pnl/fetch-polymarket-profile-pnl.ts \
  --input=tmp/clob_only_validation_set.json \
  --output=tmp/ui_pnl_additional.json \
  --limit=100
```

---

## Expected Results

### V23c Validation
- **Expected pass rate:** 70-80%
- **Failures:** Primarily due to timing/stale metadata
- **Interpretation:** Proves data pipeline is correct

### V29 Validation
- **Expected pass rate:** 0-20%
- **Failures:** Due to intentional definition difference
- **Interpretation:** NOT a bug - different definition

### V29 vs V23c Comparison
- V29 should be LOWER than V23c for most wallets
- V29 = V23c only when all positions are closed/resolved
- Difference = unrealized gains valued differently

---

## UI Presentation Recommendations

### Leaderboard Display
```
Wallet: 0x...
Cascadian PnL: +$5,432  ← V29.realizedPnl + resolvedUnredeemedValue
Copy-Eligible: ✅
Badge: CLOB_ONLY

[?] This PnL counts resolved market positions as realized,
    which may differ from Polymarket UI.
```

### Tooltip Explanation
```
Cascadian PnL includes:
✓ Trading profits from buys/sells
✓ Claimed redemptions
✓ Resolved market winnings (even if unclaimed)

Does NOT include:
✗ Unrealized gains from open positions
```

---

## Next Steps

1. [ ] Complete V23c/V29 validation on 40 CLOB-only wallets
2. [ ] Scrape UI values for 60 additional wallets
3. [ ] Document final pass rates
4. [ ] Create leaderboard API using V29 metrics
5. [ ] Add UI disclaimer about metric definition

---

## Files Created

- `scripts/pnl/build-clob-only-validation-set.ts` - Build validation set
- `scripts/pnl/check-snapshot-clob-only.ts` - Check snapshot overlap
- `scripts/pnl/validate-v23c-v29-vs-ui.ts` - Engine comparison
- `tmp/clob_only_from_snapshot.json` - 40 CLOB-only wallets with UI
- `tmp/v23c_v29_clob_only_validation.json` - Validation results

---

*Plan authored: 2025-12-07*
