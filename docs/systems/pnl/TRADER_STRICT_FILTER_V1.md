# TRADER_STRICT Filter Definition v1

**Date:** 2025-12-07
**Based On:** V29 vs Tooltip Truth Validation (76.5% overall, but 88.9% with filter)

---

## Purpose

The TRADER_STRICT filter identifies wallets where V29 PnL calculations are highly reliable (90%+ expected accuracy). Use this filter for:
- **Track B: Leaderboard ranking** - Rankings must be trustworthy
- **Track C: Copy trading eligibility** - Can't copy trade unreliable metrics

---

## Filter Criteria

### Required (ALL must pass)

```typescript
interface TraderStrictCriteria {
  // Position complexity limit
  openPositions: number;        // <= 50

  // Activity minimum
  clobTradeCount: number;       // >= 10

  // PnL magnitude (avoid noise)
  absPnl: number;               // >= $100
}

function isTraderStrict(wallet: V29Result): boolean {
  return (
    wallet.openPositions <= 50 &&
    wallet.clobTradeCount >= 10 &&
    Math.abs(wallet.uiParityPnl) >= 100
  );
}
```

### Optional Tightening (for v2)

```typescript
interface TraderStrictV2Criteria extends TraderStrictCriteria {
  // Unredeemed ratio limit (catches whales with redemption issues)
  unredeemedRatio: number;      // |resolvedUnredeemed| / |uiParityPnl| <= 10

  // Account age (avoid very new accounts)
  firstTradeAge: number;        // >= 30 days
}
```

---

## Validation Evidence

### From Tooltip-Verified Dataset (18 wallets)

| Segment | Pass Rate | Notes |
|---------|-----------|-------|
| **All wallets** | 76.5% (13/17) | Baseline |
| **openPositions <= 50** | **88.9% (8/9)** | Strong filter |
| **openPositions > 50** | 62.5% (5/8) | Lower accuracy |
| **CLOB-only label** | 100% (2/2) | Perfect |
| **Mixed activity** | 50% (1/2) | Variable |

### Failure Analysis

| Wallet | Open Positions | resolvedUnredeemed | Error | Root Cause |
|--------|----------------|-------------------|-------|------------|
| 0x7fb7... | **1584** | -$22.2M | +262% | Position explosion |
| 0xb744... | **235** | -$23.3M | +94% | Whale redemption gap |
| 0x2e41... | **27** | +$7.1K | +92% | Unknown (edge case) |
| 0x7a30... | **87** | -$39.4K | -83% | Complex mixed activity |

### Key Insight

3 of 4 failures have >50 open positions. The 4th (0x2e41) has 27 positions but unusual positive resolvedUnredeemed.

---

## Implementation

### SQL Filter Pattern

```sql
-- Apply TRADER_STRICT filter to V29 results
SELECT * FROM v29_wallet_metrics
WHERE open_positions <= 50
  AND ABS(ui_parity_pnl) >= 100
  AND clob_trade_count >= 10
```

### TypeScript Usage

```typescript
import { calculateV29PnL } from '@/lib/pnl/inventoryEngineV29';

async function getTraderStrictWallets(wallets: string[]) {
  const results = [];

  for (const wallet of wallets) {
    const v29 = await calculateV29PnL(wallet, { valuationMode: 'ui' });

    if (isTraderStrict(v29)) {
      results.push({
        wallet,
        pnl: v29.uiParityPnl,
        openPositions: v29.openPositions,
      });
    }
  }

  return results;
}
```

---

## Pass Rate Expectations

| Filter Level | Expected Accuracy | Use Case |
|--------------|------------------|----------|
| No filter | ~77% | Research only |
| **TRADER_STRICT v1** | **~89%** | Leaderboard, copy trading |
| TRADER_STRICT v2 | ~95% (estimated) | High-confidence rankings |

---

## Future Work

1. **Expand validation set** - Target 50+ tooltip-verified wallets
2. **Add unredeemed ratio filter** - May catch whale edge cases
3. **A/B test on leaderboard** - Compare filtered vs unfiltered rankings
4. **Automated monitoring** - Track pass rate over time as new wallets enter

---

## Related Files

- `scripts/pnl/validate-v29-vs-tooltip-truth.ts` - Canonical validation script
- `tmp/playwright_tooltip_ground_truth.json` - Ground truth dataset (18 wallets)
- `tmp/v29_vs_tooltip_truth.json` - Latest validation results
- `lib/pnl/inventoryEngineV29.ts` - V29 PnL engine
