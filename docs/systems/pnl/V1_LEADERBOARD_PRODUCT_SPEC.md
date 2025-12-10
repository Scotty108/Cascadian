# V1 Leaderboard Product Specification

**Date:** 2025-12-07
**Status:** FROZEN (v1)
**Engine:** V29 (inventoryEngineV29.ts)

---

## Executive Summary

V1 Leaderboard uses a **TRADER_STRICT** filter to identify wallets with reliable PnL calculations. This approach prioritizes accuracy (88.9%+) over coverage, making it suitable for copy trading and rankings.

---

## Product Scope

### v1 Universe

| Scope | Decision |
|-------|----------|
| **Universe** | TRADER_STRICT wallets only |
| **Ranking metric** | `realizedPnl` (conservative) |
| **Display metrics** | realizedPnl, resolvedUnredeemed, unrealized (context), uiParity |
| **Excluded** | WHALE_COMPLEX (>100 positions), unverified wallets |

### What v1 Does NOT Include

- Wallets with >50 open positions
- Wallets with |PnL| < $100
- Wallets with high unredeemed ratio
- Full UI parity for all wallet types

---

## TRADER_STRICT Filter

### Criteria (ALL must pass)

```typescript
const TRADER_STRICT_V1_CONFIG = {
  maxOpenPositions: 50,        // Strict leaderboard limit
  whalePositionThreshold: 100, // WHALE_COMPLEX classification
  minAbsPnl: 100,              // Avoid noise
  minClobTrades: 10,           // Minimum activity
  maxUnredeemedRatio: 10,      // Catches edge cases
};

function isTraderStrict(wallet): boolean {
  return (
    openPositions <= 50 &&
    |uiParityPnl| >= 100 &&
    eventsProcessed >= 10 &&
    unredeemedRatio <= 10 &&
    negativeInventoryPositions === 0
  );
}
```

### Exclusion Reason Codes

| Code | Meaning |
|------|---------|
| `POSITION_COUNT_HIGH` | 51-100 open positions |
| `POSITION_COUNT_EXTREME` | >100 positions (WHALE_COMPLEX) |
| `PNL_TOO_SMALL` | |PnL| < $100 |
| `UNREDEEMED_RATIO_HIGH` | |unredeemed| / |pnl| > 10 |
| `NEGATIVE_INVENTORY` | Has negative inventory |
| `INSUFFICIENT_TRADES` | <10 events processed |

---

## Validation Evidence

### Tooltip Truth Dataset

- **Source:** Playwright hover verification of Polymarket UI
- **Method:** Click ALL, hover info icon, extract Gain/Loss/Net Total
- **Identity check:** Gain - |Loss| = Net Total
- **Wallets:** 18 tooltip-verified

### Pass Rates

| Segment | Pass Rate | Notes |
|---------|-----------|-------|
| All wallets | 76.5% (13/17) | Baseline |
| **TRADER_STRICT** | **88.9% (8/9)** | Production target |
| WHALE_COMPLEX | 62.5% (5/8) | Excluded from v1 |
| CLOB-only | 100% (2/2) | Best accuracy |

### Average Error

- **Passing wallets:** 2.60%
- **Best case:** 0.0% (exact match)
- **Worst case (passing):** 8.0%

---

## API Interface

### Leaderboard Endpoint Response

```typescript
interface LeaderboardWallet {
  wallet: string;
  isTraderStrict: boolean;
  walletTypeBadge: 'CLOB_ONLY' | 'MIXED' | 'WHALE_COMPLEX' | 'UNKNOWN';
  strictReasonCodes: string[]; // Empty if eligible
  openPositions: number;
  eventsProcessed: number;
  copyEligibleExposureUSD: number;
  pnl: {
    realized: number;           // For ranking
    resolvedUnredeemed: number; // Context
    unrealized: number;         // Context
    uiParity: number;           // Display
  };
}
```

### Usage

```typescript
import { getV29LeaderboardEligibility } from '@/lib/pnl/inventoryEngineV29';

// Get eligibility for ranking
const eligibility = await getV29LeaderboardEligibility(wallet);

if (eligibility.isTraderStrict) {
  // Include in leaderboard
  rank(eligibility.pnl.realized);
} else {
  // Show with warning: "Excluded from strict leaderboard"
  showExclusionNote(eligibility.strictReasonCodes);
}
```

---

## Copy Trading Integration

### Eligibility

Copy trading requires:
1. `isTraderStrict === true`
2. `copyEligibleExposureUSD > 0`
3. Recent trading activity (last 30 days)

### Exposure Calculation

```typescript
copyEligibleExposureUSD = sum of open positions where:
  - Market is still tradable
  - Position value >= $1
  - Not resolved
```

---

## UI Presentation

### For Strict Leaderboard

```
Rank | Wallet | Realized PnL | Open Positions
-----|--------|--------------|---------------
  1  | 0x17db...| +$3,202,323 | 49
  2  | 0xed22...| +$3,092,835 | 12
  3  | 0x343d...| +$2,791,716 | 13
```

### For Excluded Wallets

```
Excluded from strict leaderboard
Reason: Position count high (87 open positions)
```

---

## Regression Testing

### Test File

`lib/pnl/__tests__/v29-tooltip-truth.spec.ts`

### Pass Conditions

1. TRADER_STRICT wallets must pass at ≤10% error
2. WHALE_COMPLEX wallets are allowed to fail
3. Overall pass rate ≥80% on strict wallets

### Running Tests

```bash
npx jest lib/pnl/__tests__/v29-tooltip-truth.spec.ts
```

---

## Files

| File | Purpose |
|------|---------|
| `lib/pnl/inventoryEngineV29.ts` | V29 engine + strict gating |
| `data/regression/tooltip_truth_v1.json` | Durable ground truth |
| `lib/pnl/__tests__/v29-tooltip-truth.spec.ts` | Regression test |
| `docs/systems/pnl/TRADER_STRICT_FILTER_V1.md` | Filter documentation |

---

## Future Work (v2+)

1. **Expand TRADER_STRICT boundary** - Increase maxOpenPositions to 75-100
2. **Add CLOB_ONLY detection** - Query CTF events to classify pure CLOB traders
3. **Include WHALE_COMPLEX wallets** - With accuracy warnings
4. **Real-time position valuation** - For more accurate copyEligibleExposureUSD

---

## Changelog

| Date | Change |
|------|--------|
| 2025-12-07 | Initial v1 spec frozen |
| 2025-12-07 | Added TRADER_STRICT gating to V29 engine |
| 2025-12-07 | Created regression test suite |
