# Copy Trading Score Implementation Roadmap

## Target Formula

```
Score = μ × M

Where:
  μ = mean(R_i)           # Average return per trade
  M = median(|R_i|)       # Typical move size (median absolute return)
  R_i = trade return as decimal (e.g., +12% = 0.12)
```

**Why this works:**
- Equal weight per trade ($1 bet) → every trade counts equally
- μ answers: "Do they make money per trade overall?"
- M answers: "Are they winning from real, copyable moves?"
- Arbers/MMs get low M (tiny % returns) → naturally downranked

---

## Current State (What We Have)

### ✅ Validated Metrics
| Metric | Status | Source |
|--------|--------|--------|
| Realized PnL | ✅ 100% accurate | CCR-v1 |
| Markets traded | ✅ 100% accurate | SQL condition count |
| Win count | ✅ 100% accurate | CCR-v1 |
| Total trades (fills) | ✅ 100% accurate | SQL event_id dedup |
| Token volume | ✅ 100% accurate | SQL token_amount |

### ❌ Gap: Per-Trade Returns
CCR-v1 gives **position-level** PnL (aggregated per token_id), not **per-trade** returns.

**Need to calculate:** For each individual fill, what was the return?

---

## Implementation Roadmap

### Phase 1: Define "Trade" and Calculate R_i (Day 1)

**Key Decision:** What is a "trade"?

| Option | Definition | Pros | Cons |
|--------|------------|------|------|
| A. Per-fill | Each CLOB fill is a trade | Simple, granular | Scaling in/out = many trades |
| B. Per-position | Net result on a token_id | Matches CCR-v1 | Not "per trade" |
| C. Per-market | Net result on condition_id | Simplest | Loses granularity |

**Recommendation: Option B (Per-position)**
- A "trade" = a completed position on a token_id
- R_i = (position_pnl) / (cost_basis)
- Matches how CCR-v1 already works
- Filters: Only include resolved positions

**Formula:**
```
R_i = (proceeds - cost_basis + settlement_value) / cost_basis

Where:
  cost_basis = sum of USDC spent buying the token
  proceeds = sum of USDC received selling the token
  settlement_value = remaining_tokens × payout (1 if won, 0 if lost)
```

### Phase 2: Build 90-Day Rolling Dataset (Day 1-2)

**Data Source:** `pm_trader_events_v2` + `pm_condition_resolutions`

**Query Structure:**
```sql
WITH positions AS (
  SELECT
    wallet,
    token_id,
    condition_id,
    resolution_date,
    cost_basis,
    proceeds,
    settlement_value,
    (proceeds - cost_basis + settlement_value) / NULLIF(cost_basis, 0) AS R_i
  FROM (
    -- Aggregate trades per wallet/token
    -- Join with resolutions for settlement
    -- Filter: resolution_date >= NOW() - INTERVAL 90 DAY
  )
)
SELECT * FROM positions WHERE R_i IS NOT NULL
```

**Output Table:** `pm_position_returns_90d`
| Column | Type | Description |
|--------|------|-------------|
| wallet | String | Wallet address |
| token_id | String | Token traded |
| condition_id | String | Market |
| resolved_at | DateTime | When position closed |
| cost_basis | Float64 | USDC spent |
| pnl | Float64 | Position profit/loss |
| R_i | Float64 | Return as decimal |

### Phase 3: Apply Eligibility Filters (Day 2)

```sql
SELECT wallet
FROM pm_position_returns_90d
GROUP BY wallet
HAVING
  count() > 15                          -- >15 completed trades
  AND count(DISTINCT condition_id) > 10 -- >10 markets
```

### Phase 4: Compute μ, M, Score (Day 2)

```sql
SELECT
  wallet,
  avg(R_i) AS mu,                       -- Mean return
  medianExact(abs(R_i)) AS M,           -- Median absolute return
  avg(R_i) * medianExact(abs(R_i)) AS score
FROM pm_position_returns_90d
WHERE wallet IN (eligible_wallets)
GROUP BY wallet
HAVING avg(R_i) > 0                     -- Optional: positive expectancy only
ORDER BY score DESC
LIMIT 20
```

### Phase 5: Validate Results (Day 2-3)

**Sanity Checks:**
1. Top 20 should NOT be arbers (check avg trade size, timing patterns)
2. Known profitable wallets (@Latina, @biznis33) should rank well
3. Known arber wallets should rank low (small M)

**Validation Queries:**
- Top scorer's actual trades: Do they look copyable?
- Score distribution: Is there good separation?
- M values: Are top wallets showing meaningful % moves?

### Phase 6: Create Pre-computed Table (Day 3)

```sql
CREATE TABLE pm_copy_trading_scores_v1 (
  wallet String,
  mu Float64,
  M Float64,
  score Float64,
  num_trades UInt32,
  num_markets UInt32,
  avg_cost_basis Float64,
  computed_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree()
ORDER BY wallet
```

**Refresh:** Daily cron job to recompute rolling 90-day scores.

---

## Key Metrics to Lock In First

Before implementing the full score, we need to validate R_i calculation:

| Metric | Priority | Validation Method |
|--------|----------|-------------------|
| Per-position cost_basis | P0 | Compare to CCR-v1 |
| Per-position PnL | P0 | Compare to CCR-v1 |
| Per-position R_i | P0 | Manual check on sample |
| μ (mean return) | P1 | Compute for @Latina, @biznis33 |
| M (median abs return) | P1 | Compute for same wallets |
| Score | P1 | Rank check |

---

## Timeline

| Day | Task | Deliverable |
|-----|------|-------------|
| 1 | Define R_i, build position-level query | SQL query for R_i |
| 1 | Validate R_i on 2 wallets | Confirmation R_i matches expectations |
| 2 | Build 90-day dataset | `pm_position_returns_90d` table |
| 2 | Implement filters + score calc | Score query working |
| 2 | Validate top 20 | Manual review of top scorers |
| 3 | Create pre-computed table | `pm_copy_trading_scores_v1` |
| 3 | Build daily refresh job | Cron script |

---

## Files to Create

| File | Purpose |
|------|---------|
| `lib/pnl/calculateTradeReturns.ts` | Calculate R_i per position |
| `scripts/leaderboard/compute-copy-scores.ts` | Compute μ, M, Score |
| `sql/ddl_pm_copy_trading_scores_v1.sql` | Score table DDL |
| `scripts/cron-refresh-copy-scores.ts` | Daily refresh job |

---

## Success Criteria

1. **Top 20 are copyable:** Manual review shows directional traders, not arbers
2. **Known good wallets rank:** @Latina, @biznis33 in top 50
3. **Arbers excluded:** Low M naturally filters them
4. **Scores are stable:** Day-over-day top 20 doesn't churn excessively
5. **Query is fast:** < 10 seconds on full wallet universe

---

*Created: December 31, 2025*
