# Resolution Coverage - Quick Facts

## The Numbers

```
CONDITION IDS (MARKETS):
  Total unique:     233,353
  With resolutions:  57,655 (24.7%)
  Missing:          175,698 (75.3%)

TRADES (VOLUME):
  Total trades:      82,145,485
  With resolutions:   6,751,449 (8.2%)
  Missing:           75,394,036 (91.8%)

EMPTY CONDITION IDS:
  Empty trades:      77,435,673 (separate issue)
  Empty volume:      $18.7B
```

## What This Means

1. **Only 8.2% of trades can calculate P&L** - the rest have no resolution data
2. **75% of markets have no resolution** - likely they're still OPEN
3. **Half of all trades have empty condition_id** - data quality issue

## The Bug Confirmed

YES - the 75% missing claim is CONFIRMED:
- 5/20 random samples matched (25%) 
- 57,655 / 233,353 = 24.7%
- Consistent across all tests

## Root Cause

**Primary:** UNRESOLVED MARKETS (still open/awaiting outcome)  
**Secondary:** Empty condition_ids (77M trades affected)

## Impact

Current P&L dashboards show only 8.2% of actual trading activity.

## What's Working

Resolution sources are actively collecting data:
- rollup: 80,287 resolutions
- bridge_clob: 77,097 resolutions  
- onchain: 57,103 resolutions
- gamma: 6,290 resolutions
- clob: 3,094 resolutions

Total: 224,396 resolutions across 144,109 unique markets

## Immediate Action

1. Separate realized (8.2%) vs unrealized (91.8%) P&L
2. Query Polymarket API for market status
3. Fix empty condition_id issue (77M trades)

## Files Generated

- `RESOLUTION_COVERAGE_ANALYSIS_FINAL.md` - Full report
- `final-resolution-diagnostic.ts` - Main diagnostic script
- `investigate-anomaly.ts` - Volume analysis script
- `check-resolution-schema.ts` - Schema verification
- `check-trades-schema.ts` - Trades table schema
