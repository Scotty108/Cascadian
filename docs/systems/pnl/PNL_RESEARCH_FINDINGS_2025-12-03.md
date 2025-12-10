# PnL Research Findings - 2025-12-03

## Executive Summary

After extensive testing of multiple PnL calculation approaches across different wallet types, we've identified that the core issue is **data completeness**, not formula choice. None of our formulas produce values that match the Polymarket UI for test wallets.

## Test Wallets

| Wallet | Type | UI PnL | Best Formula Result | Error |
|--------|------|--------|---------------------|-------|
| JustDoIt (0x56bf...) | Trader | $1,519.31 | $2,231 (hybrid) | +47% |
| TraderRed (0xf130...) | Market-Maker | $148,649.77 | $94M (cost basis) | 63000%+ |
| ImJustKen (0xeef3...) | Trader | $47,426.30 | $0 (no events) | -100% |

## Formulas Tested

### For JustDoIt (Trader)

| Formula | Result | Error vs UI |
|---------|--------|-------------|
| V17 (CLOB-only + payout_norm) | $6,054 | +299% |
| CLOB+Redemption + payout_norm | $11,134 | +633% |
| Pure Cashflow | -$10,646 | -801% |
| Hybrid (cashflow if redeemed) | $2,231 | +47% |
| Realized only (closed positions) | $330 | -78% |

### For TraderRed (Market-Maker)

The ledger shows 3,302 PositionsMerge events but only 139 CLOB events. The tokens being merged were acquired through mechanisms not captured in our ledger (likely minting or external transfers). This causes massive inflation in PnL calculations.

## Key Findings

### 1. Data Gap: Token Acquisition Sources

For market-makers especially, tokens are acquired through:
- **Minting** (not in ledger)
- **External transfers** (not in ledger)
- **Split operations** (partially captured)

When we only see the SELL/MERGE side without the initial acquisition, we treat proceeds as pure profit.

### 2. Data Gap: ImJustKen Shows 0 Events

This wallet should have significant trading history but shows 0 events in `pm_unified_ledger_v9`. This indicates either:
- Different wallet format/normalization
- Missing data in the ledger
- The wallet trades via different mechanisms

### 3. Formula Choice is Secondary

We tested 5+ different formulas. The best one (hybrid) still has 47% error for a simple trader wallet. This suggests the issue is not which formula to use, but that our underlying data doesn't match what the UI uses.

### 4. Redemption Semantics

The ledger includes PayoutRedemption events that convert tokens to USDC. When combining CLOB + Redemption:
- If position is fully closed (tokens=0), use cashflow only
- If position has remaining tokens, add token_value * payout_norm
- Partial redemptions complicate this logic

## Cost Basis Engine (V1)

We built `lib/pnl/costBasisEngine.ts` implementing proper accounting:
- Sequential event processing
- Per-position cost basis tracking
- FIFO-style realized PnL on sells
- Handles CLOB, Split, Merge, Redemption events

However, the engine produces incorrect results because the input data is incomplete.

## Recommendations

### Short-Term (Pragmatic)

1. **Continue using V17 for leaderboard wallets** - 89% pass rate on top traders
2. **Accept that MMs will have wrong PnL** - their trading patterns don't fit our data
3. **Display PnL with appropriate caveats** - "PnL estimate based on available data"

### Medium-Term (Investigative)

1. **Audit data sources** - What events does Polymarket UI use that we're missing?
2. **Check API endpoints** - Does Polymarket expose a PnL API we can use directly?
3. **Analyze ERC1155 transfers** - Are we capturing all token movements?

### Long-Term (Proper Solution)

1. **Backfill complete token history** - Include minting, external transfers
2. **Implement proper cost basis tracking** - Use the engine with complete data
3. **Validate against API** - If Polymarket exposes PnL, use that as source of truth

## Files Created

- `lib/pnl/costBasisEngine.ts` - Core cost basis accounting engine
- `scripts/pnl/replay-cost-basis-v1.ts` - Replay script for validation
- `scripts/pnl/analyze-hybrid-formula.ts` - Formula comparison tool

## Wallet Classification (For Reference)

We classified 1,680,881 wallets by merge/split behavior:
- **T (traders)**: 98.3% of wallets, 8% of volume
- **M (market-makers)**: 0.7% of wallets, 89.6% of volume
- **X (mixed)**: 1.1% of wallets, 2.5% of volume

This classification is useful for understanding behavior patterns but doesn't help with PnL accuracy since the core issue is data completeness.

---

## CRITICAL DISCOVERY: Data Coverage Gaps (2025-12-03 Evening)

### The Root Cause

After following GPT's directive to "reconcile ERC1155 + ERC20 + CTF ground truth vs ledger", we discovered **fundamental data coverage gaps**:

#### 1. ERC1155 Data Starts at Block 37,000,001

```
pm_erc1155_transfers:
  Total: 42.6M transfers
  Block range: 37,000,001 - 78,876,522
```

**Impact**: Any trading before block 37M has no ERC1155 token flow data.

#### 2. ERC20 USDC Flows Are Incomplete

The `pm_erc20_usdc_flows` table only captures `ctf_deposit` and `ctf_payout` events - it does NOT capture USDC flows through exchange contracts:

- **JustDoIt**: Shows $0 ERC20 flows but ledger shows -$10K USDC
- **TraderRed**: Shows $94M incoming (payouts) but $0 outgoing (deposits)
- Corrupted data: Some rows have `amount_usdc = 1.15e71` (uint256 max)

#### 3. Ledger vs CLOB Mismatch for JustDoIt

```
CLOB trades in pm_trader_events_v2: 418
CLOB events in pm_unified_ledger_v9: 162
Missing: 256 trades (61%)
```

#### 4. Token Balance Reconciliation Fails

For JustDoIt:
- ERC1155 net balance: -2,667 tokens
- Ledger net balance: +18,598 tokens
- **Difference: 21,265 tokens unaccounted**

### TraderRed Deep Dive

TraderRed received $94M from PositionsMerge but has:
- **0 PositionSplit events** (didn't create tokens themselves)
- **Only 8 ERC1155 transfers** (51K tokens received)
- **139 CLOB trades** (482K tokens bought)

Yet they merged enough tokens for $94M USDC. The tokens came from exchange contracts that did PositionSplits on their behalf - but we can't see the USDC TraderRed paid to those exchanges.

### The Equation That Must Balance

Per GPT:
```
sum_erc1155(token_delta) == sum_clob(token_delta) + sum_ctf(token_delta) + sum_external(token_delta)
```

This equation FAILS for all test wallets because:
1. ERC1155 data is incomplete (starts at block 37M)
2. ERC20 data is incomplete (only ctf_deposit/payout)
3. CLOB data has duplicates and missing events

### Data Tables Status

| Table | Status | Coverage | Issues |
|-------|--------|----------|--------|
| pm_trader_events_v2 | Partial | All blocks | 2-3x duplicates, missing events |
| pm_erc1155_transfers | Partial | Block 37M+ only | Missing early history |
| pm_erc20_usdc_flows | Partial | Unknown | Only ctf_deposit/payout, corrupted data |
| pm_ctf_events | Complete | All blocks | Good |
| pm_unified_ledger_v9 | Partial | Derived | Inherits upstream gaps |

### Path Forward

**Option A: Accept Limitations**
- Continue using V17 for leaderboard (89% pass rate)
- Accept that older wallets will have wrong PnL
- Display with caveats

**Option B: Backfill Missing Data**
- Source ERC1155 data from block 0 (Goldsky or Polygon RPC)
- Source complete ERC20 USDC transfers (not just CTF events)
- Rebuild ledger from complete data
- Estimated effort: 2-5 days

**Option C: Use Polymarket API**
- Check if Polymarket exposes PnL via API
- Use their calculation as source of truth
- Our data becomes backup/audit

### Files Created in This Investigation

- `scripts/pnl/reconcile-erc1155-vs-ledger.ts` - Ground truth reconciliation tool

---

## FILLS-ONLY PnL INVESTIGATION (2025-12-04 Night)

### Question: Can we calculate PnL just from fills data?

**Answer: NO**

### Attempt: Raw Fills Calculation

We tried calculating PnL using only:
- `pm_trader_events_v2` (CLOB fills)
- `pm_ctf_events` (PayoutRedemption events)
- `vw_pm_resolution_prices` (resolution prices)
- `pm_token_to_condition_map_v4` (token→condition mapping)

### Results for JustDoIt

```
CLOB cashflow:    -$54,915.98
+ Redemptions:    +$44,269.81
= Realized PnL:   -$10,646.18
+ Unrealized:     +$60,970.19
─────────────────────────────────
TOTAL PnL:        +$50,324.01

UI Target:        +$1,519.31
Error:            +$48,805 (3212%)
```

### Root Cause: Negative Positions

JustDoIt has **26 positions** where they SOLD more tokens than they BOUGHT via CLOB:

| Issue | Count |
|-------|-------|
| Positions with net SELL | 26 |
| Tokens sold without CLOB buy | 62,505 |
| CLOB trades before ERC1155 data | 362 trades, 585K tokens, $392K USDC |

These 62K+ tokens were acquired OUTSIDE the CLOB:
- ERC1155 transfers from other wallets
- PositionSplit events (minting)
- Other mechanisms

### Why This Breaks PnL Calculation

1. **Unknown Cost Basis**: When JustDoIt sells 10,000 tokens they didn't buy via CLOB, we see +$10K USDC but don't know if that's profit (could be break-even or loss)

2. **Negative × Payout Bug**: For "negative positions" (sold more than bought), calculating `tokens × payout` gives wrong sign. A wallet that sold winners shows negative unrealized value.

3. **No PositionSplit Events**: JustDoIt shows 0 PositionSplit in `pm_ctf_events` (only 20 PayoutRedemptions). The system HAS 80M PositionSplit events globally, but they're either:
   - On different wallets (exchange contracts)
   - Missing from our query

### CTF Event Counts

```
Global pm_ctf_events:
  PositionSplit:     80,070,376
  PayoutRedemption:  20,544,842
  PositionsMerge:    20,341,766

JustDoIt pm_ctf_events:
  PayoutRedemption:  20
  PositionSplit:     0   ← Missing!
  PositionsMerge:    0
```

### Conclusion

**Fills data alone is insufficient** because:

1. CLOB fills only capture ORDER BOOK trades
2. Tokens enter wallets via multiple mechanisms:
   - CLOB buys (captured)
   - ERC1155 transfers (partially captured, starts block 37M)
   - PositionSplit minting (captured but on wrong address?)
3. Without complete token acquisition history, we can't calculate cost basis
4. Without cost basis, PnL is undefined

### Next Steps

**Option 1: Deep Audit of PositionSplit**
- Why does JustDoIt show 0 PositionSplits?
- Are they stored under a different address (exchange contract)?
- Can we trace the PositionSplit → transfer → JustDoIt chain?

**Option 2: Use External API**
- Does Polymarket expose a PnL endpoint?
- Use their calculation as source of truth

**Option 3: Accept Inaccuracy**
- V17 works for 89% of leaderboard wallets
- Accept that wallets with complex acquisition patterns will be wrong

---

## FILLS COMPLETENESS CHECKER (2025-12-04)

### New Tool: `scripts/pnl/check-fills-completeness.ts`

This script determines if fills-only PnL is valid for a given wallet by comparing:
- Net tokens per position from CLOB (`pm_trader_events_v2`)
- Ground truth net tokens from ledger (`pm_unified_ledger_v9`)

If the differences are near zero, `fills_complete = true` and fills-only PnL is valid.

### Results for Test Wallets

| Wallet | Fills Complete | Bad Positions | Worst Diff | Net Diff |
|--------|---------------|---------------|------------|----------|
| JustDoIt | NO ✗ | 19 | 20,000 | 44,270 |
| TraderRed | NO ✗ | 472 | 11,480,012 | 94,941,208 |
| ImJustKen | NO ✗ | 0 | 0 | 0 (no trades) |

**Result: 0/3 wallets have complete fills data**

### Strategic Path Forward

Based on this investigation, the recommended approach is:

1. **Use Fills Completeness Checker as a filter**
   - Run on any wallet before calculating fills-only PnL
   - If `fills_complete = true`: Use simple fills PnL
   - If `fills_complete = false`: Fall back to V17 or mark as "unavailable"

2. **For "safe" wallets (fills_complete = true)**
   ```
   PnL = sum(USDC_in_from_sells)
       + sum(USDC_in_from_redemptions)
       - sum(USDC_out_to_buys)
       + unrealized_value (optional)
   ```

3. **For "unsafe" wallets (fills_complete = false)**
   - Continue using V17 (89% pass rate on leaderboard)
   - Display with caveat: "PnL estimate based on available data"
   - Or show "PnL unavailable due to incomplete data"

4. **Long-term options**
   - Backfill ERC1155 + ERC20 from block 0
   - Use Polymarket API if they expose PnL endpoint
   - Accept that historical/complex wallets will be approximate

### Files Created

- `scripts/pnl/check-fills-completeness.ts` - Fills completeness checker
- `scripts/pnl/analyze-fills-pnl.ts` - Fills-only PnL analysis tool

---

*Research conducted by Claude 1 on 2025-12-03*
*Updated with data coverage findings on 2025-12-03 evening*
*Updated with fills-only investigation on 2025-12-04 night*
*Added fills completeness checker on 2025-12-04*
