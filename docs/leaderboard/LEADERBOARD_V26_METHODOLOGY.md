# Leaderboard v26 v2 Methodology

**Date:** February 6, 2026
**Output:** `exports/leaderboard-v26-v2.csv` (2,240 wallets)
**Source data:** `pm_trade_fifo_roi_v3_mat_unified` via ClickHouse temp tables

---

## Overview

Leaderboard v26 identifies the best Polymarket traders for copy trading purposes. Starting from ~200K active wallets, we apply a 10-step filter funnel that narrows to 2,240 wallets with proven, profitable edge.

This is v2 of the methodology. v1 had critical bugs in SHORT position handling that corrupted ROI and bet size calculations, allowing losing wallets to rank highly and excluding genuinely profitable traders.

---

## Critical Discovery: SHORT Position ROI Bug

### The Problem

The unified table (`pm_trade_fifo_roi_v3_mat_unified`) stores `cost_usd` as **negative** for SHORT positions (you receive USDC when selling tokens). This caused three cascading failures:

1. **ROI = 0 for all shorts**: The unified table calculates `roi = pnl_usd / cost_usd`. When `cost_usd` is negative, the division produces a nonsensical result, so the FIFO pipeline defaults to `roi = 0`. This affected **10.1M order-level trades** and **9.4M position-level trades** (34.2M raw fills, 11.5% of the table).

2. **Negative median bet**: `median(cost_usd)` could be negative for wallets with significant short activity. 41% of position-level rows had negative cost. One wallet (`0x90a50a...`) showed `median_bet = -$2.70` despite $42K in lifetime PnL.

3. **Distorted Robust EV**: With shorts at `roi = 0`, the median win ROI was systematically dragged down, causing profitable wallets to fail the filters. v1 exported only 790 wallets; v2 correctly identifies 2,240.

### Scale of Impact

| Metric | Before Fix | After Fix |
|--------|-----------|-----------|
| Short positions with roi = 0 | 10,110,167 | 13,364 (near-zero bet only) |
| Short positions with meaningful roi | 118,228 | 10,308,705 |
| Positions with negative bet_usd | 9,417,753 | 0 |
| Wallets in final export | 790 | 2,240 |

### How Polymarket Actually Calculates PnL

We studied Polymarket's [pnl-subgraph source code](https://github.com/Polymarket/polymarket-subgraph/blob/f5a074a5/pnl-subgraph/src/utils/updateUserPositionWithSell.ts):

```
Buy:  avgPrice = (avgPrice * currentAmount + buyPrice * buyAmount) / (currentAmount + buyAmount)
Sell: realizedPnl += sellAmount * (sellPrice - avgPrice) / COLLATERAL_SCALE
```

Key takeaways:
- Polymarket uses **weighted average cost basis** (not FIFO)
- There is no concept of "shorts" — you buy outcome tokens (go long) or sell tokens you hold
- PnL is always relative to average buy price: `(sellPrice - avgPrice) / avgPrice`
- External tokens (from splits/merges) are capped at position size to prevent phantom PnL

What we call `is_short = 1` positions are tokens obtained through CTF splits/merges/NegRisk conversions and then sold on the CLOB. The negative `cost_usd` reflects money received from selling.

### The Fix

| Field | v1 (Broken) | v2 (Fixed) |
|-------|-------------|------------|
| `bet_usd` | `cost_usd` (negative for shorts) | `abs(cost_usd)` (always positive) |
| `roi` | `pnl_usd / cost_usd` (0 for shorts) | `pnl_usd / abs(cost_usd)` (meaningful for all) |
| Median win ROI | All positions (shorts = 0 or 100%) | **Longs only** (measures buy-price edge) |
| ROI cap | None (penny bets = 30,000%+) | **Capped at 10x (1000%)** |
| Loss ROI floor | None | **Floored at -1.0 (-100%)** |

---

## Second Discovery: Binary Market ROI Distortion

### Winning Shorts Always = 100% ROI

In binary markets, when a short wins (the token goes to $0), the ROI is always exactly 100%: you sold tokens for $X, they became worthless, you keep $X, ROI = $X / $X = 100%.

We found **4,833,206 winning short positions** with exactly 100% ROI. When included in the median win ROI calculation, this pulls nearly every wallet's median to ~100%, making the filter meaningless (62K of 64K wallets passed).

### Penny Bet ROI Explosion

In binary markets, buying tokens at $0.003 that resolve to $1.00 gives 33,233% ROI. Even with position-level aggregation, the top wallets by Robust EV had median win ROIs of 31,490% — from a handful of cheap lottery tickets, not consistent edge.

### The Fix: Longs-Only Capped ROI for Robust EV

```
Robust EV = (WinRate_all × MedianWinROI_longs_capped) + (LossRate_all × MedianLossROI_longs_floored)
```

- **Win rate**: Counts both longs and shorts (your overall prediction accuracy)
- **Median win ROI**: Longs only, capped at 10x (measures buy-price edge, not lottery luck)
- **Median loss ROI**: Longs only, floored at -1.0 (binary markets = 100% loss when wrong)
- **Score**: `Robust EV × sqrt(Positions per Active Day)`

### New Metric: Expectancy

We added **expectancy** as the primary ranking metric, better suited for copy trading:

```
Expectancy = Total PnL / Total Volume
```

This directly answers: "For every $1 I invest copying this wallet, how much do I make?" A wallet with 87% expectancy means $1 invested returns $1.87. Unlike Robust EV (which can be gamed by penny bets), expectancy is size-weighted by nature.

---

## Filter Funnel

### Pre-filters (Fill-Level, Fast)

| Step | Filter | Wallets | Source |
|------|--------|---------|--------|
| 1 | Active in last 7 days | 199,704 | `pm_trade_fifo_roi_v3_mat_unified` |
| 2 | >15 settled markets | 98,263 | Same |
| 3 | Wallet age >5 days | 97,869 | Same |
| 4 | Fill-level median win ROI >5% | 74,367 | Same |

### Position-Level Aggregation

74,367 wallets aggregated from 105.9M order-level trades into 22.7M position-level trades:

```sql
GROUP BY wallet, condition_id, outcome_index
```

Position-level collapses all orders in the same market position into one unit. This prevents market makers from gaming metrics by splitting into many small orders.

**Fixed ROI calculation:**
```sql
bet_usd = abs(sum(cost_usd))
roi = CASE WHEN abs(sum(cost_usd)) > 0.01 THEN sum(pnl_usd) / abs(sum(cost_usd)) ELSE 0 END
```

### Position-Level Filters

| Step | Filter | Wallets | Drop |
|------|--------|---------|------|
| 6 | Position win rate >30% | 64,361 | -10K |
| 7 | Median win ROI >10% (longs only, capped 10x) | 37,240 | -27K |
| 8 | Median bet >$5 (abs value) | 24,769 | -12K |
| 9 | Robust EV lifetime >0 AND PnL >0 | 2,780 | -22K |
| 10 | Cutoff dates for 14ad/30ad windows | 2,780 | - |
| 11 | Robust EV 14ad >0 | **2,240** | -540 |

### Key Filter Definitions

- **Settled position**: `resolved_at > '1970-01-01' OR is_closed = 1` (resolved markets or fully-sold positions)
- **Win**: `pnl_usd > 0` on a settled position
- **Median win ROI**: `medianIf(least(roi, 10.0), pnl > 0 AND is_short = 0 AND settled)` — longs only, capped at 10x
- **Median loss ROI**: `medianIf(greatest(roi, -1.0), pnl <= 0 AND is_short = 0 AND settled)` — longs only, floored at -100%
- **14 active days**: Last 14 calendar days on which the wallet entered a position
- **30 active days**: Last 30 calendar days on which the wallet entered a position

---

## ClickHouse Temp Tables

All intermediate results stored as persistent temp tables for reproducibility:

| Table | Engine | Rows | Description |
|-------|--------|------|-------------|
| `lb26_step1_active7d` | Memory | 199,704 | Active last 7 days |
| `lb26_step2_15markets` | Memory | 98,263 | >15 settled markets |
| `lb26_step3_age5d` | Memory | 97,869 | Wallet age >5 days |
| `lb26_step4_mwr5pct` | Memory | 74,367 | Fill-level median win ROI >5% |
| `lb26_step5_orders` | MergeTree | 105.9M | Order-level deduped trades |
| `lb26_step5b_positions_v2` | MergeTree | 22.7M | Position-level trades (fixed ROI) |
| `lb26_step6b_v2` | Memory | 64,361 | WR >30% |
| `lb26_step7b_v2` | Memory | 37,240 | Median win ROI >10% (longs, capped) |
| `lb26_step8b_v2` | Memory | 24,769 | Median bet >$5 |
| `lb26_step9b_v2` | Memory | 2,780 | Robust EV >0 + PnL >0 |
| `lb26_step10b_v2` | Memory | 2,780 | 14ad/30ad cutoff dates |
| `lb26_step11b_v2` | Memory | 2,240 | Robust EV 14ad >0 |

Memory tables expire when ClickHouse restarts. MergeTree tables persist.

---

## Export Schema

The CSV at `exports/leaderboard-v26-v2.csv` contains 50 columns:

### Position-Level Lifetime (Primary)
| Column | Description |
|--------|-------------|
| `wallet` | Ethereum address |
| `pos_trades` | Settled positions (1 per wallet × condition × outcome) |
| `pos_markets` | Distinct conditions traded |
| `pos_wins` / `pos_losses` | Positions with positive / non-positive PnL |
| `pos_wr_pct` | Win rate (all positions, both longs and shorts) |
| `pos_volume` | Total bet volume (`sum(abs(cost_usd))`) |
| `pos_pnl` | Total realized PnL on settled positions |
| `pos_med_bet` | Median position size (`median(abs(cost_usd))`) |
| `pos_med_win_roi_pct` | Median ROI on winning long positions (capped 1000%) |
| `pos_med_loss_roi_pct` | Median ROI on losing long positions (floored -100%) |
| `pos_active_days` | Distinct calendar days with position entries |
| `pos_trades_per_day` | Positions / active days |
| `pos_robust_ev_pct` | `WR × MWR_long_capped + (1-WR) × MLR_long_floored` |
| `pos_score` | `Robust EV × sqrt(positions / active_days)` |
| `pos_expectancy_pct` | `PnL / Volume × 100` (primary ranking metric) |
| `pos_short_pct` | Percentage of positions that are shorts |

### Order-Level Lifetime (Copy Trading Context)
| Column | Description |
|--------|-------------|
| `ord_trades` | Order-level trade count (higher than positions due to order splitting) |
| `ord_markets` | Distinct conditions at order level |
| `ord_wins` / `ord_losses` | Orders with positive / non-positive PnL |
| `ord_wr_pct` | Win rate at order level |
| `ord_volume` / `ord_pnl` | Volume and PnL at order level |
| `ord_med_bet` | Median order size |
| `ord_active_days` / `ord_trades_per_day` | Activity metrics |
| `ord_expectancy_pct` | Order-level PnL / Volume |

### Time Windows (30 Active Days / 14 Active Days)
Same metrics as lifetime but computed only on positions entered during the most recent 30 or 14 active days. Used for recency filtering.

---

## Validation: Previously Problematic Wallets

| Wallet | Issue | v1 Status | v2 Status | Correct? |
|--------|-------|-----------|-----------|----------|
| `0xd95cc35d...` | -$1,982 PnL, big loser | Included (high Robust EV) | **Excluded** | Yes |
| `0xd4d63cf2...` | -$16 PnL, 7 trades | Included (#3 rank!) | **Excluded** | Yes |
| `0x2e57351b...` | -$20 PnL, 4 trades | Included (#2 rank!) | **Excluded** | Yes |
| `0xc764860c...` | -$330 PnL, 76% WR | Included | **Excluded** | Yes |
| `0x1b02f620...` | -$56 PnL, 67% WR | Included | **Excluded** | Yes |
| `0xf94fe179...` | +$28K PnL, 88% WR | **Excluded** (1% MWR) | Included (#12) | Yes |
| `0x90a50adc...` | +$42K PnL, 71% WR | **Excluded** (neg bet) | Included | Yes |
| `0x30b16068...` | +$34 settled / -$332 PM | Included | Included (low rank) | Acceptable* |

*`0x30b1` has positive settled PnL but negative on Polymarket due to unrealized losses on open positions. This is a known limitation — the FIFO V5 sell tracking fix (planned) will address unrealized position tracking.

---

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/export-leaderboard-v26.ts` | v1 order-level export (superseded) |
| `scripts/export-leaderboard-v26-final.ts` | v1 from temp tables (superseded) |
| `scripts/export-leaderboard-v26-dual.ts` | v1 dual position+order export (superseded) |
| `scripts/rebuild_positions_v2.ts` | Rebuild position table with fixed ROI (batched) |
| `scripts/export-leaderboard-v26-v2.ts` | **Current: v2 export with all fixes** |

---

## Known Limitations

1. **Unrealized PnL not tracked**: Wallets with positive settled PnL but large unrealized losses still appear. The FIFO V5 sell tracking fix will address this.

2. **SHORT position definition**: Our `is_short = 1` flags positions entered via token sells (from splits/merges/NegRisk). This is a data artifact, not a trading strategy classification.

3. **Memory tables expire**: Steps 1-4 and 6-11 use ClickHouse Memory engine tables that don't survive restarts. Only the MergeTree tables (step5_orders, step5b_positions_v2) persist.

4. **ROI cap is arbitrary**: The 10x (1000%) cap prevents penny-bet distortion but also clips genuinely high-ROI positions. A value between 5x and 20x would produce similar results.

5. **Market count filter**: Uses `> 15` (strictly greater than). Wallets with exactly 15 settled markets are excluded.
