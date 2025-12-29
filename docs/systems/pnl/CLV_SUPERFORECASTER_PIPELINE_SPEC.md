# CLV Super Forecaster Discovery Pipeline

**Date:** 2025-12-17
**Status:** Specification
**Goal:** Produce high-confidence cohorts of "early edge" traders for copy-trading

---

## Output Cohorts

| Cohort | Size | Filters | Use Case |
|--------|------|---------|----------|
| **top_10k_discovery** | 10,000 | CLV-only, all tiers | Broad discovery |
| **top_1k_tierA** | 1,000 | CLV + quality gates + Tier A | Copy-trade candidates |
| **spotcheck_200** | 200 | Top 1k sample + validation stats | Manual verification |

---

## Key Definitions

### CLV (Closing Line Value) - Post-Entry Drift

**NOT** average return per trade. CLV measures: "Did the market move in your favor after entry?"

```
clv_Xh = (price X hours after entry) - (entry price), side-adjusted
       = if(side='buy', price_Xh - entry_price, entry_price - price_Xh)
```

| Horizon | What It Captures |
|---------|------------------|
| `clv_1h` | Immediate edge (scalper signal) |
| `clv_6h` | Fast edge (intraday forecaster) |
| `clv_24h` | **Primary signal** - standard edge |
| `clv_7d` | Slow edge (thesis trader) |
| `clv_pre_resolve` | Full conviction (held to resolution) |

### Synthetic Realized (from V19s)

Markets effectively resolved even without official payout_numerators:
- Price → 0: synthetic loser
- Price → 1: synthetic winner

Use synthetic resolved for risk metrics (Omega, Drawdown) after CLV filtering.

### Confidence Tiers (External Activity)

| Tier | External Activity Ratio | PnL Reliability |
|------|------------------------|-----------------|
| **A** | < 0.05 | High (CLOB-primary) |
| **B** | 0.05 - 0.20 | Medium |
| **C** | > 0.20 | Low (heavy splits/transfers) |

CLV works for all tiers. Omega/CAGR/Drawdown only reliable for Tier A.

---

## Pipeline Steps

### Step 1: Price Snapshots Table

```sql
CREATE TABLE pm_price_snapshots_15m (
  token_id String,
  bucket DateTime,  -- toStartOfFifteenMinutes(trade_time)
  last_price Float64,
  vwap Float64,
  volume_usdc Float64,
  trade_count UInt32
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(bucket)
ORDER BY (token_id, bucket)
TTL bucket + INTERVAL 120 DAY;

-- Populate from CLOB (last 60d)
INSERT INTO pm_price_snapshots_15m
SELECT
  token_id,
  toStartOfFifteenMinutes(trade_time) as bucket,
  argMax(toFloat64(usdc_amount) / toFloat64(token_amount), trade_time) as last_price,
  sum(toFloat64(usdc_amount)) / sum(toFloat64(token_amount)) as vwap,
  sum(toFloat64(usdc_amount)) / 1e6 as volume_usdc,
  count() as trade_count
FROM pm_trader_events_v2
WHERE is_deleted = 0
  AND trade_time >= now() - INTERVAL 60 DAY
  AND token_amount > 0
GROUP BY token_id, bucket;
```

### Step 2: Trade-Level CLV Features

```sql
CREATE TABLE pm_trade_clv_features_60d (
  wallet String,
  token_id String,
  condition_id String,
  trade_time DateTime,
  side String,
  entry_price Float64,
  notional_usdc Float64,

  -- Price references (NULL if not found within tolerance)
  price_1h Nullable(Float64),
  price_6h Nullable(Float64),
  price_24h Nullable(Float64),
  price_7d Nullable(Float64),

  -- CLV values
  clv_1h Nullable(Float64),
  clv_6h Nullable(Float64),
  clv_24h Nullable(Float64),
  clv_7d Nullable(Float64),

  -- Quality flags
  p1h_found UInt8,
  p6h_found UInt8,
  p24h_found UInt8,
  p7d_found UInt8,

  -- Liquidity context (±1 hour around +24h)
  liq_24h_volume Float64,
  liq_24h_trade_count UInt32,

  -- Impact detection
  wallet_share_of_bucket Float64  -- wallet notional / bucket volume
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(trade_time)
ORDER BY (wallet, trade_time);
```

**Quality handling:**
- Join to nearest bucket within ±30 minutes tolerance
- If no bucket found, set price_Xh = NULL
- Flag `pXh_found` for coverage calculation

**Impact gate:**
- `wallet_share_of_bucket > 0.5` → wallet moved the price, downweight CLV

### Step 3: Wallet-Level CLV Aggregation

```sql
CREATE TABLE pm_wallet_clv_60d (
  wallet String,
  as_of_date Date,

  -- Activity
  n_trades_60d UInt32,
  n_markets_60d UInt32,
  notional_60d Float64,
  last_trade DateTime,
  active_days_60d UInt32,

  -- Coverage quality
  n_trades_with_p24 UInt32,
  p24_coverage Float64,  -- n_trades_with_p24 / n_trades_60d

  -- CLV metrics (notional-weighted)
  clv_1h_weighted Float64,
  clv_6h_weighted Float64,
  clv_24h_weighted Float64,
  clv_7d_weighted Float64,

  -- CLV hit rates
  clv_1h_hit_rate Float64,
  clv_6h_hit_rate Float64,
  clv_24h_hit_rate Float64,
  clv_7d_hit_rate Float64,

  -- Entry behavior
  median_entry_price Float64,
  median_entry_price_buys Float64,

  -- Liquidity summary
  median_liq_24h_volume Float64,
  median_liq_24h_trade_count Float64,

  -- Concentration (anti-luck)
  clv_top5_contribution_pct Float64,  -- top 5 trades' CLV / total CLV
  notional_top5_pct Float64

) ENGINE = ReplacingMergeTree(as_of_date)
ORDER BY wallet;
```

**Aggregation formulas:**
```sql
clv_24h_weighted = sum(clv_24h * notional_usdc) / sum(notional_usdc)
                   WHERE p24_found = 1 AND wallet_share_of_bucket < 0.5

clv_24h_hit_rate = countIf(clv_24h > 0) / countIf(p24_found = 1)
```

### Step 4: External Activity Flags

```sql
CREATE TABLE pm_wallet_external_activity_60d (
  wallet String,
  as_of_date Date,

  -- From pm_ctf_split_merge_expanded
  split_count_60d UInt32,
  merge_count_60d UInt32,

  -- From pm_redemption_payouts_agg
  redemption_count_60d UInt32,

  -- From pm_erc1155_transfers (if available)
  transfer_in_count_60d UInt32,
  transfer_out_count_60d UInt32,

  -- Aggregate
  external_events_60d UInt32,
  external_activity_ratio Float64,  -- external_events / n_trades_60d

  -- Tier assignment
  confidence_tier Enum('A' = 1, 'B' = 2, 'C' = 3)

) ENGINE = ReplacingMergeTree(as_of_date)
ORDER BY wallet;
```

**Tier logic:**
```sql
confidence_tier = multiIf(
  external_activity_ratio < 0.05, 'A',
  external_activity_ratio < 0.20, 'B',
  'C'
)
```

### Step 5: Forecaster Leaderboard

```sql
CREATE VIEW pm_wallet_forecaster_candidates_60d AS
SELECT
  c.*,
  e.external_activity_ratio,
  e.confidence_tier,

  -- Ranking score
  clv_24h_weighted as primary_score,
  clv_6h_weighted as tiebreaker_score

FROM pm_wallet_clv_60d c
LEFT JOIN pm_wallet_external_activity_60d e ON c.wallet = e.wallet

-- Quality gates
WHERE c.n_trades_60d >= 20
  AND c.n_trades_with_p24 >= 15
  AND c.p24_coverage >= 0.75
  AND c.median_liq_24h_trade_count >= 5
  AND c.last_trade >= now() - INTERVAL 30 DAY

-- Anti-concentration gate
  AND c.clv_top5_contribution_pct <= 0.50

ORDER BY primary_score DESC, tiebreaker_score DESC;
```

### Step 6: Risk Metrics (V19s for Top Candidates)

Only for Top 10k from CLV leaderboard:

```sql
CREATE TABLE pm_wallet_risk_metrics_60d (
  wallet String,
  as_of_date Date,

  -- From V19s daily series
  omega_0_60d Nullable(Float64),
  sortino_60d Nullable(Float64),
  max_drawdown_60d Nullable(Float64),

  -- PnL metrics
  realized_pnl_60d Float64,
  synthetic_realized_pnl_60d Float64,  -- includes price→0/1
  pnl_per_active_day_60d Float64,

  -- Equity curve stats
  cagr_like_60d Nullable(Float64),
  winning_days_pct Float64

) ENGINE = ReplacingMergeTree(as_of_date)
ORDER BY wallet;
```

### Step 7: Output Cohorts

**Top 10k Discovery:**
```sql
SELECT * FROM pm_wallet_forecaster_candidates_60d
LIMIT 10000;
```

**Top 1k Tier A (Copy-Trade Candidates):**
```sql
SELECT * FROM pm_wallet_forecaster_candidates_60d
WHERE confidence_tier = 'A'
LIMIT 1000;
```

**Spotcheck 200:**
```sql
WITH top_1k AS (
  SELECT wallet FROM pm_wallet_forecaster_candidates_60d
  WHERE confidence_tier = 'A'
  LIMIT 1000
)
SELECT
  wallet,
  -- Sample 20 trades per wallet
  groupArray(20)(trade_sample) as sample_trades,
  -- Validation stats
  avg(p24_coverage) as coverage,
  avg(median_liq_24h_volume) as liquidity,
  any(confidence_tier) as tier
FROM pm_trade_clv_features_60d
WHERE wallet IN (SELECT wallet FROM top_1k)
GROUP BY wallet
ORDER BY rand()
LIMIT 200;
```

---

## Anti-Noise Gates Summary

| Gate | Threshold | Purpose |
|------|-----------|---------|
| `n_trades_60d` | >= 20 | Statistical significance |
| `n_trades_with_p24` | >= 15 | CLV reliability |
| `p24_coverage` | >= 0.75 | Data completeness |
| `median_liq_24h_trade_count` | >= 5 | Avoid stale price artifacts |
| `wallet_share_of_bucket` | < 0.50 | Exclude "moved price themselves" |
| `clv_top5_contribution_pct` | <= 0.50 | Anti-luck/concentration |
| `last_trade` | >= 30d ago | Active traders |
| `confidence_tier` (for risk metrics) | A only | CLOB-primary |

---

## Execution Plan

| Step | Time Est | Output |
|------|----------|--------|
| 1. Build pm_price_snapshots_15m | 30 min | 60d of 15m prices |
| 2. Build pm_trade_clv_features_60d | 1 hour | CLV per trade |
| 3. Build pm_wallet_clv_60d | 30 min | Aggregated CLV |
| 4. Build pm_wallet_external_activity_60d | 15 min | Tier flags |
| 5. Create forecaster view | 5 min | Leaderboard |
| 6. V19s on top 10k | 1 hour | Risk metrics |
| 7. Export cohorts | 10 min | Final outputs |

**Total: ~4 hours**

---

## Validation Plan

For spotcheck_200:
1. Sample 20 trades per wallet with p24_found=1
2. Fetch Gamma price for same token/time
3. Compare our snapshot price vs Gamma
4. Flag wallets where divergence > threshold (e.g., >5% on >30% of samples)
5. Output validation report with:
   - Coverage stats
   - Liquidity stats
   - External activity tier
   - CLV breakdown
   - Any validation failures
