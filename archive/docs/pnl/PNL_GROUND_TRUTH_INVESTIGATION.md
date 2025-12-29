> **DEPRECATED PNL DOC**
> Archived. Reflects earlier attempts to match Goldsky PnL.
> Not the current spec for Cascadian.
> See docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md for the current approach.

# PnL Ground Truth Investigation

## Summary

Investigation into why our PnL calculations don't match provided ground truth values for 23 whale wallets.

**Date:** 2025-11-23
**Status:** BLOCKED - Ground truth source and methodology unknown

## Executive Summary

After extensive testing of multiple methodologies (Goldsky, RESA, Data API), we cannot reproduce the ground truth values. The investigation revealed:

1. **No methodology matches** - RESA matches 2/23 wallets, Goldsky matches 4/23
2. **Data completeness issues** - pm_ui_positions_new is empty, Goldsky has incomplete data
3. **Mathematical impossibilities** - Some wallets show PnL exceeding total trading volume
4. **Ground truth source unclear** - Need clarification on where values came from

## Methodologies Tested

### 1. RESA (Raw Event-Sourced Architecture) - NEW
Built canonical views from first principles:
- `vw_wallet_condition_ledger_v1` - Trade + Resolution events
- `vw_wallet_condition_pnl_v1` - Per-condition aggregation
- `vw_wallet_pnl_totals_v1` - Wallet-level totals

**Results:**
```
RESA Matches (within 15%): 2/23 (9%)
Goldsky Matches:           4/23 (17%)
```

**Formula:** Net PnL = sum(usdc_delta) where:
- TRADE BUY: usdc_delta = -(usdc_amount + fee_amount) / 1e6
- TRADE SELL: usdc_delta = +(usdc_amount - fee_amount) / 1e6
- RESOLUTION WIN: usdc_delta = +final_shares * 1.0
- RESOLUTION LOSS: usdc_delta = 0

### 2. Goldsky `realized_pnl`
**Problem:** Accumulates trade-level profits, causing 40x inflation for market makers.

### 3. Data API (`pm_ui_positions_new`)
**Problem:** Table is EMPTY for all 23 ground truth wallets. Backfill incomplete.

## Comprehensive Results Table

| Wallet | GT PnL | RESA | Ratio | Goldsky | Ratio | Open Pos |
|--------|--------|------|-------|---------|-------|----------|
| 0x4ce73141... | $332,563 | $281,401 | 0.85x | $13,587,268 | 40.86x | 0 |
| 0xb48ef6de... | $114,087 | $239,152 | 2.10x | $111,504 | 0.98x | 31 |
| 0x1f0a3435... | $107,756 | $42,905 | 0.40x | $112,926 | 1.05x | 167 |
| 0x8e9eedf2... | $360,492 | $45,703 | 0.13x | $2,459,808 | 6.82x | 139 |
| 0xcce2b7c7... | $247,219 | $37,404 | 0.15x | $87,031 | 0.35x | 17 |
| 0x6770bf68... | $179,044 | $14,552 | 0.08x | $9,729 | 0.05x | 10 |

## Red Flags in Ground Truth Data

### Mathematical Impossibilities

**Wallet 0x6770bf68...**
- Ground Truth PnL: $179,044
- Total Trading Volume: $93,277
- **Problem:** PnL exceeds total volume - impossible for trading

This wallet has:
- 1,181 trades
- $93K total volume
- 157/168 conditions resolved
- RESA PnL: $14,825

**Conclusion:** Either ground truth is wrong or uses a completely different data source.

### Inconsistent Patterns

The discrepancy doesn't follow any consistent pattern:
- Some wallets: Goldsky > GT (market makers, 40x inflation)
- Some wallets: Goldsky ≈ GT (regular traders, ~1x)
- Some wallets: Goldsky < GT (0.05x-0.35x underreporting)

## Data Quality Issues

### pm_user_positions (Goldsky)
- `unrealized_pnl`: Always 0
- `total_sold`: Always 0
- `realized_pnl`: In micro-USDC, but inflated for active traders

### pm_ui_positions_new (Data API)
- **Empty** for all ground truth wallets
- Backfill did not cover these addresses

### pm_trader_events_v2
- Most complete data source
- Has all trades with proper fee accounting

## Files Created

- `scripts/pnl/build-resa-views.ts` - RESA view builder
- `scripts/pnl/test-pnl-ground-truth.ts` - TDD test with 23 wallets
- `scripts/pnl/investigate-outlier.ts` - Outlier analysis

## Views Created

```sql
-- Core ledger with TRADE + RESOLUTION events
vw_wallet_condition_ledger_v1

-- Per-condition PnL aggregation
vw_wallet_condition_pnl_v1

-- Wallet-level totals
vw_wallet_pnl_totals_v1
```

## Action Required

**To proceed, we need clarification on the ground truth source:**

1. What exact Goldsky product/API provided these values?
2. Was this from a specific date/time snapshot?
3. Does it include unrealized PnL?
4. What time period does it cover?
5. Are these proxy wallets or EOA wallets?

Without this information, we cannot validate any PnL methodology against the provided ground truth.

## Recommendations

### Short Term
1. **Use RESA for resolved positions** - Mathematically correct for closed positions
2. **Accept that Goldsky is broken** - Don't try to match it
3. **Validate against Polymarket UI** - Manual spot checks

### Long Term
1. Build unrealized PnL calculation using current market prices
2. Backfill pm_ui_positions_new for ground truth wallets
3. Create unified PnL view combining realized + unrealized

## Related Documents

- `docs/systems/database/GOLDSKY_PNL_DATA_LIMITATIONS.md`
- `docs/systems/database/PNL_METHODOLOGY_V3.md`
- `docs/systems/database/PNL_METHODOLOGY_V4.md`
