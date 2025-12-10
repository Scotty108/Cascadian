# Trader-Strict Classifier V1 Specification

**Date:** 2025-12-09
**Terminal:** Terminal 2 (Scaling & Hardening)
**Status:** Production

---

## Overview

The Trader-Strict Classifier is a ClickHouse table that partitions all Polymarket wallets into three tiers based on trading behavior complexity. It serves as the gating layer for copy-trading metrics.

**Table:** `trader_strict_classifier_v1_tbl`
**Engine:** MergeTree
**Order By:** (tier, wallet_address)

---

## Tier Definitions

### Tier A: Safe for Metrics

CLOB-dominant wallets with simple, trackable trading patterns.

| Criterion | Value | Rationale |
|-----------|-------|-----------|
| `amm_event_count` | = 0 | No AMM trades (different pricing model) |
| `split_count` | = 0 | No CTF splits (phantom inventory) |
| `merge_count` | = 0 | No CTF merges (compressed history) |
| `transfer_dominance_pct` | < 5% | Low external transfers |
| `unresolved_pct` | < 20% | Mostly realized PnL |
| `clob_event_count` | >= 50 | Minimum activity |
| `mm_likelihood_flag` | = 0 | Not a market maker |

**Use:** Leaderboards, smart money signals, copy-trading

### Tier B: Research Only

CLOB-majority wallets with some complexity.

| Criterion | Value |
|-----------|-------|
| `amm_dominance_pct` | < 10% |
| `ctf_dominance_pct` | < 10% |
| `clob_event_count` | >= 20 |

**Use:** Research cohorts, extended analysis

### Tier X: Excluded

Complex mechanics that cannot be reliably scored.

**Includes:**
- Heavy AMM usage (>10% volume)
- Significant CTF splits/merges
- High external transfer activity
- Market makers (>100K events, >70% maker share)

**Use:** None until specialized engines available

---

## Schema

```sql
CREATE TABLE trader_strict_classifier_v1_tbl
ENGINE = MergeTree()
ORDER BY (tier, wallet_address)
AS SELECT
  -- Identity
  wallet_address String,

  -- CLOB metrics
  clob_event_count UInt64,
  clob_usdc_volume Float64,
  clob_unresolved_count UInt64,

  -- CTF mechanics
  split_count UInt64,
  merge_count UInt64,
  redemption_count UInt64,

  -- AMM metrics
  amm_event_count UInt64,
  amm_usdc_volume Float64,

  -- Role metrics
  maker_count UInt64,
  taker_count UInt64,
  unique_clob_events UInt64,

  -- Transfer metrics
  transfer_count UInt64,

  -- Derived: Classifier unresolved % (payout_norm IS NULL)
  unresolved_pct Float64,

  -- Derived: Benchmark-compatible unresolved % (resolution join)
  unresolved_pct_benchmark_compatible Float64,

  -- Derived percentages
  maker_share_pct Float64,
  amm_dominance_pct Float64,
  transfer_dominance_pct Float64,

  -- Flags
  mm_likelihood_flag UInt8,

  -- Classification
  tier LowCardinality(String),  -- 'A', 'B', 'X'

  -- Metadata
  created_at DateTime
```

---

## Unresolved % Reconciliation

Two definitions of "unresolved" exist:

### 1. Classifier Unresolved (`unresolved_pct`)

```sql
-- Source: pm_unified_ledger_v8_tbl
countIf(payout_norm IS NULL) / clob_event_count
```

Used for tier classification.

### 2. Benchmark-Compatible Unresolved (`unresolved_pct_benchmark_compatible`)

```sql
-- Source: pm_trader_events_v2 + pm_condition_resolutions_norm join
countIf(
  res.payout_numerators IS NULL
  OR res.payout_numerators = ''
  OR length(res.norm_prices) = 0
) / total_events
```

Used for benchmark comparisons. Includes empty-string safety check.

**Important:** Some wallets may be Tier A by classifier but have higher benchmark-unresolved. Use `unresolved_pct_benchmark_compatible` when comparing to V12 benchmark results.

---

## Data Sources

| Table | Use |
|-------|-----|
| `pm_unified_ledger_v8_tbl` | CLOB events, payout_norm, CTF events |
| `pm_trader_events_v2` | Maker/taker roles, event dedup |
| `pm_fpmm_trades` | AMM trades |
| `pm_erc1155_transfers` | External transfers |
| `pm_token_to_condition_map_v5` | Token to condition mapping |
| `pm_condition_resolutions_norm` | Market resolution prices |

---

## Tier Distribution (as of 2025-12-09)

| Tier | Count | % | Description |
|------|-------|---|-------------|
| **A** | ~120K | 7% | Safe for metrics |
| **B** | ~753K | 45% | Research only |
| **X** | ~796K | 48% | Excluded |

---

## Query Examples

### Get Tier A wallets by volume

```sql
SELECT wallet_address, clob_usdc_volume, unresolved_pct
FROM trader_strict_classifier_v1_tbl
WHERE tier = 'A'
ORDER BY clob_usdc_volume DESC
LIMIT 1000
```

### Get Tier A with low benchmark-unresolved (gold candidates)

```sql
SELECT wallet_address, clob_usdc_volume, unresolved_pct_benchmark_compatible
FROM trader_strict_classifier_v1_tbl
WHERE tier = 'A' AND unresolved_pct_benchmark_compatible < 10
ORDER BY clob_usdc_volume DESC
LIMIT 500
```

### Check tier distribution

```sql
SELECT
  tier,
  count() as wallets,
  avg(unresolved_pct) as avg_unres,
  avg(unresolved_pct_benchmark_compatible) as avg_benchmark_unres
FROM trader_strict_classifier_v1_tbl
GROUP BY tier
ORDER BY tier
```

---

## Refresh Schedule

The table should be refreshed:
- **Daily:** For active trading analysis
- **Weekly:** For leaderboard updates
- **On-demand:** After backfill completions

Refresh script: `scripts/pnl/promote-trader-strict-classifier-v1.ts`

```bash
npx tsx scripts/pnl/promote-trader-strict-classifier-v1.ts
```

---

## Integration

### For Copy-Trading Leaderboards

```typescript
const tierAWallets = await clickhouse.query(`
  SELECT wallet_address
  FROM trader_strict_classifier_v1_tbl
  WHERE tier = 'A'
    AND unresolved_pct_benchmark_compatible < 50
  ORDER BY clob_usdc_volume DESC
  LIMIT 10000
`);
```

### For Regression Testing

Use `unresolved_pct_benchmark_compatible < 10` to select gold-set wallets.

### For Research

Tier B wallets can be used with appropriate disclaimers.

---

## Related Files

| File | Purpose |
|------|---------|
| `scripts/pnl/promote-trader-strict-classifier-v1.ts` | Create/refresh table |
| `scripts/pnl/create-trader-strict-classifier.ts` | Original view creator |
| `docs/systems/pnl/COPY_TRADING_METRICS_GATE.md` | Product rules |
| `tmp/gold_pinned_tierA_regression_v1_2025_12_09.json` | 100-wallet gold set |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| v1 | 2025-12-09 | Initial release with dual unresolved % columns |
