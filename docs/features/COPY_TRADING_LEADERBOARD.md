# Copy Trading Leaderboard - Robust Wallet Discovery

**Discovery Date:** January 19, 2026
**Status:** Production Ready
**Data Source:** `pm_trade_fifo_roi_v3` (FIFO trade-level PnL with shorts)

## Executive Summary

We built a copy trading leaderboard that identifies **robust asymmetric winners** - wallets that would generate high returns if you copy-traded them with $1 per trade, even after removing their best 3 trades (to filter out lottery winners).

**Key Output:** `data/copy-trading-robust-wallets.json`

---

## The Problem We Solved

### Initial Approach (Flawed)
We first ranked wallets by **average ROI** - this was completely misleading.

**Example:** Wallet `0x17a55b84...` showed 1,355% average ROI but:
- Two tiny trades ($25 each) had 58,406% and 18,136% ROI
- These two trades = 76,542% combined ROI
- The other 55 trades = basically breakeven
- **Median ROI was -0.3%** (half the trades lose money!)

### Second Approach (Better but still flawed)
We switched to **median ROI** - this is outlier-resistant but doesn't tell the whole story for equal-weight copy trading.

### Final Approach (Robust)
We rank by **Simulated ROI WITHOUT Top 3 Trades**:
1. Calculate what your ROI would be if you bet $1 on every trade
2. Remove the wallet's 3 best trades
3. Re-calculate the simulated ROI
4. This reveals wallets with **repeatable** asymmetric returns, not one-hit wonders

---

## Key Metrics

| Metric | Description |
|--------|-------------|
| `sim_roi_without_top3` | **PRIMARY RANKING** - Simulated ROI % excluding best 3 trades |
| `sim_roi_all` | Simulated ROI % including all trades |
| `median_roi_pct` | Median trade ROI - the TYPICAL trade outcome |
| `pct_from_other_trades` | What % of returns come from non-top-3 trades (higher = more robust) |
| `win_rate_pct` | Percentage of trades that were profitable |
| `trades` | Number of trades in last 30 days |
| `pnl_30d` | Actual PnL in USD over last 30 days |

---

## Filters Applied

```sql
WHERE resolved_at >= now() - INTERVAL 30 DAY
  AND abs(cost_usd) > 10              -- Min $10 position
GROUP BY wallet
HAVING count() >= 25                   -- Min 25 trades
  AND max(resolved_at) >= now() - INTERVAL 2 DAY  -- Active recently
  AND count() / days_active < 200      -- Not a bot (<200 trades/day)
  AND win_rate > 40%                   -- Some edge
  AND roi_without_top3 > 0             -- Still profitable without best trades
```

---

## One-Hit Wonders (Excluded)

These wallets looked great but were carried by single massive trades:

| Wallet | Sim ROI All | Sim ROI w/o Top 3 | Best Trade | Why Excluded |
|--------|-------------|-------------------|------------|--------------|
| `0xb58120a8...` | 262% | **17%** | 20,935% | 88% from one trade |
| `0xbb53640d...` | 180% | **39%** | 5,569% | 76% from one trade |
| `0x68d25eb3...` | 426% | **31%** | 96,558% | Carried by outlier |

---

## The Query

```sql
WITH wallet_trades AS (
  SELECT
    wallet,
    pnl_usd / nullIf(abs(cost_usd), 1) as roi,
    pnl_usd,
    abs(cost_usd) as cost,
    is_short,
    resolved_at,
    row_number() OVER (PARTITION BY wallet ORDER BY pnl_usd / nullIf(abs(cost_usd), 1) DESC) as rank_desc
  FROM pm_trade_fifo_roi_v3
  WHERE resolved_at >= now() - INTERVAL 30 DAY
    AND abs(cost_usd) > 10
),
wallet_stats AS (
  SELECT
    wallet,
    count() as trades,
    countIf(pnl_usd > 0) as wins,
    sum(roi) as total_roi,
    sumIf(roi, rank_desc > 3) as roi_without_top3,
    max(roi) * 100 as best_trade_roi_pct,
    median(roi) * 100 as median_roi_pct,
    sum(pnl_usd) as pnl_30d,
    avg(cost) as avg_position,
    countIf(is_short = 1) as short_trades,
    max(resolved_at) as last_trade
  FROM wallet_trades
  GROUP BY wallet
  HAVING trades >= 25
    AND trades - 3 > 0
    AND max(resolved_at) >= now() - INTERVAL 2 DAY
)
SELECT
  wallet,
  round(roi_without_top3 * 100.0 / (trades - 3), 1) as sim_roi_without_top3,
  round(total_roi * 100.0 / trades, 1) as sim_roi_all,
  round(median_roi_pct, 1) as median_roi_pct,
  trades,
  round(wins * 100.0 / trades, 1) as win_rate_pct,
  round(pnl_30d, 0) as pnl_30d,
  round(best_trade_roi_pct, 0) as best_trade_pct,
  round(roi_without_top3 * 100.0 / nullIf(total_roi, 0), 1) as pct_from_other_trades
FROM wallet_stats
WHERE roi_without_top3 > 0
  AND wins * 100.0 / trades > 40
ORDER BY sim_roi_without_top3 DESC
LIMIT 20
```

---

## Elite Copy Trading Wallets (Jan 20, 2026)

**File:** `data/elite-copy-trading-wallets.json`

Top 10 wallets ranked by Simulated ROI % excluding top 3 trades:

| Rank | Wallet | Sim ROI excl Top 3 | Sim ROI All | Trades | WR | PnL 30d |
|------|--------|-------------------|-------------|--------|-----|---------|
| 1 | `0x388af60fb113e7fb01af7a1439d80444c3f5e87c` | **384.1%** | 409% | 56 | 80% | $3K |
| 2 | `0xe9bcaac97f80715ac817b3900ee7ff5b4b71b5e8` | **354.2%** | 412% | 81 | 100% | $51K |
| 3 | `0x97eb7ddf9139a3db0be99e81217e20546e219fbe` | **218.7%** | 257% | 320 | 56% | $23K |
| 4 | `0x48c8ad855f0ed99cb7c615adb36b4302323372a4` | **148.7%** | 159% | 88 | 63% | $4K |
| 5 | `0x7a6192ea6815d3177e978dd3f8c38be5f575af24` | **145.1%** | 219% | 260 | 58% | $61K |
| 6 | `0xbb0bd109b9f0c2a59b8819c466f064cf65ab3790` | **119.3%** | 197% | 136 | 58% | $15K |
| 7 | `0x22292decebf2e9146b27fe59404d162447ea6bf8` | **117.7%** | 137% | 58 | 93% | $22K |
| 8 | `0x581d24e58039e1f569dacde9c288e028b51f2b06` | **109.8%** | 123% | 100 | 75% | $16K |
| 9 | `0x86b32df484bc6cfa72046ae9a62d3737d7b683b6` | **105.6%** | 127% | 101 | 66% | $9K |
| 10 | `0xc869dc3fb7b07ce423abfdb90162832280fe8a6e` | **103.8%** | 140% | 52 | 64% | $6K |

### Elite Query (Jan 20, 2026)

```sql
WITH wallet_trades AS (
  SELECT
    wallet,
    pnl_usd / nullIf(abs(cost_usd), 1) as roi,
    pnl_usd,
    abs(cost_usd) as cost,
    resolved_at,
    row_number() OVER (PARTITION BY wallet ORDER BY pnl_usd / nullIf(abs(cost_usd), 1) DESC) as rank_desc
  FROM pm_trade_fifo_roi_v3
  WHERE resolved_at >= now() - INTERVAL 30 DAY
    AND abs(cost_usd) > 10
)
SELECT
  wallet,
  count() as trades,
  round(sumIf(roi, rank_desc > 3) * 100.0 / (count() - 3), 1) as sim_roi_excl_top3,
  round(sum(roi) * 100.0 / count(), 1) as sim_roi_all,
  round(countIf(pnl_usd > 0) * 100.0 / count(), 1) as win_rate_pct,
  round(avgIf(roi, pnl_usd > 0) * 100, 0) as avg_win_roi,
  round(avgIf(roi, pnl_usd < 0) * 100, 0) as avg_loss_roi,
  round(median(roi) * 100, 1) as median_roi_pct,
  round(sum(pnl_usd), 0) as pnl_30d,
  round(avg(cost), 0) as avg_position,
  dateDiff('hour', max(resolved_at), now()) as hours_ago
FROM wallet_trades
GROUP BY wallet
HAVING count() > 50                                    -- Over 50 trades
  AND max(resolved_at) >= now() - INTERVAL 2 DAY       -- Active in last 2 days
ORDER BY sim_roi_excl_top3 DESC
LIMIT 10
```

---

## Previous Top Wallets (Jan 19, 2026)

| Rank | Wallet | Sim ROI w/o Top 3 | Win Rate | Trades |
|------|--------|-------------------|----------|--------|
| 1 | `0xe9bcaac97f80715ac817b3900ee7ff5b4b71b5e8` | 354% | 100% | 81 |
| 2 | `0x388af60fb113e7fb01af7a1439d80444c3f5e87c` | 341% | 87% | 78 |
| 3 | `0xd812300a10ae807637f8d19f824e67e31d4e2558` | 224% | 85% | 27 |
| 4 | `0x97eb7ddf9139a3db0be99e81217e20546e219fbe` | 219% | 56% | 320 |
| 5 | `0xd49ef2c1a8907a126936880cc567a3c2d6c35110` | 202% | 77% | 30 |

---

## Short Positions

Shorts ARE included in the analysis:
- 2.9M short trades in the dataset
- Top wallets have 1-25% short exposure
- ROI calculation uses `abs(cost_usd)` which handles both longs and shorts correctly
- Shorts can be copied on Polymarket via CLOB

---

## Cron Schedule

The leaderboard is refreshed every 3 hours via Vercel cron:

```
/api/cron/refresh-copy-trading-leaderboard
```

Schedule: `0 */3 * * *` (every 3 hours)

---

## API Endpoint

```
GET /api/copy-trading/leaderboard
```

Returns the current robust wallets leaderboard as JSON.

---

## Files

| File | Description |
|------|-------------|
| `data/elite-copy-trading-wallets.json` | **Top 10 elite wallets (Jan 20, 2026)** |
| `data/copy-trading-robust-wallets.json` | Current leaderboard data |
| `scripts/refresh-copy-trading-leaderboard.ts` | Cron script to refresh |
| `app/api/copy-trading/leaderboard/route.ts` | API endpoint |
| `app/api/cron/refresh-copy-trading-leaderboard/route.ts` | Cron handler |

---

## Future Improvements

1. **Historical tracking** - Store daily snapshots to see wallet consistency over time
2. **Alert system** - Notify when a robust wallet makes a new trade
3. **Decay weighting** - Weight recent trades higher than older ones
4. **Market correlation** - Check if wallets are correlated (all betting same markets)
5. **Position sizing signals** - When robust wallets bet big vs small
