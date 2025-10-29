# Tier 1 Metrics - Formula Reference Card

Quick reference for the 8 critical Tier 1 metrics calculated from enriched trades.

---

## Data Source

**Table:** `trades_raw`
**Required Columns:**
- `pnl_net` (Decimal 18,6) - Net P&L after all costs
- `pnl_gross` (Decimal 18,6) - Gross P&L before fees
- `is_closed` (Bool) - Position is resolved
- `outcome` (Int8) - 1 = YES won, 0 = NO won, NULL = unresolved

**Filters Applied:**
- `is_closed = true` - Only resolved positions
- `outcome IS NOT NULL` - Only trades with known outcomes
- Time window filter (30d/90d/180d/lifetime)
- Minimum 5 trades per wallet

---

## The 8 Metrics

### 1. Omega Gross
**Column:** `metric_1_omega_gross`
**Type:** Decimal(12,4)

```sql
sumIf(pnl_gross, pnl_gross > 0) / nullIf(sumIf(abs(pnl_gross), pnl_gross <= 0), 0)
```

**Explanation:**
- Numerator: Total gross gains (before fees)
- Denominator: Total gross losses (absolute value)
- Ratio shows risk-adjusted returns ignoring costs

**Example:**
- Gains: $1,000 + $500 + $300 = $1,800
- Losses: |-$200| + |-$150| = $350
- Omega Gross = $1,800 / $350 = **5.14**

---

### 2. Omega Net ⭐ PRIMARY METRIC
**Column:** `metric_2_omega_net`
**Type:** Decimal(12,4)

```sql
sumIf(pnl_net, pnl_net > 0) / nullIf(sumIf(abs(pnl_net), pnl_net <= 0), 0)
```

**Explanation:**
- Numerator: Total net gains (after fees)
- Denominator: Total net losses (absolute value)
- **This is the primary ranking metric**
- Values >1.0 indicate profitability

**Example:**
- Net Gains: $900 + $450 + $280 = $1,630
- Net Losses: |-$180| + |-$130| = $310
- Omega Net = $1,630 / $310 = **5.26**

**Interpretation:**
- `< 1.0` - Unprofitable (losing more than winning)
- `= 1.0` - Break-even
- `1.0 - 2.0` - Profitable but moderate
- `2.0 - 5.0` - Strong performance
- `> 5.0` - Exceptional performance

---

### 3. Net PnL USD
**Column:** `metric_9_net_pnl_usd`
**Type:** Decimal(18,2)

```sql
sum(pnl_net)
```

**Explanation:**
- Simple sum of all net P&L values
- Absolute profit/loss in USD
- Can be positive or negative

**Example:**
- Trade 1: +$900
- Trade 2: -$180
- Trade 3: +$450
- Trade 4: -$130
- Trade 5: +$280
- Net PnL = **$1,320**

---

### 4. Hit Rate
**Column:** `metric_12_hit_rate`
**Type:** Decimal(5,4)

```sql
countIf(pnl_net > 0) / nullIf(count(*), 0)
```

**Explanation:**
- Percentage of winning trades
- Range: 0.0 to 1.0 (0% to 100%)
- Measures accuracy/consistency

**Example:**
- Total trades: 20
- Winning trades: 12
- Hit Rate = 12 / 20 = **0.60** (60%)

**Interpretation:**
- `< 0.40` - Low win rate (needs large wins)
- `0.40 - 0.60` - Average
- `> 0.60` - Above average accuracy
- `> 0.70` - Exceptional accuracy

---

### 5. Average Win USD
**Column:** `metric_13_avg_win_usd`
**Type:** Decimal(18,2)

```sql
avgIf(pnl_net, pnl_net > 0)
```

**Explanation:**
- Average profit on winning trades
- Only includes trades where pnl_net > 0
- NULL if no winning trades

**Example:**
- Winning trades: $900, $450, $280, $320, $550
- Average Win = ($900 + $450 + $280 + $320 + $550) / 5 = **$500.00**

---

### 6. Average Loss USD
**Column:** `metric_14_avg_loss_usd`
**Type:** Decimal(18,2)

```sql
avgIf(abs(pnl_net), pnl_net <= 0)
```

**Explanation:**
- Average loss on losing trades (absolute value)
- Only includes trades where pnl_net ≤ 0
- NULL if no losing trades
- **Note:** Stored as positive value

**Example:**
- Losing trades: -$180, -$130, -$220, -$95
- Average Loss = (180 + 130 + 220 + 95) / 4 = **$156.25**

**Win/Loss Ratio:**
- Avg Win / Avg Loss = $500 / $156.25 = **3.2x**
- Trader wins 3.2x more than they lose on average

---

### 7. EV per Bet Mean
**Column:** `metric_15_ev_per_bet_mean`
**Type:** Decimal(18,4)

```sql
avg(pnl_net)
```

**Explanation:**
- Expected value per trade
- Mean of all P&L values (wins + losses)
- Positive = profitable on average

**Example:**
- All trades P&L: $900, -$180, $450, -$130, $280, -$95, $320, $550
- EV per Bet = sum($2,095) / 8 trades = **$261.88**

**Interpretation:**
- Negative: Losing money per trade on average
- Zero: Break-even
- Positive: Making money per trade on average
- Higher = better edge

---

### 8. Resolved Bets
**Column:** `metric_22_resolved_bets`
**Type:** UInt32

```sql
count(*)
```

**Explanation:**
- Total count of resolved trades
- Used for statistical significance filtering
- Minimum threshold: 5 trades

**Example:**
- Wallet has 47 total trades
- 32 are resolved (is_closed = true, outcome IS NOT NULL)
- Resolved Bets = **32**

**Significance Levels:**
- `5-10` - Minimal sample (use with caution)
- `10-25` - Small sample
- `25-100` - Moderate sample
- `100+` - Large sample (statistically significant)

---

## Complete SQL Query

```sql
SELECT
  wallet_address,

  -- 1. Omega Gross
  sumIf(pnl_gross, pnl_gross > 0) /
    nullIf(sumIf(abs(pnl_gross), pnl_gross <= 0), 0)
    as metric_1_omega_gross,

  -- 2. Omega Net (PRIMARY)
  sumIf(pnl_net, pnl_net > 0) /
    nullIf(sumIf(abs(pnl_net), pnl_net <= 0), 0)
    as metric_2_omega_net,

  -- 3. Net PnL
  sum(pnl_net) as metric_9_net_pnl_usd,

  -- 4. Hit Rate
  countIf(pnl_net > 0) / nullIf(count(*), 0)
    as metric_12_hit_rate,

  -- 5. Avg Win
  avgIf(pnl_net, pnl_net > 0) as metric_13_avg_win_usd,

  -- 6. Avg Loss
  avgIf(abs(pnl_net), pnl_net <= 0) as metric_14_avg_loss_usd,

  -- 7. EV per Bet
  avg(pnl_net) as metric_15_ev_per_bet_mean,

  -- 8. Resolved Bets
  count(*) as metric_22_resolved_bets,

  now() as calculated_at

FROM trades_raw

WHERE is_closed = true
  AND outcome IS NOT NULL
  AND timestamp >= now() - INTERVAL 30 DAY  -- Window filter

GROUP BY wallet_address

HAVING metric_22_resolved_bets >= 5  -- Minimum threshold

ORDER BY metric_2_omega_net DESC;
```

---

## Window Filters

Replace the timestamp filter based on desired window:

| Window   | Filter                                      |
|----------|---------------------------------------------|
| 30d      | `timestamp >= now() - INTERVAL 30 DAY`      |
| 90d      | `timestamp >= now() - INTERVAL 90 DAY`      |
| 180d     | `timestamp >= now() - INTERVAL 180 DAY`     |
| lifetime | `1=1` (no filter)                           |

---

## Null Handling

ClickHouse functions used:
- `nullIf(x, 0)` - Returns NULL if x equals 0, prevents division by zero
- `sumIf(value, condition)` - Sum only when condition is true
- `countIf(condition)` - Count only when condition is true
- `avgIf(value, condition)` - Average only when condition is true

**Result when denominator is 0:**
- Omega metrics return NULL (wallet has only wins or only losses)
- Hit rate returns NULL (no trades)
- Avg metrics return NULL (no trades in that category)

---

## Metric Relationships

### Omega vs Hit Rate
- High Omega + Low Hit Rate = **Big wins, small losses**
- Low Omega + High Hit Rate = **Small wins, big losses**
- High Omega + High Hit Rate = **Ideal trader**

### EV per Bet Calculation
```
EV per Bet = (Hit Rate × Avg Win) - ((1 - Hit Rate) × Avg Loss)
```

Example:
- Hit Rate: 60% (0.60)
- Avg Win: $500
- Avg Loss: $156.25
- EV = (0.60 × $500) - (0.40 × $156.25) = $300 - $62.50 = **$237.50**

### Net PnL Validation
```
Net PnL = (Total Wins × Avg Win) - (Total Losses × Avg Loss)
Net PnL = (Hit Rate × Total Trades × Avg Win) - ((1 - Hit Rate) × Total Trades × Avg Loss)
```

---

## Common Queries

### Top 50 Performers (30d)
```sql
SELECT
  wallet_address,
  metric_2_omega_net as omega,
  metric_9_net_pnl_usd as pnl,
  metric_12_hit_rate * 100 as hit_rate_pct,
  metric_22_resolved_bets as bets
FROM wallet_metrics_complete
WHERE window = 1  -- 30d
  AND metric_22_resolved_bets >= 10
ORDER BY metric_2_omega_net DESC
LIMIT 50;
```

### Profitable Wallets (Lifetime)
```sql
SELECT wallet_address, metric_2_omega_net, metric_9_net_pnl_usd
FROM wallet_metrics_complete
WHERE window = 4  -- lifetime
  AND metric_2_omega_net > 1.0
  AND metric_22_resolved_bets >= 20
ORDER BY metric_9_net_pnl_usd DESC;
```

### High Hit Rate + High Omega
```sql
SELECT wallet_address, metric_12_hit_rate, metric_2_omega_net
FROM wallet_metrics_complete
WHERE window = 2  -- 90d
  AND metric_12_hit_rate >= 0.60
  AND metric_2_omega_net >= 2.0
  AND metric_22_resolved_bets >= 15
ORDER BY metric_2_omega_net DESC;
```

---

## Validation Queries

### Check for anomalies
```sql
-- Negative omega (shouldn't happen)
SELECT count(*) FROM wallet_metrics_complete WHERE metric_2_omega_net < 0;

-- Invalid hit rates
SELECT count(*) FROM wallet_metrics_complete
WHERE metric_12_hit_rate < 0 OR metric_12_hit_rate > 1;

-- Below minimum threshold
SELECT count(*) FROM wallet_metrics_complete WHERE metric_22_resolved_bets < 5;
```

### Statistics per window
```sql
SELECT
  window,
  count(*) as wallets,
  quantile(0.5)(metric_2_omega_net) as median_omega,
  avg(metric_12_hit_rate) * 100 as avg_hit_rate,
  sum(metric_9_net_pnl_usd) as total_pnl
FROM wallet_metrics_complete
GROUP BY window
ORDER BY window;
```

---

## TypeScript Types

```typescript
interface Tier1Metrics {
  wallet_address: string
  window: '30d' | '90d' | '180d' | 'lifetime'
  metric_1_omega_gross: number | null
  metric_2_omega_net: number | null      // PRIMARY
  metric_9_net_pnl_usd: number
  metric_12_hit_rate: number
  metric_13_avg_win_usd: number | null
  metric_14_avg_loss_usd: number | null
  metric_15_ev_per_bet_mean: number
  metric_22_resolved_bets: number
  calculated_at: Date
}
```

---

## Performance Tips

1. **Use indexes** - The table has indexes on omega_net, resolved_bets
2. **Filter by window first** - Reduces data scanned
3. **Add minimum bet filter** - `metric_22_resolved_bets >= 10`
4. **Use PREWHERE** - For timestamp filters in raw trades
5. **Materialize views** - Pre-aggregate common queries

---

## References

- **Main Script:** `/scripts/calculate-tier1-metrics.ts`
- **Verification:** `/scripts/verify-tier1-metrics.ts`
- **Documentation:** `/TIER1_METRICS_CALCULATOR.md`
- **Schema:** `/migrations/clickhouse/004_create_wallet_metrics_complete.sql`
