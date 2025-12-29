# PnL Investigation Findings

**Date:** 2025-12-13
**Status:** Root causes identified, fixes proposed

---

## Executive Summary

Investigation of failing PnL calculations revealed two critical issues:

1. **V13 Engine deduplication is broken** - `GROUP BY event_id` doesn't dedupe because maker/taker rows have unique event_ids
2. **CLOB-only misses settlement PnL** - UI "Net total" includes resolved market payouts

---

## Issue 1: V13 Deduplication Bug

### Problem
V13 uses `GROUP BY event_id` for deduplication, but each row has a unique event_id:
- Taker row: `0x71492b32..._0xdad862d69ad...-t`
- Maker row: `0x71492b32..._0x4d8125540f4e...-m`

### Evidence
```
Wallet: 0x613fae0ca4e3f0c51d89d6a772f8660bc19bc819
Raw rows:          175
V13 (event_id):    175  ← NO DEDUPLICATION!
Ours (fill_key):   123  ← 52 duplicates removed
```

### Impact
- Double-counting trades causes wrong position calculations
- Wrong positions → wrong resolution applications
- Example: V13 shows +$21.94 vs UI -$0.85 (2693% error)

### Fix
Replace `GROUP BY event_id` with fill_key:
```sql
GROUP BY transaction_hash, lower(trader_wallet), token_id, side, usdc_amount, token_amount
```

---

## Issue 2: CLOB-Only vs UI "Net Total"

### What UI Shows
The Polymarket tooltip shows:
- **Gain**: Sum of profitable closed positions
- **Loss**: Sum of losing closed positions (including resolved-to-$0)
- **Net total**: Gain + Loss = Realized PnL INCLUDING settlement

### What CLOB-Only Calculates
- Realized PnL from buy→sell trades only
- Does NOT include settlement when markets resolve

### Example
```
Wallet: 0x114d7a8e7a1dd2dde555744a432ddcb871454c92
CLOB-only calc:  $1,052.43
UI Net total:    $733.87
Delta:           $318.56 (43.4% error)

Active positions (resolved to $0):
- San Diego FC:   -$66.69
- Celtic:         -$100.01
- Mazatlan:       -$100.00
- Ludogorets:     -$49.99
Total:            -$316.69 ≈ delta!
```

The delta exactly matches unrealized losses from resolved markets.

---

## Correct Approach

### For UI "Net Total" Matching

1. **Use fill_key deduplication** (not event_id)
2. **Calculate avg-cost long-only realized PnL** (subgraph-exact math)
3. **Add settlement PnL for resolved markets**:
   ```
   settlement_pnl = remaining_shares × (resolution_price - avg_cost)
   ```
4. **Exclude truly active (unresolved) positions**

### For Pure CLOB Realized PnL

Our `subgraph-exact-engine.ts` is correct for wallets without resolved positions:
- 0x613fae... -$0.85 vs -$0.85 ✅ EXACT
- 0x7da971... +$9.15 vs +$9.15 ✅ EXACT

---

## Validation Results

### Subgraph-Exact (CLOB-only)
- **19/44 wallets pass** (43%)
- Perfect for simple trading patterns
- Fails when market resolutions affect PnL

### V13 Engine (with broken dedupe)
- Often WORSE than CLOB-only due to double-counting
- Example: 2693% error on a wallet that should be exact

### Proposed Fix (fill_key + resolutions)
- Should achieve ~90%+ accuracy
- Needs implementation and testing

---

## Files Created

| File | Purpose |
|------|---------|
| `scripts/pnl/subgraph-exact-engine.ts` | Correct avg-cost math with BigInt |
| `scripts/pnl/fill-key-collision-report.ts` | Detect over-deduplication |
| `scripts/pnl/test-benchmark-wallet.ts` | Test single wallet with detail |
| `scripts/pnl/test-v13-engine.ts` | Compare V13 vs benchmark |

---

## Next Steps

1. **Fix V13 deduplication** - Replace event_id with fill_key
2. **Merge approaches** - Combine correct dedupe + resolution logic
3. **Re-validate** - Test on full benchmark set
4. **Update regression suite** - Use SIMPLE_COHORT for CLOB-only, full set for settlement

---

**Report Generated:** 2025-12-13
