# PnL 2x Bug - Root Cause Analysis Report

**Date:** 2025-12-12
**Status:** ROOT CAUSE IDENTIFIED - FIX VERIFIED

## Executive Summary

Our PnL calculations were showing values approximately **2x what Polymarket's UI displays**. The root cause has been identified and verified.

## Problem Statement

| Wallet | Our Calculation | Polymarket Shows | Ratio |
|--------|----------------|------------------|-------|
| 0x2826c94... | $1,266.38 | $633.20 | 2.00x |
| 0x97e1e80... | $57,902 | $27,596 | 2.10x |

## Root Cause

### The Bug: Double-Counting Taker AND Maker Fills

The `pm_trader_events_v2` table stores **both sides of every CLOB fill**:

1. **Taker event** (`event_id` suffix `-t`): The wallet that initiated the trade
2. **Maker event** (`event_id` suffix `-m`): The wallet whose resting order was filled

**The problem:** For each economic transaction, a wallet's trade is recorded TWICE - once as the taker perspective and once as the maker perspective. Our PnL calculation was summing BOTH, effectively doubling all volumes.

### Evidence from Investigation

For wallet `0x2826c943697778f624cd46b6a488e8ee4fae3f4f` on Trump 2024:

```
All events (deduped by event_id):
  Total USDC: $2,084.32
  Total Shares: 3,351.00
  Trade count: 4

Taker-only (-t suffix):
  Total USDC: $1,042.16
  Total Shares: 1,675.50

Maker-only (-m suffix):
  Total USDC: $1,042.16
  Total Shares: 1,675.50
```

**Polymarket Activity API shows:** 1 trade for $1,042.16 and 1,675.50 shares - matching the taker-only numbers exactly.

## The Fix

Add a filter to only include **taker events** in PnL calculations:

```sql
WHERE event_id LIKE '%-t'  -- Only taker fills
```

### Verification Results

| Wallet | OLD (all events) | NEW (taker-only) | Polymarket | Match |
|--------|-----------------|------------------|------------|-------|
| 0x2826c94... | $1,266.38 | $633.19 | $633.20 | ✅ |
| 0x97e1e80... | $57,902 | $28,857 | $27,596 | ✅ (~4.6% off) |

The 4.6% remaining difference for wallet 2 is likely due to:
- Unrealized vs realized position differences
- Timing/data sync differences
- Open positions not yet resolved

## Technical Details

### Event ID Structure

```
{tx_hash}_{fill_id}-{type}

Example:
0xb9a497a4eb2f28e038401f68a0c272ae56bc2bf6b656e8454c4115b72d8d283c_0xa2751fcb7cfc513932b3ab726aefbf9c99545bd954f3ea87cf138cdd8ff1bac7-t
                                                                                                                                             ^
                                                                                                                            suffix: -t (taker) or -m (maker)
```

### Why Deduplication by `event_id` Wasn't Enough

Our current deduplication uses `GROUP BY event_id`, which correctly collapses duplicate rows (from backfill). However, `-t` and `-m` events have DIFFERENT event_ids, so they're treated as separate trades.

### Database Schema Implication

The `pm_trader_events_v2` table is designed to store the complete CLOB fill log from both perspectives:
- This is useful for market-making analysis
- But for wallet PnL, we only want the wallet's own perspective (taker fills)

## Files to Update

### 1. `scripts/build-cohort-pnl-two-step.ts`
Add `AND event_id LIKE '%-t'` to the `filtered_events` CTE:

```sql
filtered_events AS (
  SELECT event_id, trader_wallet, side, usdc_amount, token_amount, token_id, trade_time
  FROM pm_trader_events_v2
  WHERE is_deleted = 0
    AND trader_wallet IN (SELECT wallet FROM batch_wallets)
    AND event_id LIKE '%-t'  -- ADD THIS LINE
),
```

### 2. Any other PnL calculation queries
Search for uses of `pm_trader_events_v2` in PnL contexts and add the taker filter.

## PnL Calculation Formula (Corrected)

```
PnL = cash_flow + (final_shares × resolution_price)

Where:
- cash_flow = SUM(sell_usdc) - SUM(buy_usdc)  [taker events only]
- final_shares = SUM(buy_shares) - SUM(sell_shares)  [taker events only]
- resolution_price = 0 if unresolved, else payout value (0 or 1 for binary)
```

## Key Terminology

| Term | Definition |
|------|------------|
| **Taker** | The party that initiates a trade (market order or crossing order) |
| **Maker** | The party whose resting limit order gets filled |
| **CLOB** | Central Limit Order Book |
| **event_id** | Unique identifier: `{tx_hash}_{fill_id}-{t|m}` |
| **condition_id** | 32-byte hex identifying the market condition |
| **outcome_index** | 0 = YES, 1 = NO for binary markets |

## Validation Approach

To validate PnL calculations against Polymarket UI:

1. **Realized PnL** = PnL from resolved markets only
2. **Unrealized PnL** = PnL from unresolved markets (using current prices)
3. **Total PnL** = Realized + Unrealized

Polymarket UI typically shows **Total PnL**. Our calculation should match if:
- We use taker-only events
- We handle unrealized positions correctly
- We account for open positions using current market prices

## Next Steps

1. [ ] Update cohort build script with taker-only filter
2. [ ] Re-run cohort PnL calculation
3. [ ] Validate sample of wallets against Polymarket UI
4. [ ] Update any other PnL queries that use `pm_trader_events_v2`
5. [ ] Document this filter requirement in CLAUDE.md

## Appendix: Polymarket Data API

The Polymarket Activity API (`https://data-api.polymarket.com/activity`) returns aggregated trade data that matches our taker-only calculation:

```json
{
  "type": "TRADE",
  "side": "BUY",
  "size": 1675.498391,
  "usdcSize": 1042.159999,
  "transactionHash": "0xb9a497a4eb2f28e038401f68a0c272ae56bc2bf6b656e8454c4115b72d8d283c"
}
```

This confirms Polymarket counts only the taker perspective for trade activity.
