> **DEPRECATED PNL DOC**
> Archived. Reflects earlier attempts to match Goldsky PnL.
> Not the current spec for Cascadian.
> See docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md for the current approach.

# PnL Data Source Analysis

## Summary

Investigation on 2025-11-22 revealed a **fundamental data source mismatch** between our fill-based PnL calculations and Goldsky's pm_user_positions table.

## The Problem

### Two Different Data Sources

| Source | Table | Theo's Conditions | Theo's PnL |
|--------|-------|-------------------|------------|
| Our Fills | pm_trader_events_v2 | 14 (hex) | $33.25M |
| Goldsky | pm_user_positions | 30 (decimal) | $22.05M |

**The condition_ids DO NOT MATCH between the two sources.**

### Evidence

Our first condition (hex):
```
26ee82bee2493a302d21283cb578f7e2fff2dd15743854f53034d12420863b55
```

Converted to decimal:
```
17609300220827029640620129537373714412795812908370297767753456512712382495573
```

Goldsky conditions (sample):
```
105184348976114274990683066782...
110154709736841778297292192872...
155940578439943790108303964269...
```

**NO OVERLAP** - the condition IDs are completely different.

## What This Means

1. **pm_trader_events_v2** (our fill data) contains trades for **different markets** than what Polymarket's official profile shows for Theo

2. **Goldsky pm_user_positions** has the "official" PnL that matches the Polymarket UI ($22.05M)

3. Our fill-based calculation ($33.25M) is mathematically correct for the data we have, but it's tracking different conditions

## Data Quality Issues in Goldsky

Despite having the "correct" total PnL, Goldsky pm_user_positions has issues:
- `total_sold = 0` for all positions (clearly wrong)
- `updated_at = 1970-01-01` (epoch default)
- Different position count (30 vs 28)

## Options Going Forward

### Option A: Use Goldsky realized_pnl directly
- Pros: Matches Polymarket UI exactly
- Cons: No transaction-level detail, can't compute trading PnL vs resolution PnL

### Option B: Fix the fill data source
- Investigate why pm_trader_events_v2 has different conditions
- May require re-backfilling from a different data source

### Option C: Accept the discrepancy
- Document that our fill-based PnL uses different methodology
- Continue with our internally-consistent calculation

## Calibration Status

| Wallet | Target | Our Calculation | Goldsky | Status |
|--------|--------|-----------------|---------|--------|
| Theo | $22.05M | $33.25M | $22.05M | BLOCKED - data mismatch |
| Sports Bettor | -$10.02M | $62.03M | ? | BLOCKED - data mismatch |

## Recommendation

Before proceeding with any global v4 rebuild, we need to:
1. Determine which data source is "correct" for our use case
2. Either fix the fill data or accept the discrepancy
3. Consider using Goldsky realized_pnl as a supplementary metric

---
*Analysis performed: 2025-11-22*
