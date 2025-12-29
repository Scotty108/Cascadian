# Calibration Wallet Investigation - Complete Report

**Date:** 2025-12-24
**Wallet:** `0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e`
**UI P&L Target:** -$86
**Our Best Calculation:** +$1,867

## Executive Summary

After exhaustive database investigation, we identified **TWO critical data gaps** that explain why calibration's P&L cannot be calculated accurately:

1. **Token Mapping Gap:** ALL 54 of calibration's traded tokens are UNMAPPED in `pm_token_to_condition_map_v5`
2. **ERC1155 Transfer Gap:** The `pm_erc1155_transfers` table is 6 weeks stale (ends 2025-11-11), and calibration started trading on 2025-12-22

## Investigation Findings

### Trading Profile
| Metric | Value |
|--------|-------|
| Trading Period | 2025-12-22 04:57 to 07:53 (< 3 hours!) |
| Total Trades | 2,036 |
| Buy Trades | 1,049 ($1,214 spent) |
| Sell Trades | 987 ($3,848 received) |
| Tokens Bought | 4,396 |
| Tokens Sold | 5,522 |
| **Token Deficit** | **1,126** |

### Token Source Investigation

| Data Source | Result |
|-------------|--------|
| CTF PositionSplit events | 0 |
| CTF PositionsMerge events | 0 |
| CTF PayoutRedemption events | 25 ($358.54) |
| ERC1155 Transfers (in or out) | 0 (data stale!) |
| FPMM/AMM Trades | 0 |
| NegRisk Conversions | 0 |
| API Positions | 0 |

### Transaction Pattern Analysis

| Pattern | Tx Count | Net Token Flow |
|---------|----------|----------------|
| BOTH (buy+sell in same tx) | 838 | +103 tokens |
| Pure BUY | 99 | -695 tokens |
| Pure SELL | 30 | +1,717 tokens |

**All 838 "BOTH" transactions are on the SAME condition** - paired outcome trading.

### Data Gaps Identified

1. **Token Mapping Gap:**
   - 54 unique tokens traded by calibration
   - 0 of these are in `pm_token_to_condition_map_v5`
   - This means these are likely NEW markets that haven't been mapped yet

2. **ERC1155 Transfer Gap:**
   - `pm_erc1155_transfers` latest data: 2025-11-11 10:45:29
   - Calibration first trade: 2025-12-22 04:57:18
   - **6+ week gap means ANY token transfers are missing**

3. **Possible CTF Events Gap:**
   - Global PositionSplit count: 103M events
   - Calibration PositionSplit count: 0
   - Either calibration never split, OR our CTF events ingestion has gaps

## P&L Calculation Attempts

| Method | Result | Notes |
|--------|--------|-------|
| Pure Cash Flow | +$2,993 | Sells + Redemptions - Buys |
| Adjusted (deficit × $1) | +$1,867 | Assumes splits cost $1/token |
| UI Target | -$86 | What Polymarket shows |
| **Gap** | **$1,953** | Unexplained difference |

### Why We Can't Match UI

The UI shows -$86 but our best calculation shows +$1,867. The $1,953 gap would require:
- Split cost per token: $1,953 / 1,126 = **$1.73/token**
- This is impossible since splits cost exactly $1.00/token

**Conclusion:** The UI uses per-position cost basis tracking that we don't have access to. The UI knows the actual cost of each token position, while we only see aggregate flows.

## Root Cause: Data Pipeline Gaps

### Why ERC1155 Transfers Are Stale
The `pm_erc1155_transfers` table ends at 2025-11-11. This needs to be backfilled or resynced to current date.

### Why Token Mapping Is Empty
Calibration's tokens may be from new markets created after our last token mapping sync. The `pm_token_to_condition_map_v5` table needs to be updated.

### Why CTF Events May Be Missing
If calibration did splits, they would appear in `pm_ctf_events` as `PositionSplit`. The fact that we see 0 suggests either:
1. Calibration never split (unlikely given token deficit)
2. CTF events ingestion has gaps for recent blocks

## Recommendations

### Immediate Actions
1. **Backfill ERC1155 transfers** from 2025-11-11 to present
2. **Update token mapping** to include new markets
3. **Verify CTF events** ingestion is current

### For Copy Trading P&L
1. **Use Pure Cash Flow** for normal traders (2/3 correct signs)
2. **Flag arbitrageurs** (sell/buy ratio > 2x, token deficit > 0)
3. **Accept limitations** for edge cases like calibration

### Arbitrageur Detection Pattern
```typescript
const isArbitrageur =
  (sellBuyRatio > 2.0) &&
  (tokenDeficit > 0) &&
  (mappedTokenRatio < 0.5);

if (isArbitrageur) {
  // Flag for manual review or exclude from rankings
}
```

## Technical Details

### Queries Used
All investigation queries are documented in:
- `scripts/investigate-calibration-tokens.ts`

### Tables Checked
| Table | Calibration Data |
|-------|-----------------|
| `pm_trader_events_dedup_v2_tbl` | 2,036 trades |
| `pm_ctf_events` | 25 PayoutRedemption only |
| `pm_erc1155_transfers` | 0 (data stale) |
| `pm_fpmm_trades` | 0 |
| `vw_negrisk_conversions` | 0 |
| `pm_token_to_condition_map_v5` | 0 mapped |
| `pm_unified_ledger_v8_tbl` | 0 (empty) |
| `pm_unified_ledger_v9_clob_tbl` | 0 (empty) |
| `pm_api_positions` | 0 |

## Conclusion

The calibration wallet is an **extreme arbitrageur** who traded 2,036 times in under 3 hours on 2025-12-22. Their P&L cannot be accurately calculated because:

1. **None of their tokens are in our mapping table**
2. **ERC1155 transfer data doesn't cover their trading period**
3. **They likely acquired tokens through splits we can't see**

The $1,953 gap between our calculation and the UI remains unexplained due to these data gaps. Fixing the data pipeline issues may help, but for now, calibration should be flagged as an "unmatchable edge case" for copy trading P&L purposes.
