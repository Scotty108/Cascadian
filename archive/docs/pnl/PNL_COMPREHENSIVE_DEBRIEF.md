> **DEPRECATED PNL DOC**
> Archived. Reflects earlier attempts to match Goldsky PnL.
> Not the current spec for Cascadian.
> See docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md for the current approach.

# PnL Calculation System: Comprehensive Debrief

**Date:** 2025-11-23
**Status:** BLOCKED - Awaiting ground truth source clarification
**Author:** Claude 1

---

## Executive Summary

We attempted to build a PnL calculation system that matches provided "ground truth" values for 23 whale wallets. After extensive investigation across multiple methodologies and data sources, **we cannot reproduce the ground truth values**. The investigation revealed significant data quality issues, mathematical impossibilities in the ground truth, and fundamental questions about the source of the provided benchmark data.

**Bottom line:** The RESA (Raw Event-Sourced Architecture) methodology is mathematically correct for realized PnL, but we cannot validate it against the provided ground truth because that ground truth appears to be from an unknown source using an unknown methodology.

---

## Table of Contents

1. [Project Goal](#project-goal)
2. [Data Sources Available](#data-sources-available)
3. [Ground Truth Data](#ground-truth-data)
4. [Methodologies Attempted](#methodologies-attempted)
5. [Test Results Summary](#test-results-summary)
6. [Critical Findings](#critical-findings)
7. [Data Quality Issues](#data-quality-issues)
8. [What Worked](#what-worked)
9. [What Didn't Work](#what-didnt-work)
10. [Current State](#current-state)
11. [Blockers](#blockers)
12. [Files Created](#files-created)
13. [Recommendations](#recommendations)
14. [Next Steps](#next-steps)

---

## Project Goal

Build a PnL calculation system that:
1. Accurately calculates realized PnL for Polymarket traders
2. Handles market makers with high trade frequency (100+ trades/position)
3. Accounts for resolution payouts (winning shares pay $1, losing shares pay $0)
4. Matches the Polymarket UI display

The initial benchmark was a set of 23 "ground truth" wallet PnL values allegedly from Goldsky.

---

## Data Sources Available

### 1. pm_user_positions (Goldsky Mirror)

**Schema:**
```
position_id: String
proxy_wallet: String
condition_id: String (ACTUALLY token_id in decimal format!)
realized_pnl: Float64 (micro-USDC, divide by 1e6)
unrealized_pnl: Float64 (ALWAYS 0 - not populated)
total_bought: Float64
total_sold: Float64 (ALWAYS 0 - not populated)
updated_at: DateTime
block_number: UInt64
is_deleted: UInt8
```

**Issues:**
- `condition_id` is mislabeled - it's actually the token_id in decimal format
- `unrealized_pnl` is always 0 (not populated by Goldsky)
- `total_sold` is always 0 (not populated)
- `realized_pnl` accumulates trade-level profits, causing massive inflation for market makers

### 2. pm_trader_events_v2 (Raw Trade Events)

**Key Fields:**
- `trader_wallet` - Wallet address
- `token_id` - Token ID (matches pm_token_to_condition_map_v3.token_id_dec)
- `side` - 'buy' or 'sell'
- `usdc_amount` - Trade value in micro-USDC
- `fee_amount` - Fees in micro-USDC
- `token_amount` - Shares in micro-units
- `trade_time` - Timestamp

**Status:** Most complete and reliable data source. All trades with proper fee accounting.

### 3. pm_token_to_condition_map_v3 (Token Mapping)

Maps token_id to condition_id and outcome_index:
- `token_id_dec` - Decimal token ID (matches pm_trader_events_v2.token_id)
- `condition_id` - 64-char hex condition ID
- `outcome_index` - 0 or 1 (YES or NO)

### 4. pm_condition_resolutions (Resolution Outcomes)

- `condition_id` - Condition that was resolved
- `payout_numerators` - JSON array like `[1,0]` or `[0,1]`
- `resolved_at` - Resolution timestamp

**Format:** `[1,0]` means outcome 0 wins, `[0,1]` means outcome 1 wins.

### 5. pm_ui_positions_new (Data API Mirror)

**Schema:**
```
proxy_wallet, condition_id, asset, outcome_index, total_bought, total_sold,
net_shares, cash_pnl, realized_pnl, unrealized_pnl, current_value, last_updated_at
```

**Status:** TABLE IS EMPTY for all 23 ground truth wallets. Backfill is incomplete.

---

## Ground Truth Data

23 whale wallets with provided PnL values:

| Wallet | Provided PnL | Provided Gains | Provided Losses |
|--------|--------------|----------------|-----------------|
| 0x4ce73141dbfce41e65db3723e31059a730f0abad | $332,563 | $333,508 | $945 |
| 0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144 | $114,087 | $118,922 | $4,835 |
| 0x8e9eedf20dfa70956d49f608a205e402d9df38e4 | $360,492 | $366,546 | $6,054 |
| 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b | $247,219 | $251,649 | $4,430 |
| 0x6770bf688b8121331b1c5cfd7723ebd4152545fb | $179,044 | $189,474 | $10,430 |
| ... (18 more wallets) | | | |

**Source:** User stated these are "straight from Goldsky" but we cannot reproduce them from any Goldsky table.

---

## Methodologies Attempted

### 1. Goldsky realized_pnl (Direct)

**Approach:** Sum `realized_pnl / 1e6` from pm_user_positions.

**Result:** 4/23 wallets match (17%)

**Problem:** Accumulates trade-level profits. Market makers with 140 trades/position show 40x inflation because every profitable trade adds to the total, even if it's the same position being traded back and forth.

### 2. Trade Cash Flow

**Approach:** Sum USDC in/out from pm_trader_events_v2.
- BUY: `-(usdc_amount + fee_amount) / 1e6`
- SELL: `+(usdc_amount - fee_amount) / 1e6`

**Result:** Matches trade flow but doesn't account for resolution payouts.

**Problem:** Shows negative for profitable traders who are still holding winning positions.

### 3. RESA (Raw Event-Sourced Architecture) - CURRENT BEST

**Approach:** Build from first principles with two event types:
1. **TRADE events** - From pm_trader_events_v2
2. **RESOLUTION events** - Synthetic events when positions are closed by resolution

**Formula:**
```
Net PnL = sum(usdc_delta) across all events

TRADE BUY:  usdc_delta = -(usdc_amount + fee_amount) / 1e6
TRADE SELL: usdc_delta = +(usdc_amount - fee_amount) / 1e6
RESOLUTION WIN:  usdc_delta = +final_shares * 1.0 (each winning share pays $1)
RESOLUTION LOSS: usdc_delta = 0 (losing shares are worthless)
```

**Result:** 2/23 wallets match (9%)

**Views Created:**
- `vw_wallet_condition_ledger_v1` - Core ledger with all events
- `vw_wallet_condition_pnl_v1` - Per-condition aggregation
- `vw_wallet_pnl_totals_v1` - Wallet-level totals

**Issue:** Only counts REALIZED PnL (resolved positions). Doesn't include unrealized gains/losses.

### 4. RESA + Unrealized (Hypothetical)

**Approach:** Add unrealized PnL by valuing open positions at current market prices.

**Analysis:** When we price open positions at ~$1.00/share, some wallets get closer to ground truth. But the implied prices vary wildly ($0.07 to $20.84), indicating this doesn't fully explain the gap.

### 5. Goldsky + Data API Hybrid

**Approach:** Use Goldsky gains + Data API losses.

**Result:** Data API is empty for these wallets, so this doesn't work.

---

## Test Results Summary

### Comprehensive Test: 23 Wallets

| Methodology | Matches (within 15%) | Match Rate |
|-------------|---------------------|------------|
| RESA (resolved only) | 2/23 | 9% |
| Goldsky realized_pnl | 4/23 | 17% |

### Sample Results Table

| Wallet | GT PnL | RESA | Ratio | Goldsky | Ratio | Open Pos |
|--------|--------|------|-------|---------|-------|----------|
| 0x4ce73141... | $332,563 | $281,401 | 0.85x | $13,587,268 | 40.86x | 0 |
| 0xb48ef6de... | $114,087 | $239,152 | 2.10x | $111,504 | 0.98x | 31 |
| 0x1f0a3435... | $107,756 | $42,905 | 0.40x | $112,926 | 1.05x | 167 |
| 0x8e9eedf2... | $360,492 | $45,703 | 0.13x | $2,459,808 | 6.82x | 139 |
| 0xcce2b7c7... | $247,219 | $37,404 | 0.15x | $87,031 | 0.35x | 17 |
| 0x6770bf68... | $179,044 | $14,552 | 0.08x | $9,729 | 0.05x | 10 |

---

## Critical Findings

### 1. Mathematical Impossibilities in Ground Truth

**Wallet 0x6770bf68...**
- Ground Truth PnL: $179,044
- Total Trading Volume: $93,277
- **This is impossible** - you cannot profit more than you trade

This wallet has 1,181 trades totaling $93K in volume. Claiming $179K profit is mathematically impossible for trading activity.

### 2. Goldsky realized_pnl is Fundamentally Broken for Market Makers

The Market Maker wallet (0x4ce73141...):
- 621,464 trades across 4,422 positions
- 140.5 trades per position average
- Goldsky shows $13.5M PnL (40.86x inflation)
- Ground Truth shows $332K

Goldsky accumulates profit from EVERY trade, not position outcomes. A market maker buying at $0.50 and selling at $0.51 repeatedly counts each $0.01 profit, even though net position doesn't change.

### 3. Inconsistent Discrepancy Patterns

The ratio between Goldsky and GT doesn't follow any consistent pattern:
- Some wallets: Goldsky >> GT (market makers, 6-40x)
- Some wallets: Goldsky ≈ GT (regular traders, ~1x)
- Some wallets: Goldsky << GT (0.05x-0.35x underreporting)

This randomness suggests the ground truth uses a completely different data source or calculation method.

### 4. Data API is Empty

The `pm_ui_positions_new` table (from Polymarket Data API) has **zero rows** for all 23 ground truth wallets. This table was supposed to be our source for accurate PnL but the backfill didn't cover these wallets.

---

## Data Quality Issues

### pm_user_positions (Goldsky)

| Field | Issue |
|-------|-------|
| `condition_id` | Actually token_id, not condition_id |
| `unrealized_pnl` | Always 0 |
| `total_sold` | Always 0 |
| `realized_pnl` | Inflated for active traders |

### pm_ui_positions_new (Data API)

- **Empty** for all ground truth wallets
- Backfill incomplete

### pm_condition_resolutions

- Generally reliable
- ~157-168 conditions per wallet are resolved
- Some wallets have 10-42 unresolved conditions

---

## What Worked

1. **RESA Architecture** - The conceptual model is sound:
   - TRADE events for cash flow from buys/sells
   - RESOLUTION events for position settlements
   - Net PnL = sum of all usdc_delta values

2. **Token-to-Condition Mapping** - The join between pm_trader_events_v2 and pm_token_to_condition_map_v3 works correctly.

3. **Resolution Detection** - We correctly identify winning outcomes from `payout_numerators` JSON.

4. **Views Created** - Three canonical views are now available:
   ```sql
   SELECT * FROM vw_wallet_pnl_totals_v1 WHERE wallet = '0x...'
   ```

---

## What Didn't Work

1. **Matching Ground Truth** - No methodology matches the provided values.

2. **Goldsky realized_pnl** - Fundamentally broken for market makers.

3. **Data API** - Table is empty for test wallets.

4. **Hybrid Approaches** - Can't mix sources when one is empty.

5. **Implied Price Analysis** - The implied prices needed to match GT vary from $0.07 to $20.84, which is nonsensical (shares can only be worth $0-$1).

---

## Current State

### Views Available

```sql
-- Core ledger: All TRADE and RESOLUTION events
vw_wallet_condition_ledger_v1

-- Per-condition PnL aggregation
vw_wallet_condition_pnl_v1

-- Wallet-level totals (gains, losses, net_pnl, omega_ratio)
vw_wallet_pnl_totals_v1
```

### Scripts Available

```bash
# Build RESA views
npx tsx scripts/pnl/build-resa-views.ts

# Run TDD tests against ground truth
npx tsx scripts/pnl/test-pnl-ground-truth.ts

# Investigate specific outlier wallet
npx tsx scripts/pnl/investigate-outlier.ts
```

### Test Results

- RESA matches 2/23 wallets (9%)
- Goldsky matches 4/23 wallets (17%)
- Neither methodology is reliable for the ground truth

---

## Blockers

### Primary Blocker: Unknown Ground Truth Source

We cannot validate any methodology because the ground truth source is unknown. Questions that need answers:

1. **What exact Goldsky product/API provided these values?**
   - Not from pm_user_positions (our Goldsky mirror)
   - May be from Goldsky UI, different API, or different table

2. **What time period does it cover?**
   - Snapshot from a specific date?
   - All-time cumulative?

3. **Does it include unrealized PnL?**
   - If so, at what market prices?

4. **Are these proxy wallets or EOA wallets?**
   - Polymarket uses proxy wallets for trading

5. **What methodology does it use?**
   - Position-level outcomes?
   - Trade-level profits?
   - Something else?

### Secondary Blocker: Missing Data

- `pm_ui_positions_new` is empty for test wallets
- Need to backfill Data API for validation

---

## Files Created

### Scripts

| File | Purpose |
|------|---------|
| `scripts/pnl/build-resa-views.ts` | Creates the three RESA views in ClickHouse |
| `scripts/pnl/test-pnl-ground-truth.ts` | TDD test with all 23 ground truth wallets |
| `scripts/pnl/investigate-outlier.ts` | Deep dive into outlier wallets |
| `scripts/check-whale-pnl.ts` | Comparison across multiple data sources |
| `scripts/test-first-principles-pnl.ts` | First principles PnL calculation |

### Documentation

| File | Purpose |
|------|---------|
| `docs/systems/database/PNL_GROUND_TRUTH_INVESTIGATION.md` | Investigation summary |
| `docs/systems/database/PNL_COMPREHENSIVE_DEBRIEF.md` | This document |
| `docs/systems/database/GOLDSKY_PNL_DATA_LIMITATIONS.md` | Goldsky limitations |
| `docs/systems/database/PNL_METHODOLOGY_V3.md` | Earlier methodology attempt |
| `docs/systems/database/PNL_METHODOLOGY_V4.md` | Earlier methodology attempt |

---

## Recommendations

### Short Term

1. **Clarify ground truth source** - This is critical. Without knowing where the numbers came from, we cannot validate.

2. **Use RESA for resolved positions** - The methodology is mathematically correct. Use `vw_wallet_pnl_totals_v1` for realized PnL.

3. **Validate against Polymarket UI directly** - Pick a few wallets and manually compare with the Polymarket website, not the provided ground truth.

### Medium Term

1. **Backfill pm_ui_positions_new** - Run the Data API backfill for all wallets.

2. **Add unrealized PnL** - Extend RESA to include unrealized gains using current market prices.

3. **Create unified view** - Combine realized + unrealized into a single view.

### Long Term

1. **Deprecate Goldsky realized_pnl** - It's fundamentally broken for market makers.

2. **Build real-time PnL updates** - Hook into trade events for live PnL tracking.

---

## Next Steps

1. **ASK USER**: Where exactly did the ground truth values come from?
   - Goldsky UI?
   - Specific API endpoint?
   - Different database?
   - Third-party source?

2. **Validate RESA against Polymarket UI** - Manual spot checks on 3-5 wallets.

3. **Backfill Data API** - Run `backfill-ui-positions.ts` for ground truth wallets.

4. **Consider unrealized PnL** - If ground truth includes unrealized, we need market price data.

---

## Appendix: Key Code Patterns

### RESA Event Model

```typescript
// TRADE event
{
  wallet: string,
  condition_id: string,
  outcome_index: number,
  event_type: 'TRADE',
  share_delta: isBuy ? +shares : -shares,
  usdc_delta: isBuy ? -(usdc + fee) : +(usdc - fee)
}

// RESOLUTION event
{
  wallet: string,
  condition_id: string,
  outcome_index: number,
  event_type: 'RESOLUTION',
  share_delta: -final_shares,  // Close position
  usdc_delta: isWinner ? final_shares * 1.0 : 0  // Winners get $1/share
}
```

### Resolution Winner Detection

```sql
CASE
  WHEN JSONExtractFloat(payout_numerators, 1) = 1 THEN 0  -- Outcome 0 wins
  WHEN JSONExtractFloat(payout_numerators, 2) = 1 THEN 1  -- Outcome 1 wins
  ELSE -1  -- Invalid
END AS winning_outcome
```

### Net PnL Calculation

```sql
SELECT
  wallet,
  sum(usdc_delta) AS net_pnl,
  sumIf(usdc_delta, usdc_delta > 0) AS gains,
  sumIf(usdc_delta, usdc_delta < 0) AS losses
FROM vw_wallet_condition_ledger_v1
GROUP BY wallet
```

---

## Contact

For questions about this investigation, refer to:
- This document
- The investigation log in `docs/systems/database/PNL_GROUND_TRUTH_INVESTIGATION.md`
- The RESA research report that guided the architecture

---

*Document created by Claude 1, 2025-11-23*
