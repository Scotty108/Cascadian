# 2X Bug Root Cause Analysis

**Date**: 2025-12-15
**Wallet**: 0x586744c62f4b87872d4e616e1273b88b5eb324b3
**Symptom**: V17 shows -$683.06, UI shows -$341.38 (exactly 2.0x)

## Root Cause

V17 counts BOTH maker AND taker fills for the same wallet, effectively double-counting when a wallet participates in trades on both sides.

### Evidence

```
ALL FILLS (V17 approach):
  Fills: 35
  PnL: $-682.98
  Ratio to UI: 2.00x

MAKER ONLY (V18 approach):
  Fills: 5
  PnL: $-341.49
  Ratio to UI: 1.00x (MATCH!)

TAKER ONLY:
  Fills: 30
  PnL: $-341.49
  Ratio to UI: 1.00x (MATCH!)

Double-counting check:
  Maker PnL + Taker PnL = $-682.98 = All Fills PnL ✓
```

### Why Both Roles Match UI

For this specific wallet:
- **Maker trades**: 5 fills, only O0 position (net=0.01 shares), lost $341.49 on spread
- **Taker trades**: 30 fills, both O0+O1 positions (complete set accumulation), net PnL = -$341.49

By coincidence, maker loss = taker loss. This won't be true for all wallets.

### V18 Documentation Insight

From `uiActivityEngineV18.ts` header:
> V18 filters trades to role = 'maker' ONLY.
> Polymarket UI attributes PnL to the maker side of each trade.

## Position Analysis

This wallet accumulated **~26,041 complete sets** (equal YES+NO holdings):

```
Outcome 0 (NO, lost):  net=26,041.42 shares, cash_flow=-$942.48, payout=0
Outcome 1 (YES, won):  net=26,041.41 shares, cash_flow=-$25,781.91, payout=1
```

V17 Formula:
- O0: -$942.48 + 26,041.42 × 0 = **-$942.48**
- O1: -$25,781.91 + 26,041.41 × 1 = **+$259.50**
- Total: **-$682.98** (2x UI)

## Fix Options

### Option 1: Use V18 (Maker-Only)
V18 already has the fix. Use `createV18Engine()` instead of `createV17Engine()`.

### Option 2: Add Role Filter to V17
Add `AND role = 'taker'` or `AND role = 'maker'` to V17's SQL query.

### Option 3: Pick One Role Per Event
Deduplicate so each event_id uses only one role (either maker or taker, not both).

## Recommendation

For UI parity validation, **use V18 (maker-only)** which was specifically designed for this purpose.

For Cascadian canonical PnL, investigate whether the "correct" approach is:
1. Maker-only (V18 approach)
2. Taker-only
3. Event-level dedup (pick one role per event_id)

## Next Steps

1. ✅ Identified root cause (role double-counting)
2. [ ] Test V18 on other failing wallets
3. [ ] Determine canonical role policy for Cascadian
4. [ ] Update V17 or switch to V18 for production
