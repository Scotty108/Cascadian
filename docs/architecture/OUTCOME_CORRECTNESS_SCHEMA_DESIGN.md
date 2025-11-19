# Outcome Correctness & Wallet Scoring Schema Design

## Overview

Extends the P&L system to track **outcome correctness** and **exit strategy quality** for smart money identification.

---

## Key Metrics to Track

### 1. Outcome Correctness
- **Did they buy the winning outcome?**
- Independent of P&L (can buy winner and still lose money if sold too early)

### 2. Exit Strategy Classification
- **Buy Winner → Sell (Trading Exit)**: Captured trading profit
- **Buy Winner → Hold to Resolution (Redemption Exit)**: Full redemption value
- **Buy Loser → Sell (Cut Loss)**: Minimized loss by exiting early
- **Buy Loser → Hold to Resolution (Full Loss)**: Lost entire position

### 3. Derived Scores
- **Outcome Accuracy Rate**: % of positions opened on winning outcome
- **Trading Skill**: P&L per trade on sold positions
- **Hold Quality**: P&L on positions held to resolution
- **Loss Mitigation**: How well they cut losing positions early

---

## Proposed Database Schema

### Phase 1: Enriched Trade Table

```sql
-- Materialized table: All trades enriched with outcome information
CREATE TABLE cascadian_clean.trades_enriched
(
  -- Trade identity
  wallet LowCardinality(String),
  market_cid String,
  outcome Int32,
  timestamp DateTime,
  trade_direction LowCardinality(String), -- BUY or SELL

  -- Trade details
  shares Float64,
  price_usd Float64,
  usd_value Float64,
  d_shares Float64,  -- Signed: positive for BUY, negative for SELL
  d_cash Float64,    -- Signed: negative for BUY, positive for SELL

  -- Outcome result (from resolutions)
  outcome_won Bool,              -- Did this outcome win?
  winning_outcome Int32,         -- Which outcome won (NULL if unresolved)
  payout_numerator UInt64,       -- Payout for this outcome
  payout_denominator UInt64,     -- Payout denominator
  resolution_timestamp Nullable(DateTime),

  -- Computed flags
  correct_entry Bool,            -- TRUE if bought/sold the winning outcome
  market_resolved Bool,          -- TRUE if market has resolved

  -- Metadata
  inserted_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(inserted_at)
ORDER BY (wallet, market_cid, outcome, timestamp);
```

**Populate from:**
```sql
INSERT INTO cascadian_clean.trades_enriched
SELECT
  lower(t.wallet_address_norm) AS wallet,
  concat('0x', left(replaceAll(t.condition_id_norm,'0x',''),62),'00') AS market_cid,
  toInt32(t.outcome_index) AS outcome,
  toDateTime(t.timestamp) AS timestamp,
  t.trade_direction,

  toFloat64(t.shares) AS shares,
  toFloat64(t.price_usd) AS price_usd,
  toFloat64(t.usd_value) AS usd_value,
  if(t.trade_direction='BUY', toFloat64(t.shares), -toFloat64(t.shares)) AS d_shares,
  if(t.trade_direction='BUY', -toFloat64(t.usd_value), toFloat64(t.usd_value)) AS d_cash,

  -- Join to resolutions
  if(r.winning_outcome IS NOT NULL,
     r.winning_outcome = toInt32(t.outcome_index),
     NULL) AS outcome_won,
  r.winning_outcome,
  if(r.payout_numerators IS NOT NULL AND toInt32(t.outcome_index) < length(r.payout_numerators),
     r.payout_numerators[toInt32(t.outcome_index) + 1],
     0) AS payout_numerator,
  r.payout_denominator,
  r.resolution_timestamp,

  -- Computed
  if(r.winning_outcome IS NOT NULL,
     r.winning_outcome = toInt32(t.outcome_index),
     NULL) AS correct_entry,
  r.winning_outcome IS NOT NULL AS market_resolved,

  now() AS inserted_at
FROM default.vw_trades_canonical t
LEFT JOIN default.market_resolutions_final r
  ON concat('0x', left(replaceAll(t.condition_id_norm,'0x',''),62),'00') = concat('0x', r.condition_id_norm)
WHERE t.condition_id_norm != ''
  AND t.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000';
```

---

### Phase 2: Position Lifecycle Table

```sql
-- Tracks complete position lifecycle: entry → exit → result
CREATE TABLE cascadian_clean.position_lifecycle
(
  -- Position identity
  wallet LowCardinality(String),
  market_cid String,
  outcome Int32,
  position_id UInt64,  -- Auto-increment per wallet+market+outcome

  -- Entry
  entry_timestamp DateTime,
  entry_shares Float64,
  entry_cost_basis Float64,       -- Total USD paid for this lot
  entry_avg_price Float64,        -- Cost basis / shares

  -- Exit (NULL if still open)
  exit_timestamp Nullable(DateTime),
  exit_shares Float64,             -- Shares sold/redeemed
  exit_proceeds Float64,           -- Total USD received
  exit_avg_price Nullable(Float64), -- Proceeds / shares
  exit_type LowCardinality(String), -- 'TRADE_SELL', 'REDEMPTION', 'OPEN'

  -- Outcome result
  outcome_won Nullable(Bool),
  winning_outcome Nullable(Int32),
  correct_entry Nullable(Bool),

  -- P&L
  realized_pnl Float64,            -- Exit proceeds - entry cost
  realized_pnl_pct Float64,        -- (realized_pnl / entry_cost) * 100

  -- Classification
  position_category LowCardinality(String),
  -- Categories:
  --   'WIN_TRADED': Bought winner, sold before resolution
  --   'WIN_REDEEMED': Bought winner, held to resolution
  --   'LOSS_TRADED': Bought loser, sold before resolution (cut loss)
  --   'LOSS_REDEEMED': Bought loser, held to resolution (full loss)
  --   'OPEN_CORRECT': Open position, likely winner
  --   'OPEN_INCORRECT': Open position, likely loser
  --   'OPEN_UNKNOWN': Open position, market unresolved

  -- Metadata
  inserted_at DateTime DEFAULT now(),
  updated_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (wallet, market_cid, outcome, position_id);
```

**Note**: This would be populated by a FIFO matching algorithm similar to `phase1b-fifo-pnl.ts` but enriched with outcome results.

---

### Phase 3: Wallet Scoring Metrics

```sql
-- Aggregated wallet metrics for filtering
CREATE TABLE cascadian_clean.wallet_metrics
(
  wallet LowCardinality(String),
  as_of_date Date,

  -- Volume metrics
  total_trades UInt32,
  total_volume_usd Float64,
  total_markets_traded UInt32,
  active_days UInt32,

  -- P&L metrics
  total_pnl Float64,
  realized_pnl Float64,
  unrealized_pnl Float64,
  redemption_pnl Float64,

  -- Outcome correctness (resolved markets only)
  positions_opened UInt32,
  positions_on_winners UInt32,
  positions_on_losers UInt32,
  outcome_accuracy_pct Float64,  -- (positions_on_winners / total) * 100

  -- Exit strategy breakdown
  win_traded_count UInt32,       -- Bought winner, sold early
  win_traded_pnl Float64,
  win_redeemed_count UInt32,     -- Bought winner, held to resolution
  win_redeemed_pnl Float64,
  loss_traded_count UInt32,      -- Bought loser, sold (cut loss)
  loss_traded_pnl Float64,
  loss_redeemed_count UInt32,    -- Bought loser, held (full loss)
  loss_redeemed_pnl Float64,

  -- Quality scores (0-100)
  trading_skill_score Float64,   -- P&L per trade on sold positions
  hold_quality_score Float64,    -- P&L on positions held to resolution
  loss_mitigation_score Float64, -- How well they exit losing positions

  -- Risk metrics
  win_rate_pct Float64,          -- % of positions with positive P&L
  avg_position_size_usd Float64,
  largest_win_usd Float64,
  largest_loss_usd Float64,
  sharpe_ratio Nullable(Float64),

  -- Timing metrics
  avg_hold_duration_hours Float64,
  early_exit_rate_pct Float64,   -- % sold before resolution

  -- Metadata
  updated_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (wallet, as_of_date);
```

**Populate from position_lifecycle:**
```sql
INSERT INTO cascadian_clean.wallet_metrics
SELECT
  wallet,
  today() AS as_of_date,

  -- Volume
  count(*) AS total_trades,
  sum(entry_cost_basis) AS total_volume_usd,
  uniqExact(market_cid) AS total_markets_traded,
  uniqExact(toDate(entry_timestamp)) AS active_days,

  -- P&L
  sum(realized_pnl) AS total_pnl,
  sumIf(realized_pnl, exit_type IN ('TRADE_SELL', 'REDEMPTION')) AS realized_pnl,
  sumIf(realized_pnl, exit_type = 'OPEN') AS unrealized_pnl,
  sumIf(realized_pnl, exit_type = 'REDEMPTION') AS redemption_pnl,

  -- Correctness (only resolved markets)
  countIf(market_resolved = TRUE) AS positions_opened,
  countIf(correct_entry = TRUE) AS positions_on_winners,
  countIf(correct_entry = FALSE) AS positions_on_losers,
  if(countIf(market_resolved = TRUE) > 0,
     (countIf(correct_entry = TRUE) / countIf(market_resolved = TRUE)) * 100,
     NULL) AS outcome_accuracy_pct,

  -- Exit strategies
  countIf(position_category = 'WIN_TRADED') AS win_traded_count,
  sumIf(realized_pnl, position_category = 'WIN_TRADED') AS win_traded_pnl,
  countIf(position_category = 'WIN_REDEEMED') AS win_redeemed_count,
  sumIf(realized_pnl, position_category = 'WIN_REDEEMED') AS win_redeemed_pnl,
  countIf(position_category = 'LOSS_TRADED') AS loss_traded_count,
  sumIf(realized_pnl, position_category = 'LOSS_TRADED') AS loss_traded_pnl,
  countIf(position_category = 'LOSS_REDEEMED') AS loss_redeemed_count,
  sumIf(realized_pnl, position_category = 'LOSS_REDEEMED') AS loss_redeemed_pnl,

  -- Quality scores (computed)
  -- TODO: Define formulas for these scores
  0.0 AS trading_skill_score,
  0.0 AS hold_quality_score,
  0.0 AS loss_mitigation_score,

  -- Risk
  (countIf(realized_pnl > 0) / count(*)) * 100 AS win_rate_pct,
  avg(entry_cost_basis) AS avg_position_size_usd,
  max(realized_pnl) AS largest_win_usd,
  min(realized_pnl) AS largest_loss_usd,
  NULL AS sharpe_ratio,  -- TODO: Calculate

  -- Timing
  avgIf(
    dateDiff('hour', entry_timestamp, exit_timestamp),
    exit_timestamp IS NOT NULL
  ) AS avg_hold_duration_hours,
  (countIf(exit_type = 'TRADE_SELL') / count(*)) * 100 AS early_exit_rate_pct,

  now() AS updated_at
FROM cascadian_clean.position_lifecycle
GROUP BY wallet;
```

---

## Query Views for Filtering

### Smart Money by Outcome Accuracy

```sql
CREATE VIEW cascadian_clean.vw_smart_money_outcome_accuracy AS
SELECT
  wallet,
  outcome_accuracy_pct,
  positions_opened,
  positions_on_winners,
  total_pnl,
  total_volume_usd
FROM cascadian_clean.wallet_metrics
WHERE positions_opened >= 10  -- Min 10 resolved positions
  AND outcome_accuracy_pct >= 60  -- At least 60% correct
ORDER BY outcome_accuracy_pct DESC, total_volume_usd DESC;
```

### Smart Money by Trading Skill

```sql
CREATE VIEW cascadian_clean.vw_smart_money_trading_skill AS
SELECT
  wallet,
  win_traded_count + loss_traded_count AS total_trades,
  win_traded_pnl + loss_traded_pnl AS trading_pnl,
  (win_traded_count / (win_traded_count + loss_traded_count)) * 100 AS trade_win_rate,
  outcome_accuracy_pct
FROM cascadian_clean.wallet_metrics
WHERE win_traded_count + loss_traded_count >= 10
  AND win_traded_pnl + loss_traded_pnl > 10000  -- At least $10K profit from trading
ORDER BY trading_pnl DESC;
```

### Smart Money by Hold Quality

```sql
CREATE VIEW cascadian_clean.vw_smart_money_hold_quality AS
SELECT
  wallet,
  win_redeemed_count + loss_redeemed_count AS total_held,
  win_redeemed_pnl + loss_redeemed_pnl AS redemption_pnl,
  (win_redeemed_count / (win_redeemed_count + loss_redeemed_count)) * 100 AS hold_win_rate,
  outcome_accuracy_pct
FROM cascadian_clean.wallet_metrics
WHERE win_redeemed_count + loss_redeemed_count >= 5
  AND outcome_accuracy_pct >= 70  -- Must be good at picking winners
ORDER BY redemption_pnl DESC;
```

### Combined Smart Money Score

```sql
CREATE VIEW cascadian_clean.vw_smart_money_ranked AS
SELECT
  wallet,
  outcome_accuracy_pct,
  total_pnl,
  total_volume_usd,
  win_rate_pct,

  -- Composite score (0-100)
  (
    (outcome_accuracy_pct * 0.40) +        -- 40% weight on correctness
    (win_rate_pct * 0.30) +                -- 30% weight on win rate
    (least(total_pnl / 100000, 1.0) * 100 * 0.20) +  -- 20% weight on absolute P&L (capped at 100K)
    (least(total_volume_usd / 1000000, 1.0) * 100 * 0.10)  -- 10% weight on volume (capped at 1M)
  ) AS smart_money_score,

  -- Category
  multiIf(
    outcome_accuracy_pct >= 70 AND total_pnl > 50000, 'ELITE',
    outcome_accuracy_pct >= 65 AND total_pnl > 25000, 'ADVANCED',
    outcome_accuracy_pct >= 60 AND total_pnl > 10000, 'INTERMEDIATE',
    'BASIC'
  ) AS trader_category
FROM cascadian_clean.wallet_metrics
WHERE positions_opened >= 10
  AND outcome_accuracy_pct >= 55
ORDER BY smart_money_score DESC;
```

---

## Implementation Plan

### Phase 1: Foundation (2-3 hours)
1. Create `trades_enriched` table
2. Populate from `vw_trades_canonical` + `market_resolutions_final`
3. Test outcome correctness flagging

### Phase 2: Position Tracking (4-6 hours)
1. Build FIFO position matcher with outcome tracking
2. Create `position_lifecycle` table
3. Populate with historical data
4. Classify positions into categories

### Phase 3: Wallet Metrics (2-3 hours)
1. Create `wallet_metrics` table
2. Calculate all metrics from `position_lifecycle`
3. Define scoring formulas
4. Create filtering views

### Phase 4: Validation (1-2 hours)
1. Compare with known smart money wallets
2. Validate outcome accuracy calculations
3. Test filtering queries
4. Document metric definitions

---

## Example Queries

### Find wallets who bought Trump to win in 2024 election

```sql
SELECT DISTINCT
  t.wallet,
  w.outcome_accuracy_pct,
  w.total_pnl
FROM cascadian_clean.trades_enriched t
JOIN cascadian_clean.wallet_metrics w ON w.wallet = t.wallet
WHERE t.market_cid = '0x...'  -- Trump market
  AND t.outcome = 1  -- Yes outcome
  AND t.trade_direction = 'BUY'
  AND w.outcome_accuracy_pct >= 65
ORDER BY w.outcome_accuracy_pct DESC;
```

### Find wallets good at cutting losses

```sql
SELECT
  wallet,
  loss_traded_count,
  loss_redeemed_count,
  (loss_traded_count / (loss_traded_count + loss_redeemed_count)) * 100 AS loss_exit_rate,
  loss_traded_pnl,
  loss_redeemed_pnl
FROM cascadian_clean.wallet_metrics
WHERE loss_traded_count + loss_redeemed_count >= 10
  AND loss_traded_count > loss_redeemed_count  -- Exit more than hold
ORDER BY loss_exit_rate DESC;
```

### Compare trading vs holding strategies

```sql
SELECT
  'Trading' AS strategy,
  avg(win_traded_pnl / win_traded_count) AS avg_profit_per_position,
  avg((win_traded_count / (win_traded_count + loss_traded_count)) * 100) AS win_rate
FROM cascadian_clean.wallet_metrics
WHERE win_traded_count >= 10

UNION ALL

SELECT
  'Holding' AS strategy,
  avg(win_redeemed_pnl / win_redeemed_count) AS avg_profit_per_position,
  avg((win_redeemed_count / (win_redeemed_count + loss_redeemed_count)) * 100) AS win_rate
FROM cascadian_clean.wallet_metrics
WHERE win_redeemed_count >= 10;
```

---

## Next Steps

1. **Wait for midprice fetcher** to complete current P&L system
2. **Validate current P&L calculations** match Polymarket
3. **Implement Phase 1** (trades_enriched table)
4. **Build position lifecycle tracker** (FIFO with outcome tracking)
5. **Calculate wallet metrics** and scoring system
6. **Test filtering queries** for smart money identification

---

## Files to Create

- `build-trades-enriched.ts` - Populate enriched trades table
- `build-position-lifecycle.ts` - FIFO matcher with outcome tracking
- `calculate-wallet-metrics.ts` - Aggregate metrics per wallet
- `outcome-correctness-schema.sql` - All CREATE TABLE/VIEW statements
- `test-smart-money-filters.ts` - Validation queries

---

**Ready to implement?** Let me know if you want to proceed with Phase 1 now or wait for the midprice fetcher to complete first.
