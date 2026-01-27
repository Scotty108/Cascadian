# Wallet Investigation: 0xcf45fd3f476621aea72d09c44b2a694d79e9ed5f

**Date**: 2026-01-26
**Issue**: Wallet shows high edge (96.02%) and win rate (72%) but NEGATIVE total PnL (-$4,732)

## Critical Finding: SHORT Position Accounting Issue

### Summary of Discrepancy

| Metric | pm_trade_fifo_roi_v3 | wio_positions_v2 | Difference |
|--------|---------------------|------------------|------------|
| **Total Positions** | 98 | 35 | +63 (FIFO has more) |
| **Total PnL** | **-$4,732** | **-$9,560** | **+$4,828** |
| **Unique Markets** | 23 | 22 | +1 |
| **LONG trades** | 73 trades | N/A | +$6,618 PnL |
| **SHORT trades** | 25 trades | N/A | **-$11,350 PnL** |

### Root Cause: SHORT Positions Are Being Double-Counted or Mis-Aggregated

The key issue is that `pm_trade_fifo_roi_v3` includes **both LONG and SHORT** positions for the same market:

#### Example: Market 993abfacc936951426dc636b44fde63be24dc2c59f2b5f878a6a2cd0412f8570

**In pm_trade_fifo_roi_v3 (FIFO breakdown):**
- outcome_index 0, LONG: 7 trades, +$2,336 PnL, +123.5% avg ROI
- outcome_index 0, SHORT: 1 trade, +$2,918 PnL, +100% ROI (SHORT won!)
- outcome_index 1, LONG: 1 trade, +$115 PnL, +12.8% ROI
- outcome_index 1, SHORT: 1 trade, **-$9,415 PnL**, -9.78% ROI (SHORT lost badly!)
- **Net FIFO PnL for this market**: -$4,045

**In wio_positions_v2 (Position-based):**
- outcome_index 0, NO side: +$2,918 PnL (closed position)
- outcome_index 1, YES side: **-$9,415 PnL** (ROI -110%, which means 100% loss + fees/slippage)
- **Net Position PnL for this market**: -$6,497

**Difference**: $2,452 discrepancy

### Why the Discrepancy Exists

1. **pm_trade_fifo_roi_v3 tracks individual FIFO trades** (entry → exit pairs)
   - When you buy YES then sell it, that's 1 LONG trade
   - When you buy NO (which is "shorting YES"), that's 1 SHORT trade
   - If you do both in same market, you get 2+ entries

2. **wio_positions_v2 tracks net position state** (aggregate cash flow)
   - Aggregates all buys/sells into net_tokens and net_cash
   - Shows final PnL per position (condition + outcome)
   - ROI = pnl_usd / cost_usd

3. **The SHORT trade calculation in FIFO may be incorrect**
   - SHORT ROI of -9.78% doesn't match position ROI of -110%
   - This suggests the FIFO entry is calculating cost basis incorrectly for SHORTs

## Data Comparison

### LONG vs SHORT Performance (from FIFO)

| Type | Trades | Total PnL | Avg ROI | Wins | Losses |
|------|--------|-----------|---------|------|--------|
| LONG | 73 | +$6,618 | **+92.0%** | 52 | 21 |
| SHORT | 25 | **-$11,350** | +26.0% | 14 | 11 |
| **Net** | **98** | **-$4,732** | **+75.2%** | **66** | **32** |

**Problem**: The wallet is EXCELLENT at LONG trades (+92% avg ROI, 71% win rate) but TERRIBLE at SHORT trades (-$11,350 total loss).

### Sample Losing Trades (Worst 10 from FIFO)

All top 10 losses are SHORT positions or LONG positions that went to zero:

| Condition ID (short) | Outcome | Type | PnL | ROI | Tokens Held | Entry Date |
|---------------------|---------|------|-----|-----|-------------|------------|
| 993abfacc9... | 1 | SHORT | -$9,415 | -9.78% | 105,705 | 2025-11-20 |
| d31956675... | 1 | SHORT | -$7,194 | -29.87% | 31,275 | 2025-11-17 |
| 0248bcacf... | 1 | SHORT | -$4,090 | -5.03% | 85,399 | 2025-11-20 |
| 2a2d5924e... | 1 | SHORT | -$1,113 | -3.49% | 32,980 | 2025-11-21 |
| d31956675... | 0 | LONG | -$602 | -100% | 2,642 | 2025-11-23 |
| 285908f7d... | 0 | LONG | -$294 | -100% | 3,630 | 2026-01-20 |
| 5e8e585d8... | 1 | SHORT | -$246 | -3.17% | 8,027 | 2025-12-01 |
| 2690f6e83... | 0 | LONG | -$219 | -48.2% | 0 (sold early) | 2025-11-23 |
| 8e147ecbe... | 1 | SHORT | -$112 | -2.54% | 4,523 | 2025-11-23 |
| dafcaa79f... | 1 | SHORT | -$98 | -96.1% | 200 | 2025-11-14 |

## Key Questions to Answer

### 1. Does pm_trade_fifo_roi_v3 include unresolved positions?

**ANSWER**: **YES, all trades are RESOLVED** (no zero dates, latest resolution 2026-01-24)

From query:
```sql
earliest_resolution: 2025-11-13 19:56:40
latest_resolution:   2026-01-24 00:13:20
zero_date_count:     0
```

### 2. Are we missing unrealized losses?

**ANSWER**: **NO** - All positions in wio_positions_v2 are also resolved (is_resolved = 1 for all 35 positions)

BUT: wio_positions_v2 shows **-$9,560** vs FIFO **-$4,732** = **$4,828 difference**

### 3. Why is the edge metric (96.02%) so high if PnL is negative?

**LIKELY ANSWER**: The edge calculation is using LONG trades only, or averaging ROI without weighting by position size.

- LONG trades: +92% avg ROI (73 trades)
- SHORT trades: +26% avg ROI (25 trades) BUT -$11,350 total loss
- **Weighted average**: (73 * 92% + 25 * 26%) / 98 = **75.2%** ✓ (matches FIFO avg_roi_pct)

**But this is misleading!** The 75% average ROI doesn't reflect:
- Position sizing (small wins, huge SHORT losses)
- Absolute dollar losses from failed SHORTs

## Recommended Actions

### Immediate (Data Validation)

1. **Verify SHORT position calculation in FIFO v4 script**
   - File: `scripts/backfill/fifo-v4-with-short.ts`
   - Check if SHORT PnL is being calculated correctly
   - Compare against wio_positions_v2 logic

2. **Check if SHORT trades are being created correctly**
   - Condition: 993abfacc936951426dc636b44fde63be24dc2c59f2b5f878a6a2cd0412f8570
   - FIFO shows SHORT (is_short=1) with -$9,415 loss
   - wio shows YES position with -$9,415 loss (ROI -110%)
   - Why is ROI different? (-9.78% vs -110%)

3. **Investigate if user's "active positions" are phantom data**
   - User claims many -100% positions in active tab
   - But ALL positions show is_resolved = 1 in database
   - This suggests frontend is showing stale/incorrect data

### Medium-Term (Fix Metrics)

4. **Add dollar-weighted edge metric**
   - Current: Simple average ROI (misleading)
   - Proposed: `sum(pnl_usd) / sum(cost_usd)` = TRUE ROI
   - For this wallet: -$4,732 / ??? = NEGATIVE edge

5. **Separate LONG vs SHORT metrics in leaderboard**
   - Many traders may be good at LONGs but bad at SHORTs
   - Current aggregation hides this critical insight

6. **Add "largest loss" and "largest win" fields**
   - This wallet's -$9,415 single loss wiped out many small wins
   - Shows risk management failure

### Long-Term (Product)

7. **Flag wallets with negative PnL but positive edge**
   - This is a red flag for:
     - Bad position sizing
     - Bad risk management
     - Or data quality issues

8. **Add unrealized PnL tracking**
   - Currently only tracking resolved positions
   - Need to show mark-to-market for open positions
   - (Though for this wallet, all positions ARE resolved)

## Files to Check

1. `/scripts/backfill/fifo-v4-with-short.ts` - FIFO v4 calculation logic
2. `/lib/pnl/pnlEngineV1.ts` - PnL engine (may be using FIFO table)
3. `/app/api/leaderboard/*/route.ts` - Edge calculation logic
4. Frontend position display - Why showing "active" when all are resolved?

## SQL Queries for Further Investigation

```sql
-- Check if there are any unresolved positions in canonical_fills
SELECT
  count(*) as total_fills,
  countIf(abs(tokens_delta) > 0.01) as open_positions
FROM pm_canonical_fills_v4 FINAL
WHERE wallet = '0xcf45fd3f476621aea72d09c44b2a694d79e9ed5f'
GROUP BY wallet

-- Find the FIFO script's SHORT calculation logic
-- (Need to review TypeScript file manually)

-- Compare cost basis between FIFO and wio_positions for SHORT trades
SELECT
  f.condition_id,
  f.outcome_index,
  f.is_short,
  f.cost_usd as fifo_cost,
  f.pnl_usd as fifo_pnl,
  f.roi as fifo_roi,
  w.cost_usd as wio_cost,
  w.pnl_usd as wio_pnl,
  w.roi as wio_roi
FROM pm_trade_fifo_roi_v3 FINAL f
LEFT JOIN wio_positions_v2 FINAL w
  ON f.wallet = w.wallet_id
  AND f.condition_id = w.condition_id
  AND f.outcome_index = w.outcome_index
WHERE f.wallet = '0xcf45fd3f476621aea72d09c44b2a694d79e9ed5f'
  AND f.is_short = 1
ORDER BY f.pnl_usd ASC
LIMIT 20
```

## Conclusion

**This wallet is NOT actually "smart money"** despite the 96% edge metric:

- ✅ Excellent at LONG trades (+$6,618, 92% avg ROI)
- ❌ TERRIBLE at SHORT trades (-$11,350 total loss)
- ❌ Net result: **-$4,732 total loss**
- ⚠️ High average edge (75%) is misleading due to:
  - No position-size weighting
  - Averaging positive % ROIs from small wins with large absolute losses from SHORTs

The user is correct that something is wrong - but it's not missing unrealized losses. The issue is:
1. Bad SHORT trading performance (likely holding losing positions too long)
2. Misleading edge metric that doesn't reflect actual profitability
3. Possible data quality issue in SHORT PnL calculation (ROI mismatch between tables)

**Next Step**: Review FIFO v4 SHORT calculation logic and compare with wio_positions_v2.
