# V12 Tier A Benchmark Report - 2000 Wallets

**Date:** 2025-12-09
**Terminal:** Terminal 2 (Scaling & Hardening)
**Status:** Production-Ready

---

## Executive Summary

This benchmark validates the V12 Synthetic Realized PnL formula across 2,000 Tier A wallets. The results demonstrate the formula's production readiness for copy-trading leaderboards.

### Key Results

| Metric | Value |
|--------|-------|
| **Total Wallets** | 2,000 |
| **Computation Success** | 100% |
| **Comparable (<50% unresolved)** | 1,680 (84.0%) |
| **Median Unresolved %** | 6.3% |
| **Average Unresolved %** | 19.8% |

---

## Sampling Strategy

The benchmark uses a mixed sampling approach to ensure representative coverage:

| Sample Type | Count | Rationale |
|-------------|-------|-----------|
| **Top by CLOB Volume** | 1,000 | Validates high-value wallets |
| **Random Sample** | 1,000 | Validates long-tail distribution |

---

## PnL Distribution

### Overall Statistics

| Metric | Value |
|--------|-------|
| Profitable Wallets | 977 (48.9%) |
| Unprofitable Wallets | 1,023 (51.1%) |
| **Total PnL (All)** | **$4,444,536.23** |
| Min PnL | -$4,008,607.65 |
| Max PnL | $7,756,978.44 |

### By Sample Type

| Sample | Avg Unresolved % | Total PnL | Interpretation |
|--------|------------------|-----------|----------------|
| Top 1000 (volume) | 16.4% | $4,768,856.38 | High-volume traders are net profitable |
| Random 1000 | 23.2% | -$324,320.15 | Long-tail traders are net losers |

**Key Insight:** The volume-weighted top traders show strong aggregate profitability ($4.77M), while random small traders collectively lose money. This aligns with market dynamics where skilled traders accumulate volume.

---

## Unresolved Distribution

| Bucket | Count | Percentage |
|--------|-------|------------|
| 0-10% unresolved | ~1,100 | ~55% |
| 10-20% unresolved | ~350 | ~17.5% |
| 20-50% unresolved | ~230 | ~11.5% |
| >50% unresolved | 320 | 16% |

**Recommendation:** Filter leaderboards to wallets with <50% unresolved for comparable metrics. 84% of Tier A qualifies.

---

## Formula Specification

The V12 Synthetic Realized formula used:

```sql
SELECT
  sumIf(
    d.usdc_delta + d.token_delta * arrayElement(res.norm_prices, toInt32(m.outcome_index + 1)),
    res.raw_numerators IS NOT NULL
    AND res.raw_numerators != ''
    AND length(res.norm_prices) > 0
    AND m.outcome_index IS NOT NULL
  ) as realized_pnl
FROM (
  SELECT
    event_id,
    argMax(token_id, trade_time) as tok_id,
    argMax(if(side = 'buy', -usdc_amount, usdc_amount), trade_time) / 1000000.0 as usdc_delta,
    argMax(if(side = 'buy', token_amount, -token_amount), trade_time) / 1000000.0 as token_delta
  FROM pm_trader_events_v2
  WHERE trader_wallet = {wallet} AND is_deleted = 0
  GROUP BY event_id
) d
LEFT JOIN pm_token_to_condition_map_v5 m ON d.tok_id = m.token_id_dec
LEFT JOIN pm_condition_resolutions_norm res ON m.condition_id = res.condition_id
```

**Key Components:**
1. **CLOB deduplication:** `GROUP BY event_id` prevents double-counting
2. **Sign convention:** Buys are negative USDC (cost), sells are positive (revenue)
3. **Resolution lookup:** Uses `pm_condition_resolutions_norm.norm_prices` for payout
4. **Array indexing:** ClickHouse is 1-indexed, so `outcome_index + 1`

---

## Data Sources

| Table | Purpose |
|-------|---------|
| `pm_trader_events_v2` | CLOB trade events |
| `pm_token_to_condition_map_v5` | Token → condition mapping |
| `pm_condition_resolutions_norm` | Market resolution prices |
| `trader_strict_classifier_v1` | Tier classification |

---

## Views Created

The metrics layer views for copy-trading are now available:

| View | Purpose |
|------|---------|
| `vw_tierA_realized_pnl_summary` | Total synthetic realized PnL per wallet |
| `vw_tierA_pnl_by_category` | PnL broken down by market category |
| `vw_tierA_win_loss_stats` | Per-market win/loss for omega calculation |
| `vw_tierA_omega_ratio` | Overall omega ratio (gains/losses) |
| `vw_tierA_omega_ratio_by_category` | Omega ratio by market category |
| `vw_tierA_time_in_trade` | Average holding period metrics |

---

## Low-B Universe Gating

The Tier A gated universe has been generated:

| Metric | Value |
|--------|-------|
| **Eligible Wallets** | 120,347 |
| **Total CLOB Volume** | $4.6B |
| **Avg Events per Wallet** | 371 |
| **Avg Unresolved %** | 0.0% (classifier definition) |
| **Avg Maker Share %** | 55.1% |

### Volume Distribution

| Bucket | Count | % of Total |
|--------|-------|------------|
| >$10M | 39 | 0.0% |
| $1M-$10M | 540 | 0.4% |
| $100K-$1M | 4,328 | 3.6% |
| $10K-$100K | 35,338 | 29.4% |
| <$10K | 80,102 | 66.6% |

---

## Production Readiness

### Validation Criteria ✓

- [x] Formula computes without errors for all 2,000 wallets
- [x] 84% of wallets have comparable metrics (<50% unresolved)
- [x] PnL distribution is reasonable (near 50/50 profitable/unprofitable)
- [x] High-volume wallets show expected aggregate profitability
- [x] Metrics layer views created and accessible

### Next Steps

1. **Materialize classifier:** Promote `trader_strict_classifier_v1` to `_tbl` for faster queries
2. **Build leaderboard API:** Use views for ranking endpoints
3. **Add win rate column:** Enhance omega ratio view with win count
4. **Weekly refresh:** Schedule cohort regeneration for new wallets

---

## Files Generated

| File | Contents |
|------|----------|
| `tmp/v12_tierA_benchmark_2000_2025_12_09.json` | Full benchmark results |
| `tmp/lowB_tierA_wallets_2025_12_09.json` | Gated universe (120K wallets) |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| v1 | 2025-12-09 | Initial 2000-wallet benchmark |
