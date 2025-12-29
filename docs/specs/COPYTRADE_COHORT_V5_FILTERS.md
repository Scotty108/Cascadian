# Copy Trading Cohort V5 - Proposed Filters

**Date:** 2025-12-23
**Status:** Draft for Review

---

## Current Filters (V4) - Too Strict

| Filter | Value | Effect |
|--------|-------|--------|
| Min trades | 105 | Kills newer traders |
| Min positions | 25 | Kills specialists |
| Min P&L | $202+ | **Only profitable - loses 95%+ of traders** |

**Result:** 710 wallets out of 1.74M (0.04%)

---

## Proposed Filters (V5) - Broader Cohort

### Tier 1: Core Filters (Required)

| Filter | Value | Rationale |
|--------|-------|-----------|
| Min trades | **20** | Enough history to evaluate, not just luck |
| Min positions | **5** | Traded multiple markets, not one-trick |
| Min volume | **$500** | Serious enough to matter |
| Last active | **90 days** | Still active on platform |

### Tier 2: Quality Tiers (For Ranking)

Instead of filtering OUT losing wallets, **tier them**:

| Tier | Criteria | Expected Count | Use Case |
|------|----------|----------------|----------|
| **S-Tier** | P&L > $10K, hit_rate > 60%, 50+ trades | ~100 | Premium copy targets |
| **A-Tier** | P&L > $1K, hit_rate > 55%, 30+ trades | ~500 | Strong performers |
| **B-Tier** | P&L > $0, hit_rate > 50%, 20+ trades | ~2,000 | Profitable |
| **C-Tier** | P&L > -$500, 20+ trades | ~5,000 | Breakeven/learning |
| **Watch** | P&L < -$500, 20+ trades | ~10,000+ | Fade candidates |

### Tier 3: Specialist Tags

Flag wallets by trading style:

| Tag | Criteria | Value |
|-----|----------|-------|
| `crypto_specialist` | >70% trades in Crypto category | Good for crypto copy |
| `politics_specialist` | >70% trades in Politics | Good for election season |
| `high_frequency` | >100 trades/month avg | Active trader |
| `sniper` | Avg hold time < 1 hour | Quick flip style |
| `holder` | Avg hold time > 7 days | Conviction trader |
| `contrarian` | Buys when price < 0.20 | Fade-the-crowd style |

---

## Proposed SQL for V5 Cohort

```sql
CREATE TABLE pm_copytrade_candidates_v5 AS
WITH wallet_stats AS (
  SELECT
    trader_wallet as wallet,

    -- Activity metrics
    count(DISTINCT event_id) as total_trades,
    countDistinct(token_id) as unique_tokens,
    sum(usdc_amount) / 1e6 as total_volume,
    max(trade_time) as last_trade,
    min(trade_time) as first_trade,
    dateDiff('day', min(trade_time), max(trade_time)) as active_days,

    -- Will be recalculated with accurate P&L engine
    0 as total_pnl_placeholder

  FROM pm_trader_events_v2
  WHERE is_deleted = 0
  GROUP BY trader_wallet
  HAVING
    total_trades >= 20
    AND unique_tokens >= 5
    AND total_volume >= 500
    AND last_trade >= now() - INTERVAL 90 DAY
)
SELECT
  wallet,
  total_trades,
  unique_tokens,
  total_volume,
  last_trade,
  first_trade,
  active_days,

  -- Tier assignment (placeholder - will update after P&L calc)
  'pending' as tier,

  -- Timestamps
  now() as created_at

FROM wallet_stats
ORDER BY total_volume DESC
```

---

## Expected Cohort Size

| Filter Stage | Estimated Wallets |
|--------------|-------------------|
| Total traders | 1,741,787 |
| 20+ trades | ~150,000 |
| 5+ unique tokens | ~100,000 |
| $500+ volume | ~50,000 |
| Active last 90 days | ~20,000 |
| **Final V5 cohort** | **~15,000-25,000** |

---

## Implementation Plan

### Phase 1: Build V5 Cohort Structure
1. Create `pm_copytrade_candidates_v5` with relaxed filters
2. Don't calculate P&L yet - just activity metrics
3. Estimate: ~15-25K wallets

### Phase 2: Map All Tokens
1. Find all tokens traded by V5 cohort
2. Correlate to conditions via tx_hash
3. Derive outcome mappings (greedy optimization)
4. Insert to `pm_token_to_condition_patch`

### Phase 3: Calculate Accurate P&L
1. Run validated P&L formula for all V5 wallets
2. Update tier assignments based on actual P&L
3. Add specialist tags

### Phase 4: Rank and Expose
1. Calculate composite score (P&L + consistency + recency)
2. Expose via API for copy trading UI
3. Track performance over time

---

## Open Questions

1. **Include bots?** Some high-volume wallets are clearly bots. Include with `is_bot` flag or exclude?

2. **Minimum recency?** 90 days active is proposed. Too strict? Too loose?

3. **Volume floor?** $500 minimum volume - should this be higher for serious copy targets?

4. **Negative P&L wallets?** Include for "fade" strategies or exclude entirely?

---

## Comparison: V4 vs V5

| Metric | V4 (Current) | V5 (Proposed) |
|--------|--------------|---------------|
| Wallets | 710 | ~20,000 |
| Min trades | 105 | 20 |
| Min positions | 25 | 5 |
| Min P&L | $202 | None (tiered) |
| Recency filter | None | 90 days |
| Tiers | None | S/A/B/C/Watch |
| Specialist tags | None | 6 tags |

---

## Next Steps

1. [ ] Review and approve filters
2. [ ] Build V5 cohort table (activity metrics only)
3. [ ] Complete token mapping for V5 wallets
4. [ ] Calculate accurate P&L for all
5. [ ] Assign tiers and tags
6. [ ] Expose via API
