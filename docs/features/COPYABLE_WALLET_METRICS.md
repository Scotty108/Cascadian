# Copyable Wallet Metrics & Filters

## Problem Statement

Not all profitable wallets are suitable for copy trading. Some strategies (split arbitrage, delta-neutral market making) cannot be replicated because:
1. They rely on CTF operations (Splits/Merges), not CLOB orders
2. Their edge comes from execution speed and timing
3. By the time you see their trade, the opportunity is gone

## Key Metrics

### 1. Split+Merge Ratio (Primary Filter)
```
split_merge_ratio = (PositionSplit + PositionsMerge) / CLOB_trades
```
- **Threshold:** < 0.20 (20%)
- **Why:** High ratio indicates arbitrage/MM strategy, not directional betting
- **Data Sources:** `pm_ctf_events`, `pm_trader_events_v2`

| Ratio | Interpretation |
|-------|----------------|
| < 10% | Pure CLOB trader - highly copyable |
| 10-20% | Mostly CLOB with occasional CTF - copyable |
| 20-50% | Mixed strategy - use caution |
| > 50% | Arbitrage/MM dominant - NOT copyable |

### 2. Merge-to-Split Ratio (Delta Neutral Detector)
```
merge_split_ratio = PositionsMerge / PositionSplit
```
- **Threshold:** < 0.50 (50%)
- **Why:** High ratio means they're splitting then merging back (delta neutral)
- **Pattern:** Split → Hold both sides → Merge = guaranteed breakeven

| Ratio | Interpretation |
|-------|----------------|
| < 20% | One-directional splits (might sell one side) |
| 20-50% | Some hedging activity |
| > 50% | Delta neutral cycling - NOT copyable |
| ~100% | Pure market making - NOT copyable |

### 3. Copyability Score (Combined)
```sql
copyable_score = 100 - LEAST(100,
  split_merge_ratio * 50 +   -- Penalize split/merge heavy
  merge_split_ratio * 30     -- Extra penalty for delta neutral
)
```
- **Threshold:** >= 70 for "copyable"
- **Range:** 0-100 (higher = more copyable)

### 4. Win Rate (Quality Filter)
```
win_rate = winning_positions / total_resolved_positions
```
- **Threshold:** >= 0.45 (45%)
- **Why:** Filters out random gamblers and losing bots

### 5. Average Return per Trade (Alpha Metric)
```
avg_return_pct = (realized_pnl / volume_traded) * 100
```
- **Threshold:** >= 2%
- **Why:** Measures actual edge per dollar traded

### 6. Portfolio Growth (Consistency)
```
roi = realized_pnl / total_invested
```
- **Threshold:** >= 5% all-time
- **Why:** Confirms sustained profitability

## SQL Implementation

```sql
WITH
-- CLOB activity per wallet
clob_stats AS (
  SELECT
    lower(trader_wallet) as wallet,
    count(DISTINCT event_id) as clob_trades,
    sum(usdc_amount) / 1e6 as volume
  FROM pm_trader_events_v2
  WHERE is_deleted = 0 AND trade_time >= now() - INTERVAL 60 DAY
  GROUP BY wallet
  HAVING clob_trades >= 50 AND volume >= 500
),

-- CTF activity per wallet
ctf_stats AS (
  SELECT
    lower(user_address) as wallet,
    countIf(event_type = 'PositionSplit') as splits,
    countIf(event_type = 'PositionsMerge') as merges
  FROM pm_ctf_events
  WHERE block_timestamp >= now() - INTERVAL 60 DAY
  GROUP BY wallet
),

-- Combined metrics
wallet_metrics AS (
  SELECT
    c.wallet,
    c.clob_trades,
    c.volume,
    coalesce(t.splits, 0) as splits,
    coalesce(t.merges, 0) as merges,
    -- Key ratios
    (coalesce(t.splits, 0) + coalesce(t.merges, 0)) / c.clob_trades as split_merge_ratio,
    CASE WHEN coalesce(t.splits, 0) > 0
         THEN coalesce(t.merges, 0) / t.splits
         ELSE 0 END as merge_split_ratio
  FROM clob_stats c
  LEFT JOIN ctf_stats t ON c.wallet = t.wallet
)

SELECT
  wallet,
  clob_trades,
  volume,
  splits,
  merges,
  round(split_merge_ratio * 100, 1) as split_merge_pct,
  round(merge_split_ratio * 100, 1) as merge_split_pct,
  -- Copyability score
  round(100 - LEAST(100, split_merge_ratio * 50 + merge_split_ratio * 30), 0) as copyable_score
FROM wallet_metrics
WHERE split_merge_ratio < 0.20  -- Primary filter
  AND merge_split_ratio < 0.50  -- Delta neutral filter
ORDER BY volume DESC
LIMIT 100
```

## Visual Pattern Recognition

### NOT Copyable - Split Arbitrage
```
Activity Pattern:
  Split → Sell (favorite) → Hold (underdog) → Redeem

UI Shows:
  - Entry prices at exactly 50¢
  - Immediate sells after splits
  - One-sided holdings after sell
```

### NOT Copyable - Delta Neutral
```
Activity Pattern:
  Split → Hold Both → Merge (or Redeem both)

UI Shows:
  - Holding BOTH Yes and No of same market
  - 15-min crypto markets (BTC/ETH up/down)
  - Merge/Split pairs in activity
```

### COPYABLE - Directional Trader
```
Activity Pattern:
  Buy → Hold → Sell/Redeem

UI Shows:
  - Varied entry prices (not clustered at 50¢)
  - Single-side positions per market
  - Buy/Sell on CLOB, occasional redemptions
```

## Integration with Leaderboard

Update `pm_wallet_pnl_leaderboard_cache` schema to include:
```sql
ALTER TABLE pm_wallet_pnl_leaderboard_cache
  ADD COLUMN IF NOT EXISTS split_count UInt32,
  ADD COLUMN IF NOT EXISTS merge_count UInt32,
  ADD COLUMN IF NOT EXISTS copyable_score Float32
```

Filter query for display:
```sql
SELECT * FROM pm_wallet_pnl_leaderboard_cache
WHERE copyable_score >= 70
  AND win_rate >= 0.45
  AND avg_return_pct >= 0.02
ORDER BY avg_return_pct DESC
```

## Validation Results

| Wallet | Strategy | Splits | Merges | Copyable Score | Verdict |
|--------|----------|--------|--------|----------------|---------|
| 0x2e4c... | Split Arb | 68 | 0 | 60 | ⚠️ MAYBE |
| 0x4a58... | Delta Neutral | 4807 | 4063 | 32 | ❌ NO |
| 0x204f... | Directional | 0 | 0 | 100 | ✅ YES |
| 0x4ffe... | Directional | 0 | 312 | 100 | ✅ YES |
