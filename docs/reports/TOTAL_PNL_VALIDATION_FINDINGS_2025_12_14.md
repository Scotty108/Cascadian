# Total PnL Validation Findings Report

**Date:** 2025-12-14
**Validator Scripts:**
- `scripts/pnl/validate-total-identity-v1.ts` (API-based)
- `scripts/pnl/validate-total-vs-dome-v1.ts` (Dome-based)

## Executive Summary

**Result: 0% pass rate** - The formula `total_pnl = net_cashflow + open_value` does NOT match Dome API's `pnl_to_date` for any of the 20 wallets tested.

## Formula Tested

```
our_total = net_cashflow + open_value

where:
  net_cashflow = sum(
    case
      when side = 'buy'  then -(usdc_amount + fee_amount)
      when side = 'sell' then  (usdc_amount - fee_amount)
    end
  ) / 1e6

  open_value = sum(currentValue) from Polymarket positions API
```

## Validation Results

| Metric | Value |
|--------|-------|
| Wallets Tested | 20 |
| PASS (<5% diff) | 0 (0%) |
| WARN (5-20%) | 0 (0%) |
| FAIL (>20%) | 20 (100%) |
| Our > Dome | 7 wallets |
| Our < Dome | 13 wallets |

## Root Cause Analysis

### Finding 1: CLOB Data vs Dome Are Fundamentally Different

For wallet `0xb48ef6de...`:
- **Dome says:** +$120,088 total PnL
- **Our CLOB says:** $-1,686,000 net cashflow
- **Open positions:** $421,447
- **Our total:** $-1,264,553
- **Discrepancy:** ~$1.38M

### Finding 2: Redemptions Don't Bridge the Gap

Even adding redemption payouts from our tables:
- `pm_redemption_payouts_agg`: $520,287 in payouts
- `vw_ctf_ledger`: $174,812 in payouts (inconsistent with above!)

Corrected formula still shows -$744K vs Dome's +$120K.

### Finding 3: Proxy Wallet Key Doesn't Help

For all 20 wallets tested:
- Input wallet = Proxy wallet (from positions API)
- CLOB data for both show identical results
- No wallet key mismatch found

### Finding 4: Inconsistent Redemption Data

Two different data sources show vastly different redemption amounts:
- `pm_redemption_payouts_agg`: 14 redemptions, $520K total
- `vw_ctf_ledger`: 5 markets, $174K total

## Sample Case Deep Dive

**Wallet:** `0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144`

| Source | Value |
|--------|-------|
| CLOB Buys | $2,294,094 (780 trades) |
| CLOB Sells | $608,094 (301 trades) |
| CLOB Net | -$1,686,000 |
| Redemption Payouts (agg) | $520,287 |
| CTF Payouts (ledger) | $174,812 |
| Open Positions | $421,447 |
| **Our Total (with redemptions)** | **-$744K to -$1.09M** |
| **Dome Total** | **+$120,088** |
| **Gap** | **$860K - $1.21M** |

## Hypotheses for Discrepancy

1. **CLOB Data Overcounting**: The CLOB data may be capturing fills that shouldn't be attributed to this wallet (e.g., maker fills on someone else's order)

2. **Different Wallet Attribution**: Dome may attribute trades differently (by proxy vs operator vs owner)

3. **Historical Data Issues**: CLOB backfill may have ingested duplicate or incorrect data

4. **Missing Inflows**: The wallet may have received tokens through channels not captured in CLOB (transfers, AMM trades, etc.)

5. **Fee Handling**: Our fee handling may differ from Dome's methodology

## Next Steps Recommended

1. **Compare Single Trade**: Pick one specific trade that exists in both Dome and CLOB, compare attribution

2. **Check CLOB Source**: Verify the Goldsky CLOB fill data against on-chain transactions

3. **Profile One Wallet End-to-End**: Trace all on-chain activity for one wallet and reconcile

4. **Compare Against Polymarket Profile API**: If there's an API that returns historical trades, compare counts

## Files Created

- `scripts/pnl/scrape-ui-snapshot-v1.ts` - Playwright scraper (blocked by animated counter)
- `scripts/pnl/validate-total-identity-v1.ts` - API-based validator
- `scripts/pnl/validate-total-vs-dome-v1.ts` - Dome-based validator

## Conclusion

The current CLOB-based total PnL formula does not match Dome API for any wallets tested. The discrepancies are systematic and large (often 100%+). Further investigation into the source CLOB data attribution is needed before the formula can be validated.

**Recommendation:** Do not proceed with CLOB-based PnL for copy-trade leaderboard ranking until the root cause is identified. Consider using Dome API directly as the source of truth for wallet PnL if available within rate limits.
