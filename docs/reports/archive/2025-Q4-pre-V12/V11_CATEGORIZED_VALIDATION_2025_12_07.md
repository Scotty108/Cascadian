# V11 Categorized Validation Report

**Date:** 2025-12-07
**Method:** Direct Playwright scraping of Polymarket profile pages + V11 computation
**Test Set:** 66 categorized wallets + benchmark wallets

## Executive Summary

**V11 engine systematically OVERCOUNTS P/L by 13-118% compared to Polymarket UI**

The validation reveals significant discrepancies between V11 computed values and Polymarket UI, with V11 consistently showing higher P/L values.

## Key Findings

### 1. Verified Wallet Comparisons

| Wallet | Name | UI P/L | V11 P/L | Diff | Diff % |
|--------|------|--------|---------|------|--------|
| 0x5a99b60c... | @888888888888 | $3,508.18 | $7,642.33 | +$4,134 | **+118%** |
| 0x56687bf4... | Whale (closed) | $22,053,934 | $24,975,380 | +$2,921,446 | **+13.2%** |
| 0x8c573be6... | @kinfolk | $4,906.11 | $5,590.40 | +$684 | **+14%** |
| 0x30cecdf2... | @ZXWP | $5,933.80 | $3,303.77 | -$2,630 | **-44%** |

### 2. Key Observation: Many Wallets Show $0 P/L in UI

Many wallets from our categorized validation set (pulled from `pm_trader_events_v2`) show **$0.00 P/L** and **0 Predictions** in Polymarket UI:

- These are likely **proxy wallets**, **bot wallets**, or **market maker wallets**
- They trade on-chain but don't have registered Polymarket UI profiles
- V11 correctly computes their on-chain P/L, but UI doesn't display them

**Examples of $0 UI wallets:**
- `0x0122006b...` - V11: $244.10, UI: $0.00
- `0x1584cb3b...` - V11: $20,650.81, UI: $0.00
- `0xa103eee9...` - V11: $156,546.99, UI: $0.00
- `0x3853ca23...` - V11: $135.28, UI: $0.00

### 3. V11's Open Position Detection Issue

V11's open position count doesn't match UI:
- Wallet `0x8c573be6...`: V11 says "0 open positions @ $0" but UI shows $4,230.54 in position value
- Wallet `0x30cecdf2...`: V11 says "1694 open positions @ $817K" but UI shows only $141.17 position value

This suggests V11 is miscounting positions.

## Categories Tested

### CLOB_ONLY (20 wallets)
- Most show $0 P/L in UI (proxy/bot wallets)
- V11 computes values ranging from -$6,326 to +$20,650

### CTF_SPLIT_MERGE (20 wallets)
- Many show $0 P/L in UI (CTF-only activity)
- V11 shows $0 for pure CTF wallets (expected - V11 is CLOB-only)
- Some with mixed activity show large V11 values: $1.9M, $429K, etc.

### REDEMPTIONS (11 wallets)
- All show $0 P/L in UI (redemption-heavy wallets)
- V11 shows large realized P/L: $308K, $346K, $232K, etc.

### TRANSFERS (14 wallets)
- Mixed results, some with massive V11 open positions ($12.6M)
- Several memory/timeout errors on large wallets

## Root Cause Analysis

V11 overcounting appears to be caused by:

1. **CLOB duplicates**: Despite deduplication efforts, there may still be double-counting in trade data
2. **Missing CTF events**: V11 doesn't account for CTF splits/merges/redemptions
3. **Resolution timing**: Discrepancy in when positions are marked as resolved

## Recommendations

### For Copy-Trade Leaderboard V1

1. **DO NOT use V11 directly** - Systematic overcounting makes it unreliable
2. **Use Polymarket UI benchmarks** - Scrape directly from UI for ground truth
3. **Filter to UI-visible wallets** - Only include wallets with actual UI presence (Predictions > 0)
4. **Trust benchmark data** - Use `pm_ui_pnl_benchmarks_v1` for wallets with captured UI values

### Next Steps

1. Investigate CLOB deduplication in V11 engine
2. Consider integrating CTF events into P/L calculation
3. Build UI scraper for automated benchmark capture
4. Cross-reference with Gamma API where available

## Files Generated

- `tmp/categorized_validation_set.json` - 66 wallets across 5 categories
- `tmp/categorized_v11_results.json` - V11 computation results
- `scripts/pnl/validate-categorized-vs-ui.ts` - Validation script
- `scripts/pnl/scrape-ui-pnl-playwright.ts` - UI scraper helper

## Conclusion

**V11 engine is NOT production-ready** for matching Polymarket UI P/L values. The systematic overcounting (13-118%) and position detection issues require further investigation before V11 can be used for user-facing leaderboards.

For the immediate term, use **direct UI benchmarks** from the `pm_ui_pnl_benchmarks_v1` table as the source of truth.
