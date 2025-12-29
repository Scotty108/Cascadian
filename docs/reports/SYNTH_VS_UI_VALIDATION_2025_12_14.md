# Synthetic Realized vs UI Implied Validation Report

**Date:** 2025-12-14
**Validator:** scripts/pnl/validate-synth-vs-ui-v2.ts

## Summary

| Metric | Value |
|--------|-------|
| Wallets Tested | 143 |
| PASS (<5% diff) | 1 (0.7%) |
| WARN (5-20% diff) | 4 (2.8%) |
| FAIL (>20% diff) | 138 (96.5%) |
| P50 Diff | 328% |
| P95 Diff | 190,288% |

**Verdict:** FAILED - Formula or data alignment issue detected

## Definitions Used

```
pnl_synth_realized = cash_flow + final_tokens * resolved_price
open_value = sum(currentValue) from Polymarket positions API
ui_implied_realized = ui_total_pnl - open_value
```

## Root Cause Analysis

### 1. Temporal Mismatch (Primary Issue)
- UI PnL benchmarks captured on **Dec 7, 2025**
- Positions API fetched **Dec 14, 2025** (7 days later)
- Many markets resolved between these dates
- Result: `open_value` changed significantly, invalidating the formula

### 2. CLOB Data Coverage Gaps
Multiple wallets show near-zero synth realized despite large UI PnL:
- `0x7724f6f8`: UI=$170K, Synth=-$3, CLOB USDC=$4.5K
- `0xc0fab651`: UI=$130K, Synth=-$75
- These wallets likely traded through channels not in our CLOB data

### 3. External Inventory Contamination
Some wallets show absurdly high synth values:
- `0x1f2dd6d4`: UI=$10, Synth=$8.3M
- `0x78b9ac44`: UI=$4, Synth=$1.8M
- These wallets received tokens externally (not via CLOB buys)

### 4. Proxy Wallet vs EOA Mismatch
The Polymarket positions API may return data for a different address than our CLOB data tracks.

## Case Studies

### PASS Wallet: 0xa6f7075f940a40a2c6cd8c75ab55a2138351b476
- UI Total: $4,200
- Open Value: $118 (small)
- UI Implied Realized: $4,082
- Synth Realized: $4,088
- **Delta: +$6 (0.1%) - PASS**
- Why it worked: Small open positions, most PnL already realized

### FAIL Wallet: 0x7724f6f8023f40bc9ad3e4496449f5924fa56deb
- UI Total: $170,000 (scraped Dec 7)
- Open Value: $6 (current)
- UI Implied Realized: $169,994
- Synth Realized: -$3
- **Delta: -$170K (100%) - FAIL**
- Why it failed: CLOB data shows only $4.5K activity, missing trades

## Recommendations

### Immediate Fix: Time-Synchronized Validation
1. Scrape UI PnL AND positions at the same time
2. Use the formula: `ui_implied_realized = ui_total_pnl - open_value`
3. Both values must be from the same timestamp

### Alternative: Use Polymarket API Realized Directly
The positions API returns `realizedPnl` per position. Sum this for validation instead of computing implied.

### Data Quality: Filter Trusted Cohort
Before any validation:
1. Exclude wallets with external inventory (sell_qty > buy_qty)
2. Exclude wallets with < 10 CLOB events
3. Only include wallets with significant CLOB activity

## Files Created/Modified

- `scripts/pnl/validate-synth-vs-ui-v2.ts` - Main validator
- `docs/reports/SYNTH_VS_UI_VALIDATION_2025_12_14.md` - This report

## Next Steps

1. **Re-scrape UI PnL with current positions** - Ensure temporal alignment
2. **Add Polymarket API realized comparison** - Direct API-to-synth validation
3. **Build trusted cohort filter** - Exclude problematic wallets
4. **Validate on fresh data** - Re-run with time-synchronized data
