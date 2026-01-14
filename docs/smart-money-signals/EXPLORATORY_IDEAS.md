# Exploratory Ideas - Signal Discovery Pipeline

> Ideas to test for finding higher-accuracy signals beyond the validated ones.

---

## High Priority Ideas

### 1. Tier-Weighted Signals
**Hypothesis:** Superforecasters alone are more accurate than combined smart money.

**Why it might work:** Superforecasters have proven track records (Brier < 0.15). Diluting their signal with "profitable" tier may reduce accuracy.

**Test Query:**
```sql
WITH signals AS (
  SELECT
    market_id,
    category,
    outcome_resolved,
    superforecaster_yes_usd + superforecaster_no_usd as sf_total,
    smart_yes_usd + smart_no_usd as smart_total,
    profitable_yes_usd + profitable_no_usd as prof_total,
    -- SF-only odds
    superforecaster_yes_usd / nullIf(superforecaster_yes_usd + superforecaster_no_usd, 0) as sf_odds,
    -- Combined odds
    smart_money_odds,
    crowd_price
  FROM wio_smart_money_metrics_v2
  WHERE is_resolved = 1 AND outcome_resolved IN (0, 1)
    AND dateDiff('day', ts, end_date) BETWEEN 5 AND 14
)
SELECT
  category,
  -- SF-dominant signals (SF > 50% of total)
  countIf(sf_total > smart_total + prof_total) as sf_dominant_count,
  avgIf(
    if((sf_odds > 0.5 AND outcome_resolved = 1) OR (sf_odds < 0.5 AND outcome_resolved = 0), 1, 0),
    sf_total > smart_total + prof_total AND sf_odds IS NOT NULL
  ) * 100 as sf_dominant_accuracy,
  -- SF-minority signals
  avgIf(
    if((smart_money_odds > 0.5 AND outcome_resolved = 1) OR (smart_money_odds < 0.5 AND outcome_resolved = 0), 1, 0),
    sf_total <= smart_total + prof_total
  ) * 100 as sf_minority_accuracy
FROM signals
GROUP BY category
```

---

### 2. Flow Momentum Signals
**Hypothesis:** Accelerating buying (positive flow) predicts outcomes better than static positions.

**Why it might work:** Flow indicates NEW information entering the market, not stale positions.

**Test Query:**
```sql
WITH flow_signals AS (
  SELECT
    market_id,
    category,
    outcome_resolved,
    smart_money_odds,
    crowd_price,
    flow_24h,
    new_wallets_24h,
    dateDiff('day', ts, end_date) as days_before,
    if((smart_money_odds > 0.5 AND outcome_resolved = 1) OR
       (smart_money_odds < 0.5 AND outcome_resolved = 0), 1, 0) as sm_correct
  FROM wio_smart_money_metrics_v2
  WHERE is_resolved = 1 AND outcome_resolved IN (0, 1)
    AND days_before BETWEEN 3 AND 10
)
SELECT
  CASE
    WHEN flow_24h > 10000 THEN 'Strong buying'
    WHEN flow_24h > 1000 THEN 'Moderate buying'
    WHEN flow_24h < -10000 THEN 'Strong selling'
    WHEN flow_24h < -1000 THEN 'Moderate selling'
    ELSE 'Neutral'
  END as flow_bucket,
  count() as signals,
  avg(sm_correct) * 100 as accuracy,
  avg(abs(smart_money_odds - crowd_price)) * 100 as avg_divergence
FROM flow_signals
GROUP BY flow_bucket
ORDER BY accuracy DESC
```

---

### 3. Wallet Count Velocity
**Hypothesis:** Rapid increase in smart wallet count signals information spreading.

**Why it might work:** When multiple smart wallets independently enter, it suggests real signal vs. single whale.

**Test Query:**
```sql
WITH velocity_signals AS (
  SELECT
    market_id,
    category,
    outcome_resolved,
    smart_money_odds,
    wallet_count,
    new_wallets_24h,
    new_wallets_24h / nullIf(wallet_count, 0) as wallet_growth_rate,
    if((smart_money_odds > 0.5 AND outcome_resolved = 1) OR
       (smart_money_odds < 0.5 AND outcome_resolved = 0), 1, 0) as sm_correct
  FROM wio_smart_money_metrics_v2
  WHERE is_resolved = 1 AND outcome_resolved IN (0, 1)
    AND dateDiff('day', ts, end_date) BETWEEN 5 AND 14
    AND wallet_count >= 10
)
SELECT
  CASE
    WHEN wallet_growth_rate > 0.3 THEN 'High growth (>30%)'
    WHEN wallet_growth_rate > 0.1 THEN 'Moderate growth (10-30%)'
    WHEN wallet_growth_rate > 0 THEN 'Low growth (0-10%)'
    ELSE 'No growth'
  END as growth_bucket,
  count() as signals,
  avg(sm_correct) * 100 as accuracy
FROM velocity_signals
GROUP BY growth_bucket
ORDER BY accuracy DESC
```

---

### 4. Divergence Direction (Closing vs Opening)
**Hypothesis:** SM odds moving TOWARD crowd = fading, moving AWAY = strengthening conviction.

**Why it might work:** Direction of change may matter more than static snapshot.

**Test Query:**
```sql
WITH divergence_change AS (
  SELECT
    market_id,
    category,
    outcome_resolved,
    -- Current divergence
    smart_money_odds - crowd_price as current_div,
    -- Divergence 24h ago (approximate via lag)
    lagInFrame(smart_money_odds - crowd_price, 24) OVER (
      PARTITION BY market_id ORDER BY ts
    ) as prev_div,
    if((smart_money_odds > 0.5 AND outcome_resolved = 1) OR
       (smart_money_odds < 0.5 AND outcome_resolved = 0), 1, 0) as sm_correct
  FROM wio_smart_money_metrics_v2
  WHERE is_resolved = 1 AND outcome_resolved IN (0, 1)
    AND dateDiff('day', ts, end_date) BETWEEN 3 AND 10
)
SELECT
  CASE
    WHEN abs(current_div) > abs(prev_div) THEN 'Divergence increasing'
    WHEN abs(current_div) < abs(prev_div) THEN 'Divergence decreasing'
    ELSE 'Stable'
  END as divergence_direction,
  count() as signals,
  avg(sm_correct) * 100 as accuracy
FROM divergence_change
WHERE prev_div IS NOT NULL
GROUP BY divergence_direction
```

---

## Medium Priority Ideas

### 5. Series/Recurring Markets
**Hypothesis:** Daily/weekly recurring markets have different dynamics than one-off events.

**Test Query:**
```sql
SELECT
  if(series_slug != '', 'Series market', 'One-off market') as market_type,
  category,
  count(DISTINCT market_id) as markets,
  avg(if((smart_money_odds > 0.5 AND outcome_resolved = 1) OR
         (smart_money_odds < 0.5 AND outcome_resolved = 0), 1, 0)) * 100 as sm_accuracy
FROM wio_smart_money_metrics_v2
WHERE is_resolved = 1 AND outcome_resolved IN (0, 1)
GROUP BY market_type, category
HAVING markets >= 50
ORDER BY category, market_type
```

---

### 6. Position Concentration (Whale vs Distributed)
**Hypothesis:** Single whale betting differs from distributed consensus.

**Requires:** Adding top5_concentration metric to positions aggregation.

**Test Query (conceptual):**
```sql
-- Would need to compute concentration from positions
SELECT
  CASE
    WHEN max_position_size / total_usd > 0.5 THEN 'Whale dominated'
    WHEN max_position_size / total_usd > 0.25 THEN 'Semi-concentrated'
    ELSE 'Distributed'
  END as concentration,
  count() as signals,
  avg(sm_correct) * 100 as accuracy
FROM signals
GROUP BY concentration
```

---

### 7. Multi-Timeframe Confirmation
**Hypothesis:** Signal at 7 days confirmed at 3 days = higher accuracy.

**Test Query:**
```sql
WITH early_signals AS (
  SELECT
    market_id,
    if(smart_money_odds > 0.5, 1, 0) as early_direction
  FROM wio_smart_money_metrics_v2
  WHERE dateDiff('day', ts, end_date) BETWEEN 7 AND 10
),
late_signals AS (
  SELECT
    market_id,
    outcome_resolved,
    if(smart_money_odds > 0.5, 1, 0) as late_direction,
    if((smart_money_odds > 0.5 AND outcome_resolved = 1) OR
       (smart_money_odds < 0.5 AND outcome_resolved = 0), 1, 0) as correct
  FROM wio_smart_money_metrics_v2
  WHERE dateDiff('day', ts, end_date) BETWEEN 1 AND 3
    AND is_resolved = 1 AND outcome_resolved IN (0, 1)
)
SELECT
  if(e.early_direction = l.late_direction, 'Confirmed', 'Reversed') as signal_status,
  count() as trades,
  avg(l.correct) * 100 as accuracy
FROM early_signals e
JOIN late_signals l ON e.market_id = l.market_id
GROUP BY signal_status
```

---

### 8. Extreme Single-Wallet Bets
**Hypothesis:** $100K+ from single wallet indicates private information.

**Requires:** Position-level analysis joining back to metrics.

---

## Low Priority Ideas

### 9. Time-of-Day Patterns
**Hypothesis:** Signals posted during US trading hours differ from overnight.

### 10. Tag-Based Analysis
**Hypothesis:** Specific tags (election, earnings, etc.) have unique patterns.

### 11. Liquidity-Adjusted Signals
**Hypothesis:** Signals in illiquid markets are more informative.

### 12. Cross-Market Correlation
**Hypothesis:** SM position in related markets is predictive.

---

## Running Exploratory Tests

```bash
# Quick test of a hypothesis
npx tsx scripts/test-hypothesis.ts --name "tier_weighted" --min-samples 100

# Batch test all high-priority hypotheses
npx tsx scripts/batch-hypothesis-test.ts --priority high

# Generate hypothesis report
npx tsx scripts/generate-hypothesis-report.ts > reports/hypotheses-$(date +%Y%m%d).md
```

---

## Evaluation Criteria

For a hypothesis to become a validated signal:

| Criteria | Threshold |
|----------|-----------|
| Sample size | ≥100 unique markets |
| Win rate | ≥60% |
| ROI | ≥10% |
| p-value | <0.05 |
| Consistent across time | ≥3 months of data |

---

## Next Steps

1. Run queries for ideas #1-4 (high priority)
2. Analyze results for statistical significance
3. Backtest promising patterns with held-out data
4. Add validated signals to SIGNAL_DEFINITIONS
