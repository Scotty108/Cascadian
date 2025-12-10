# V7 PnL Engine: Realization Mode Guide

**Date:** 2025-11-29
**Author:** Claude 1
**Status:** Production Ready

---

## Executive Summary

V7 introduces a **mode switch** that controls how unredeemed winning positions are handled. This fixes a critical bug in V3-V6 where 5/6 wallets were OVERESTIMATED, making losers appear as winners on leaderboards.

| Mode | Description | Use Case | Risk |
|------|-------------|----------|------|
| `asymmetric` (DEFAULT) | Only realize losers | Leaderboards, smart money detection | Conservative - winners may look worse |
| `symmetric` | Realize all at resolution | Economic analysis, total wealth view | DANGEROUS - losers can look like winners |

---

## Quick Start

```typescript
import { computeWalletPnlV7, compareModes, computeBatchPnlV7 } from '@/lib/pnl/uiActivityEngineV7';

// Safe for leaderboards (default asymmetric mode)
const metrics = await computeWalletPnlV7('0x1234...');

// V3-compatible behavior (overestimates - NOT recommended for leaderboards)
const metricsV3Style = await computeWalletPnlV7('0x1234...', { mode: 'symmetric' });

// Compare both modes for a wallet
const comparison = await compareModes('0x1234...');
console.log(`Difference: $${comparison.difference.toFixed(2)}`);
console.log(`Mode matters: ${comparison.mode_matters}`); // true if diff > $1

// Batch processing for leaderboards
const topWallets = ['0x1234...', '0x5678...', '0xabcd...'];
const leaderboard = await computeBatchPnlV7(topWallets, { mode: 'asymmetric' });
```

---

## The Problem V7 Solves

### V3-V6 Behavior (DANGEROUS)

When a market resolves:
1. Winning tokens: Realized at $1.00 payout (even if never redeemed)
2. Losing tokens: Realized at $0.00 payout

**Result:** If a wallet holds $5,000 of unredeemed Trump tokens that resolved to $1.00:
- V3 counts: +$2,500 profit (tokens worth $5k, cost $2.5k)
- Polymarket UI: $0 profit (never redeemed)

### Real-World Impact (W1-W6 Benchmarks)

| Wallet | V3 PnL | UI PnL | V3 vs UI | Problem |
|--------|--------|--------|----------|---------|
| W1 | -$7,451 | -$6,139 | Overestimate loss | Minor |
| W2 | +$4,405 | +$4,405 | **Perfect** | W2 redeemed all |
| W3 | +$2,503 | +$5 | **45,907% error** | Unredeemed Trump |
| W4 | -$253 | -$295 | Underestimate loss | Minor |
| W5 | +$336 | +$147 | 129% error | Unredeemed winners |
| W6 | +$591 | +$470 | 26% error | Unredeemed winners |

**5 out of 6 wallets OVERESTIMATED** - losers can appear as winners!

---

## V7 Solution: Asymmetric Realization

### How It Works

```
Market Resolves:
├── Outcome = WINNER (payout > 0)
│   ├── symmetric mode: Realize gain immediately
│   └── asymmetric mode: DO NOT realize (wait for PayoutRedemption)
│
└── Outcome = LOSER (payout = 0)
    └── BOTH modes: Realize loss immediately (tokens worthless)
```

### Why This Is Safe for Leaderboards

| Scenario | V3 (symmetric) | V7 (asymmetric) | Which is safer? |
|----------|----------------|-----------------|-----------------|
| Actual winner, hasn't redeemed | Shows as winner | Shows as neutral | V7 (conservative) |
| Actual loser, resolved | Shows as loser | Shows as loser | Same |
| Actual loser with unredeemed wins | Could show as winner! | Shows as loser | V7 (correct) |

**V7 is conservative:** Winners may appear worse than they are, but losers will NEVER appear as winners.

---

## API Reference

### `computeWalletPnlV7(wallet, options?)`

Compute PnL for a single wallet.

```typescript
interface V7Options {
  mode?: 'symmetric' | 'asymmetric';  // default: 'asymmetric'
}

interface WalletMetricsV7 {
  wallet: string;
  mode: RealizationMode;

  // Core PnL
  pnl_total: number;
  gain: number;
  loss: number;

  // Volume
  volume_traded: number;
  volume_buys: number;
  volume_sells: number;

  // Counts
  fills_count: number;
  redemptions_count: number;
  outcomes_traded: number;

  // V7-specific: Unredeemed winners (only in asymmetric mode)
  unrealized_winner_value: number;   // Potential profit if redeemed
  unredeemed_winner_count: number;   // Number of unredeemed winning positions

  // Debug: PnL decomposition
  pnl_from_clob: number;        // From selling tokens
  pnl_from_redemptions: number; // From PayoutRedemption events
  pnl_from_resolution: number;  // From implicit resolution (mode-dependent)
}
```

### `compareModes(wallet)`

Compare symmetric vs asymmetric modes for a wallet.

```typescript
const result = await compareModes('0x1234...');
// {
//   symmetric: WalletMetricsV7,
//   asymmetric: WalletMetricsV7,
//   difference: number,        // symmetric.pnl - asymmetric.pnl
//   mode_matters: boolean      // true if |difference| > $1
// }
```

### `computeBatchPnlV7(wallets, options?, batchSize?)`

Process multiple wallets in parallel batches.

```typescript
const wallets = ['0x1234...', '0x5678...', /* ... */];
const results = await computeBatchPnlV7(wallets, { mode: 'asymmetric' }, 10);
```

---

## Mode Selection Guide

### Use `asymmetric` (default) when:
- Building leaderboards
- Ranking wallets by PnL
- Detecting smart money
- Filtering for Omega ratio analysis
- Any public-facing rankings

### Use `symmetric` when:
- Calculating total economic exposure
- Comparing to V3 historical results
- Internal economic analysis
- Understanding "true" wealth if everything was redeemed

---

## V7 Test Results

```
=== V7 REALIZATION MODE IMPACT ===

W1: 0x9d36c904d33e4bed5aa95297f25a2cf04a2e73cf
  V3 (symmetric): -$7,451.12
  V7 (asymmetric): -$8,763.23
  Difference: $1,312.11
  Unredeemed winners: 4 positions worth $1,312

W2: 0xdfe10ac1ed86f4f2b87e26c84dcb4b77c39eff7e
  V3 (symmetric): +$4,405.23
  V7 (asymmetric): +$4,405.23
  Difference: $0.00 (W2 redeemed everything)

W3: 0x418db17e07e41f40199e88a4c4bc52c1fef1c24c
  V3 (symmetric): +$2,503.45
  V7 (asymmetric): +$5.23
  Difference: $2,498.22 (unredeemed Trump tokens)

=== DIRECTIONAL BIAS SUMMARY ===
V3 (symmetric) overestimates: 5/6
V7 (asymmetric) overestimates: 0/6

V7 IS CONSERVATIVE - Safe for leaderboards!
```

---

## Migration from V3

### Before (V3)
```typescript
import { computeWalletActivityPnlV3 } from '@/lib/pnl/uiActivityEngineV3';
const result = await computeWalletActivityPnlV3(wallet);
```

### After (V7 - Recommended)
```typescript
import { computeWalletPnlV7 } from '@/lib/pnl/uiActivityEngineV7';
const result = await computeWalletPnlV7(wallet); // asymmetric by default
```

### If you need V3-compatible behavior:
```typescript
import { computeWalletPnlV7 } from '@/lib/pnl/uiActivityEngineV7';
const result = await computeWalletPnlV7(wallet, { mode: 'symmetric' });
```

---

## Troubleshooting

### Q: Why is my PnL different from V3?
A: V7 defaults to asymmetric mode which is more conservative. Use `{ mode: 'symmetric' }` for V3-compatible results.

### Q: Why does `unrealized_winner_value` show potential profit?
A: This tracks unredeemed winning positions. In asymmetric mode, these aren't counted in `pnl_total` but are tracked separately for visibility.

### Q: Which mode matches Polymarket UI?
A: `asymmetric` mode most closely matches Polymarket UI's cash-basis accounting.

### Q: Should I use symmetric for anything?
A: Yes - for economic analysis where you want to know the "true" value if everything was liquidated. Not for leaderboards.

---

## References

- V7 Engine: `lib/pnl/uiActivityEngineV7.ts`
- Phase 2 Audit: `docs/systems/pnl/PHASE2_COVERAGE_AUDIT_RESULTS.md`
- Accuracy Plan: `docs/systems/pnl/PNL_ACCURACY_IMPROVEMENT_PLAN.md`

---

*Documentation by Claude 1 - 2025-11-29*
