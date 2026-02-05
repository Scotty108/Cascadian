---
name: leaderboard-check
description: Check all leaderboard systems status. Auto-use when user asks about "leaderboard status", "top traders", "copy trading rankings", "smart money cache", "who are the best traders?", "is the leaderboard fresh?", "whale leaderboard", "ultra-active traders".
argument-hint: [leaderboard-type or 'all']
---

# Leaderboard Health Check

Quick status check for all three active leaderboard systems.

## Leaderboard Types

### 1. Copy Trading Leaderboard (Cached)
- **Table**: pm_copy_trading_leaderboard
- **Refresh**: Every 3 hours via cron
- **API**: /api/copy-trading/leaderboard
- **Algorithm**: Top 20 by ROI-without-top-3-trades (filters lottery winners)

### 2. Ultra-Active Leaderboard (Real-Time)
- **Source**: pm_trade_fifo_roi_v3 (direct query)
- **Refresh**: On-demand (no caching)
- **API**: /api/leaderboard/ultra-active
- **Filters**: Last 3 days, >70% win rate, >30% median ROI, >30 trades, >$10k profit

### 3. Whale Leaderboard (Legacy)
- **Table**: whale_leaderboard
- **API**: /api/leaderboard/whale
- **Metric**: Lifetime realized PnL

## Check Queries

### Copy Trading Status
```sql
SELECT
  count() as total_traders,
  min(updated_at) as oldest_entry,
  max(updated_at) as newest_entry,
  round(avg(sim_roi_without_top3), 2) as avg_robust_roi,
  round(avg(win_rate), 2) as avg_win_rate,
  round(sum(total_trades), 0) as total_trades_tracked
FROM pm_copy_trading_leaderboard
```

### Smart Money Cache Status
```sql
SELECT
  category,
  count() as wallets,
  round(avg(total_pnl), 0) as avg_pnl,
  round(avg(win_rate), 2) as avg_win_rate,
  max(updated_at) as latest_update
FROM pm_smart_money_cache
GROUP BY category
ORDER BY wallets DESC
```

### Ultra-Active Quick Test
```sql
SELECT count(DISTINCT wallet) as active_wallets
FROM pm_trade_fifo_roi_v3
WHERE trade_time > now() - INTERVAL 3 DAY
  AND cost_basis_usd >= 10
```

### Whale Leaderboard Status
```sql
SELECT
  count() as total_whales,
  max(updated_at) as latest_update,
  round(max(lifetime_pnl), 0) as top_pnl
FROM whale_leaderboard
```

## Output Format

```
LEADERBOARD STATUS - [timestamp PST]

COPY TRADING (cached, refresh every 3h)
  Traders:     [count] / 20 target
  Last Update: [timestamp] ([X hours ago])
  Avg ROI:     [X]% (robust, without top 3)
  Avg Win Rate: [X]%
  Status:      [FRESH/STALE/EMPTY]

ULTRA-ACTIVE (real-time, on-demand)
  Active Wallets (3d): [count]
  Query Time:          ~3-5 sec
  Status:              [LIVE/DEGRADED]

WHALE (legacy)
  Total Whales: [count]
  Last Update:  [timestamp]
  Top PnL:      $[amount]
  Status:       [FRESH/STALE]

SMART MONEY CACHE (daily 8am UTC)
  Categories:
    TOP_PERFORMERS: [count] wallets
    COPY_WORTHY:    [count] wallets
    SHORT_SPECIALISTS: [count] wallets
    DIRECTIONAL:    [count] wallets
    MIXED:          [count] wallets
  Last Update: [timestamp]
  Status:      [FRESH/STALE]
```
