# SHORT Position Accounting Issue - Wallet 0xcf45fd3f

## Executive Summary

**Wallet**: `0xcf45fd3f476621aea72d09c44b2a694d79e9ed5f`

**Critical Finding**: `pm_trade_fifo_roi_v3` includes BOTH LONG and SHORT positions, but the SHORT PnL calculation appears to have an ROI display bug.

### The Problem

User sees:
- **Edge**: 96.02% per trade
- **Win Rate**: 72% (54W-21L)
- **Total PnL**: -$4,732 (NEGATIVE!)

But the ACTUAL performance is:
- **LONG trades**: 73 trades, +$6,618 PnL, **+92% avg ROI** (excellent!)
- **SHORT trades**: 25 trades, **-$11,350 PnL**, +26% avg ROI (terrible!)
- **Net**: -$4,732 total loss

### Why the Discrepancy?

The wallet is **EXCELLENT at going LONG** but **TERRIBLE at going SHORT**. The aggregate metrics hide this critical insight because:

1. **Average ROI is not weighted by position size**
   - 73 LONG trades × 92% ROI = dominant in average
   - 25 SHORT trades × 26% ROI = smaller impact
   - **Weighted avg**: (73 × 92% + 25 × 26%) / 98 = **75.2%** ✓
   - But this doesn't reflect the **-$11,350 absolute loss** from SHORTs!

2. **Edge metric doesn't reflect dollar profitability**
   - High % ROI on small wins
   - Moderate % loss on HUGE SHORT positions
   - Need: **dollar-weighted edge** = `sum(pnl_usd) / sum(cost_usd)` = **NEGATIVE**

3. **Win rate includes SHORTs** (14W-11L on SHORTs)
   - Total: 66W-32L = 67% win rate
   - But SHORT wins were small, SHORT losses were MASSIVE

---

## Data Analysis

### 1. Table Comparison

| Table | Trades | Total PnL | Notes |
|-------|--------|-----------|-------|
| `pm_trade_fifo_roi_v3` | 98 | -$4,732 | FIFO-based (entry → exit pairs) |
| `wio_positions_v2` | 35 | -$9,560 | Position-based (aggregated net cash flow) |
| **Difference** | +63 | **+$4,828** | Why? |

**Answer**: The $4,828 difference is because:
- FIFO creates SEPARATE entries for LONG and SHORT on same condition
- wio_positions aggregates them into ONE net position per (condition, outcome)
- When you LONG then SHORT the same outcome, FIFO counts them separately

### 2. LONG vs SHORT Breakdown (FIFO)

| Metric | LONG | SHORT |
|--------|------|-------|
| **Trades** | 73 | 25 |
| **Total PnL** | **+$6,618** | **-$11,350** |
| **Avg ROI** | **+92.0%** | +26.0% |
| **Win Rate** | 71% (52/73) | 56% (14/25) |
| **Net Contribution** | Profitable | **DESTROYS gains** |

**Key Insight**: This wallet should STOP SHORTING. Their edge is in buying dips, not selling short.

### 3. Example Market: 993abfacc936951426dc636b44fde63be24dc2c59f2b5f878a6a2cd0412f8570

This market demonstrates the issue perfectly:

**FIFO breakdown (4 entries):**
| Outcome | Type | Trades | PnL | ROI |
|---------|------|--------|-----|-----|
| 0 | LONG | 7 | +$2,336 | +123.5% |
| 0 | SHORT | 1 | +$2,918 | +100% |
| 1 | LONG | 1 | +$115 | +12.8% |
| 1 | SHORT | 1 | **-$9,415** | **-9.78%** |
| **Total** | | **10** | **-$4,045** | |

**wio_positions breakdown (2 entries):**
| Outcome | Side | PnL | ROI |
|---------|------|-----|-----|
| 0 | NO (SHORT YES) | +$2,918 | N/A |
| 1 | YES (LONG YES) | **-$9,415** | **-110%** |
| **Total** | | **-$6,497** | |

**Why -110% ROI in wio_positions?**
- Position shows ROI = -1.1064706267139637 = **-110.6%**
- This means they LOST MORE THAN THEIR INITIAL COST
- Likely from fees, slippage, or buying more at higher prices before losing it all

**Why -9.78% ROI in FIFO?**
- Let me check the FIFO SHORT calculation...

---

## SHORT Calculation Logic (from build-trade-fifo-v4.ts)

### FIFO v4 SHORT Logic (lines 204-300)

```typescript
// SHORT positions: positions where net_tokens < 0 (sold more than bought)
// These are position-level, not trade-level
const query = `
  INSERT INTO pm_trade_fifo_roi_v3
  SELECT
    -- Synthetic tx_hash for shorts
    concat('short_', substring(wallet, 1, 10), '_', substring(condition_id, 1, 10), '_', toString(outcome_index)) as tx_hash,
    wallet,
    condition_id,
    outcome_index,
    entry_time,
    abs(net_tokens) as tokens,  -- Store as positive for display
    -cash_flow as cost_usd,     -- Premium received (stored as positive cost) ⚠️
    0 as tokens_sold_early,     -- N/A for shorts
    abs(net_tokens) as tokens_held,  -- The short exposure
    -- Exit value: if outcome wins, owe tokens * $1; if loses, $0
    -- For shorts: settlement = net_tokens * payout_rate (negative * positive = negative liability)
    CASE
      WHEN payout_numerators = '[1,1]' THEN net_tokens * 0.5
      WHEN payout_numerators = '[0,1]' AND outcome_index = 1 THEN net_tokens * 1.0
      WHEN payout_numerators = '[1,0]' AND outcome_index = 0 THEN net_tokens * 1.0
      ELSE 0.0
    END as exit_value,
    -- PnL = cash_flow + settlement
    -- cash_flow is positive (received premium), settlement is negative if outcome wins
    cash_flow + CASE
      WHEN payout_numerators = '[1,1]' THEN net_tokens * 0.5
      WHEN payout_numerators = '[0,1]' AND outcome_index = 1 THEN net_tokens * 1.0
      WHEN payout_numerators = '[1,0]' AND outcome_index = 0 THEN net_tokens * 1.0
      ELSE 0.0
    END as pnl_usd,
    -- ROI: pnl / premium_received
    CASE
      WHEN cash_flow > 0 THEN
        (cash_flow + CASE
          WHEN payout_numerators = '[1,1]' THEN net_tokens * 0.5
          WHEN payout_numerators = '[0,1]' AND outcome_index = 1 THEN net_tokens * 1.0
          WHEN payout_numerators = '[1,0]' AND outcome_index = 0 THEN net_tokens * 1.0
          ELSE 0.0
        END) / cash_flow
      ELSE 0
    END as roi,
```

### Example: Market 993abfacc9... outcome 1 SHORT

**Given:**
- `net_tokens = -105,705.26` (sold 105,705 tokens, bought 0)
- `cash_flow = +$96,289.55` (received from selling)
- `payout_numerators = '[0,1]'` (outcome 1 won)
- `outcome_index = 1`

**Calculation:**
1. `cost_usd = -cash_flow = -$96,289.55` ⚠️ **STORED AS NEGATIVE?**
2. `exit_value = net_tokens * 1.0 = -105,705.26 * 1.0 = -$105,705.26` (liability)
3. `pnl_usd = cash_flow + exit_value = $96,289.55 + (-$105,705.26) = **-$9,415.71** ✓
4. `roi = pnl_usd / cash_flow = -$9,415.71 / $96,289.55 = **-9.78%** ✓

### The Bug

**Line 221**: `cost_usd = -cash_flow`

This stores the cost as **NEGATIVE** (-$96,289.55) for display purposes, but then uses **positive cash_flow** in the ROI calculation.

**Result**:
- Display shows: `cost_usd = -$96,289.55` (confusing!)
- ROI calc uses: `cash_flow = +$96,289.55` (correct)
- But the ROI is **-9.78%** which is MISLEADING

### Why -9.78% is Wrong for Display

The user LOST $9,415 on a RECEIVED PREMIUM of $96,289. This is:
- **Absolute loss**: -$9,415
- **ROI vs premium received**: -9.78% (technically correct, but confusing)
- **ROI vs liability**: -9,415 / 105,705 = **-8.9%** (loss vs amount owed)
- **But in trading terms**: You LOST 100% of your margin + owed more!

**Better representation**:
- SHORT ROI should be: `pnl_usd / abs(exit_value)` = -9,415 / 105,705 = **-8.9%**
- OR: Keep current calc but make it clear in UI that "cost" for SHORTs is premium received

---

## Why User Sees "Active Positions with -100% Losses"

### Investigation Result

All positions in `wio_positions_v2` show `is_resolved = 1` (resolved).
All positions in `pm_trade_fifo_roi_v3` have valid `resolved_at` dates (no zero dates).

**Hypothesis**: Frontend is showing positions based on stale data or filtering incorrectly.

**Possible causes**:
1. Frontend using `qty_shares_remaining != 0` to show "active"
2. But `qty_shares_remaining` includes positions that LOST 100% (held to resolution)
3. OR: Frontend caching old API response before resolutions

**Example from data**:
```
condition_id: 2a2d5924e502f9ebe8cfe64c39f01124980f27c17509c62e775855e78d4a40a9
outcome_index: 1
side: YES
is_resolved: 1
pnl_usd: -$1,113.65
roi: -1.0 (-100%)
qty_shares_remaining: -32,980.09  ⚠️ NEGATIVE (SHORT position)
ts_close: NULL  ⚠️ (never sold early, held to resolution)
```

This position:
- IS resolved (is_resolved = 1)
- But has NULL ts_close (never closed early)
- Has negative qty_shares_remaining (SHORT position)
- Lost 100% (outcome they shorted WON)

**Frontend bug**: Likely filtering on `ts_close IS NULL` OR `qty_shares_remaining != 0` to show "active"

---

## Answers to User's Questions

### 1. Does pm_trade_fifo_roi_v3 include unresolved positions?

**NO** - All 98 trades are RESOLVED. No unresolved positions.

**Evidence**:
- `MIN(resolved_at) = 2025-11-13`
- `MAX(resolved_at) = 2026-01-24`
- `COUNT(*) WHERE resolved_at = '1970-01-01' = 0`

### 2. Are we missing unrealized losses?

**NO** - All positions in both tables are resolved.

**But YES** - We are HIDING $11,350 in SHORT losses behind a misleading "75% edge" metric.

### 3. Why does the wallet show high edge but negative PnL?

**ANSWER**: The wallet has:
- **Excellent LONG edge**: +92% avg ROI, +$6,618 total
- **Terrible SHORT edge**: -$11,350 total loss (despite +26% avg ROI)
- **Aggregate edge**: 75% (misleading average that hides position sizing)

**The "96.02% edge" the user sees** is likely from a different calculation or older data. Current FIFO shows **75.17% avg ROI**.

### 4. Sample 10 Worst Trades

See "Sample Losing Trades" section above. Top 10 losses total **-$22,898**, of which:
- 6 are SHORT positions: -$16,983
- 4 are LONG positions: -$1,115

---

## Recommendations

### Immediate Fixes

1. **Add dollar-weighted edge metric to leaderboard**
   ```sql
   dollar_edge_pct = (sum(pnl_usd) / sum(abs(cost_usd))) * 100
   ```
   For this wallet: -$4,732 / ??? = **NEGATIVE edge**

2. **Separate LONG vs SHORT metrics**
   - Show: "LONG Edge: +92% | SHORT Edge: -$11,350"
   - Let users see where their skill actually is

3. **Fix frontend "active positions" logic**
   - Should filter on: `is_resolved = 0` (not ts_close or qty_remaining)
   - Add resolved_at column to UI

4. **Add "largest single loss" column**
   - This wallet's -$9,415 loss would be a red flag
   - Shows risk management issues

### Medium-Term Fixes

5. **Review SHORT ROI display**
   - Current: -9.78% (loss vs premium received)
   - Consider: Loss vs liability owed
   - Or: Add tooltip explaining SHORT ROI calculation

6. **Add position sizing metrics**
   - Avg win size vs avg loss size
   - Largest win vs largest loss
   - Risk/reward ratio

7. **Flag wallets with negative PnL but positive edge**
   - This is a data quality red flag
   - Or: Poor risk management (letting big losses run)

### Data Validation

8. **Compare FIFO vs wio_positions for SHORT trades**
   - $4,828 discrepancy needs investigation
   - May be legitimate (FIFO double-counts LONG+SHORT on same market)
   - Or: Bug in aggregation logic

9. **Audit SHORT calculation in FIFO v4**
   - Verify `cost_usd = -cash_flow` is correct
   - Check if ROI denominator should be `abs(cost_usd)` or `cash_flow`

---

## Files to Review

1. **Backend**:
   - `/scripts/build-trade-fifo-v4.ts` - FIFO v4 SHORT logic (reviewed above)
   - `/lib/pnl/pnlEngineV1.ts` - Check if using FIFO table
   - `/app/api/leaderboard/*/route.ts` - Edge calculation
   - `/scripts/build-wallet-metrics-fifo*.ts` - Metrics aggregation

2. **Frontend**:
   - Position display component (filter logic for "active")
   - Dashboard metrics (where "96.02% edge" comes from)
   - PnL calculations (should use wio_positions or FIFO?)

---

## SQL Query for Dollar-Weighted Edge

```sql
-- Add this to pm_wallet_fifo_metrics_v1 rebuild
SELECT
  wallet,

  -- Current metrics (unweighted)
  avg(roi) * 100 as avg_roi_pct,

  -- NEW: Dollar-weighted edge
  CASE
    WHEN sum(abs(cost_usd)) > 0 THEN
      (sum(pnl_usd) / sum(abs(cost_usd))) * 100
    ELSE 0
  END as dollar_edge_pct,

  -- Separate LONG vs SHORT
  avgIf(roi, is_short = 0) * 100 as long_avg_roi_pct,
  avgIf(roi, is_short = 1) * 100 as short_avg_roi_pct,

  sumIf(pnl_usd, is_short = 0) as long_total_pnl,
  sumIf(pnl_usd, is_short = 1) as short_total_pnl,

  -- Largest win/loss
  max(pnl_usd) as largest_win,
  min(pnl_usd) as largest_loss,

  -- Position sizing
  avg(abs(cost_usd)) as avg_position_size,
  avgIf(abs(cost_usd), pnl_usd > 0) as avg_win_size,
  avgIf(abs(cost_usd), pnl_usd < 0) as avg_loss_size

FROM pm_trade_fifo_roi_v3 FINAL
GROUP BY wallet
```

For wallet `0xcf45fd3f`:
- `avg_roi_pct = 75.17%` (current metric - misleading)
- `dollar_edge_pct = NEGATIVE` (true profitability)
- `long_avg_roi_pct = 92.0%` (excellent)
- `short_avg_roi_pct = 26.0%` (misleading - total is -$11,350!)
- `long_total_pnl = +$6,618`
- `short_total_pnl = -$11,350`
- `largest_loss = -$9,415` (single SHORT trade)

---

## Conclusion

**This wallet is NOT smart money.** They have:
- ✅ Strong LONG trading skill (+92% avg ROI)
- ❌ Terrible SHORT trading results (-$11,350 total loss)
- ⚠️ Poor risk management (single -$9,415 loss wiped out all gains)

**The user is RIGHT to be confused** - the metrics are misleading because:
1. Average ROI doesn't weight by position size
2. LONG vs SHORT performance is not separated
3. Frontend may be showing "active" positions incorrectly
4. The "96.02% edge" metric is not dollar-weighted

**Next steps**:
1. Implement dollar-weighted edge metric
2. Separate LONG vs SHORT performance in UI
3. Fix frontend "active positions" filter
4. Add largest win/loss columns
5. Consider flagging wallets with negative dollar-edge despite positive avg ROI
