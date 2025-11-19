# Polymarket Data Coverage KPI Specification
## General-Purpose Coverage Metrics for Any Wallet/Market

**Version:** 1.0
**Status:** DESIGN SPECIFICATION (Not Yet Implemented)
**Purpose:** Extract lessons from xcnstrategy investigation into reusable coverage KPIs

---

## Executive Summary

This specification defines a standardized set of **coverage quality metrics** that can be computed for any wallet, market, or time period to assess data completeness and reliability. These metrics were extracted from the xcnstrategy reconciliation investigation and generalized for system-wide use.

**Key Principle:** Before showing P&L or analytics to users, verify data coverage is sufficient. If coverage is poor, display warnings or suppress metrics entirely.

---

## Coverage Dimensions

### 1. Trade Ingestion Coverage

**Definition:** What percentage of expected trades have been successfully ingested from external sources?

**Layers:**
```
Ground Truth (Polymarket API)
    ↓
Raw Ingestion (clob_fills table)
    ↓
Canonicalization (pm_trades_canonical_v2)
    ↓
P&L Processing (pm_wallet_market_pnl_v2)
```

**Metrics:**

| Metric ID | Name | Formula | Threshold |
|-----------|------|---------|-----------|
| **TC-01** | CLOB Backfill Coverage | `clob_fills_count / api_trade_count` | >90% = Safe, 50-90% = Warning, <50% = Critical |
| **TC-02** | Canonicalization Rate | `canonical_trades / clob_fills` | >95% = Safe, 80-95% = Warning, <80% = Critical |
| **TC-03** | P&L Processing Rate | `pnl_positions / canonical_trades` | >98% = Safe, 90-98% = Warning, <90% = Critical |
| **TC-04** | End-to-End Coverage | `pnl_positions / api_trade_count` | >85% = Safe, 40-85% = Warning, <40% = Critical |

**Example Query (TC-01):**
```sql
-- For a specific wallet
SELECT
  w.wallet_address,
  w.api_trade_count,           -- From Polymarket API (manual query)
  COUNT(c.id) AS clob_fills_count,
  COUNT(c.id) / w.api_trade_count AS backfill_coverage
FROM wallets_to_audit w
LEFT JOIN clob_fills c ON lower(c.wallet_address) = lower(w.wallet_address)
GROUP BY w.wallet_address, w.api_trade_count;
```

**Example Query (TC-04):**
```sql
-- End-to-end coverage for a wallet
SELECT
  wallet_address,
  api_trade_count,
  COUNT(DISTINCT condition_id_norm) AS pnl_positions,
  COUNT(DISTINCT condition_id_norm) / api_trade_count AS e2e_coverage
FROM (
  SELECT '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b' AS wallet_address,
         496 AS api_trade_count  -- From API
) api_data
LEFT JOIN pm_wallet_market_pnl_v2 pnl
  ON lower(pnl.wallet_address) = lower(api_data.wallet_address);
```

---

### 2. Settlement Data Coverage

**Definition:** What percentage of trades have corresponding settlement/cashflow data?

**Metrics:**

| Metric ID | Name | Formula | Threshold |
|-----------|------|---------|-----------|
| **SC-01** | ERC1155 Transfer Coverage | `erc1155_transfers / canonical_trades` | >80% = Safe, 50-80% = Warning, <50% = Critical |
| **SC-02** | ERC20 Settlement Coverage | `erc20_transfers / canonical_trades` | >70% = Safe, 30-70% = Warning, <30% = Critical |
| **SC-03** | Settlement Completeness | `(erc1155_count + erc20_count) / (2 * trade_count)` | >75% = Safe, 40-75% = Warning, <40% = Critical |

**Example Query (SC-01):**
```sql
-- ERC1155 position transfer coverage
SELECT
  wallet_address,
  COUNT(DISTINCT tx_hash) AS canonical_trades,
  (
    SELECT COUNT(*)
    FROM erc1155_transfers e
    WHERE lower(e.from_address) = lower(t.wallet_address)
       OR lower(e.to_address) = lower(t.wallet_address)
  ) AS erc1155_transfers,
  erc1155_transfers / canonical_trades AS erc1155_coverage
FROM pm_trades_canonical_v2 t
WHERE wallet_address = {wallet:String}
GROUP BY wallet_address;
```

**Example Query (SC-02):**
```sql
-- ERC20 USDC settlement coverage
SELECT
  wallet_address,
  COUNT(*) AS canonical_trades,
  (
    SELECT COUNT(*)
    FROM erc20_transfers_decoded e
    WHERE lower(e.from_address) = lower(t.wallet_address)
       OR lower(e.to_address) = lower(t.wallet_address)
  ) AS erc20_transfers,
  erc20_transfers / canonical_trades AS erc20_coverage
FROM pm_trades_canonical_v2 t
WHERE wallet_address = {wallet:String}
GROUP BY wallet_address;
```

---

### 3. Market Metadata Coverage

**Definition:** What percentage of traded markets have complete metadata (title, resolution, payouts)?

**Metrics:**

| Metric ID | Name | Formula | Threshold |
|-----------|------|---------|-----------|
| **MC-01** | Market Metadata Completeness | `markets_with_metadata / total_markets_traded` | >95% = Safe, 80-95% = Warning, <80% = Critical |
| **MC-02** | Resolution Data Coverage | `markets_with_resolutions / resolved_markets` | >90% = Safe, 70-90% = Warning, <70% = Critical |
| **MC-03** | Payout Vector Coverage | `markets_with_payouts / resolved_markets` | >85% = Safe, 60-85% = Warning, <60% = Critical |

**Example Query (MC-01):**
```sql
-- Market metadata coverage for wallet's markets
SELECT
  wallet_address,
  COUNT(DISTINCT condition_id_norm) AS total_markets_traded,
  COUNT(DISTINCT CASE
    WHEN g.market_id IS NOT NULL THEN pnl.condition_id_norm
  END) AS markets_with_metadata,
  markets_with_metadata / total_markets_traded AS metadata_coverage
FROM pm_wallet_market_pnl_v2 pnl
LEFT JOIN gamma_markets g
  ON pnl.market_id = g.market_id
WHERE wallet_address = {wallet:String}
GROUP BY wallet_address;
```

**Example Query (MC-02):**
```sql
-- Resolution data coverage
SELECT
  wallet_address,
  COUNT(DISTINCT CASE WHEN is_resolved = 1 THEN condition_id_norm END) AS resolved_markets,
  COUNT(DISTINCT CASE
    WHEN is_resolved = 1 AND r.condition_id IS NOT NULL
    THEN pnl.condition_id_norm
  END) AS markets_with_resolutions,
  markets_with_resolutions / resolved_markets AS resolution_coverage
FROM pm_wallet_market_pnl_v2 pnl
LEFT JOIN market_resolutions_final r
  ON pnl.condition_id_norm = lower(r.condition_id)
WHERE wallet_address = {wallet:String}
GROUP BY wallet_address;
```

---

### 4. Temporal Coverage

**Definition:** What time periods have complete vs incomplete data?

**Metrics:**

| Metric ID | Name | Formula | Threshold |
|-----------|------|---------|-----------|
| **TC-05** | Backfill Recency | `days_since_last_ingested_trade` | <7 days = Safe, 7-30 days = Warning, >30 days = Critical |
| **TC-06** | Historical Depth | `days_between_first_and_last_trade` | >365 days = Safe, 180-365 = Warning, <180 = Critical |
| **TC-07** | Monthly Coverage Consistency | `stddev(monthly_trade_counts) / avg(monthly_trade_counts)` | <0.5 = Safe, 0.5-1.5 = Warning, >1.5 = Critical |

**Example Query (TC-05):**
```sql
-- Backfill recency check
SELECT
  wallet_address,
  MAX(timestamp) AS last_trade_timestamp,
  dateDiff('day', MAX(timestamp), now()) AS days_since_last_trade,
  CASE
    WHEN days_since_last_trade < 7 THEN 'Safe'
    WHEN days_since_last_trade < 30 THEN 'Warning'
    ELSE 'Critical'
  END AS recency_status
FROM pm_trades_canonical_v2
WHERE wallet_address = {wallet:String}
GROUP BY wallet_address;
```

**Example Query (TC-07):**
```sql
-- Monthly coverage consistency
WITH monthly_counts AS (
  SELECT
    toStartOfMonth(timestamp) AS month,
    COUNT(*) AS trade_count
  FROM pm_trades_canonical_v2
  WHERE wallet_address = {wallet:String}
  GROUP BY month
)
SELECT
  stddevPop(trade_count) / avg(trade_count) AS coverage_variability,
  CASE
    WHEN coverage_variability < 0.5 THEN 'Safe'
    WHEN coverage_variability < 1.5 THEN 'Warning'
    ELSE 'Critical'
  END AS consistency_status
FROM monthly_counts;
```

---

### 5. Volume Reconciliation

**Definition:** How closely does our data match external ground truth?

**Metrics:**

| Metric ID | Name | Formula | Threshold |
|-----------|------|---------|-----------|
| **VR-01** | Volume Delta (USD) | `abs(our_volume - api_volume)` | <10% = Safe, 10-30% = Warning, >30% = Critical |
| **VR-02** | Trade Count Delta | `abs(our_trades - api_trades)` | <5% = Safe, 5-20% = Warning, >20% = Critical |
| **VR-03** | P&L Sign Agreement | `sign(our_pnl) == sign(api_pnl)` | Match = Safe, Mismatch = Critical |

**Example Query (VR-01):**
```sql
-- Volume reconciliation
SELECT
  our.wallet_address,
  our.total_volume_usd AS our_volume,
  api.volume_usd AS api_volume,
  abs(our.total_volume_usd - api.volume_usd) AS volume_delta,
  abs(our.total_volume_usd - api.volume_usd) / api.volume_usd AS volume_delta_pct,
  CASE
    WHEN volume_delta_pct < 0.10 THEN 'Safe'
    WHEN volume_delta_pct < 0.30 THEN 'Warning'
    ELSE 'Critical'
  END AS reconciliation_status
FROM (
  SELECT
    wallet_address,
    SUM(covered_volume_usd) AS total_volume_usd
  FROM pm_wallet_market_pnl_v2
  WHERE wallet_address = {wallet:String}
  GROUP BY wallet_address
) our
CROSS JOIN (
  SELECT 1383851.59 AS volume_usd  -- From Polymarket API
) api;
```

---

## Coverage Score Calculation

### Composite Coverage Score

**Formula:**
```
coverage_score = (
  0.35 * trade_coverage +
  0.25 * settlement_coverage +
  0.20 * metadata_coverage +
  0.10 * temporal_recency +
  0.10 * volume_reconciliation
)
```

**Weights Rationale:**
- Trade coverage (35%): Most critical - without trades, nothing else matters
- Settlement coverage (25%): Important for P&L verification
- Metadata coverage (20%): Needed for context and display
- Temporal recency (10%): Affects relevance but not accuracy
- Volume reconciliation (10%): Cross-check against ground truth

**Example Query:**
```sql
-- Composite coverage score for a wallet
WITH metrics AS (
  SELECT
    -- TC-04: End-to-end coverage
    (
      SELECT COUNT(DISTINCT condition_id_norm)
      FROM pm_wallet_market_pnl_v2
      WHERE wallet_address = {wallet:String}
    ) / 496.0 AS trade_coverage,

    -- SC-03: Settlement completeness
    (
      (SELECT COUNT(*) FROM erc1155_transfers WHERE from_address = {wallet:String} OR to_address = {wallet:String}) +
      (SELECT COUNT(*) FROM erc20_transfers_decoded WHERE from_address = {wallet:String} OR to_address = {wallet:String})
    ) / (2.0 * 780) AS settlement_coverage,

    -- MC-01: Market metadata completeness
    (
      SELECT COUNT(DISTINCT CASE WHEN g.market_id IS NOT NULL THEN pnl.condition_id_norm END)
      FROM pm_wallet_market_pnl_v2 pnl
      LEFT JOIN gamma_markets g ON pnl.market_id = g.market_id
      WHERE pnl.wallet_address = {wallet:String}
    ) / (
      SELECT COUNT(DISTINCT condition_id_norm)
      FROM pm_wallet_market_pnl_v2
      WHERE wallet_address = {wallet:String}
    ) AS metadata_coverage,

    -- TC-05: Temporal recency (normalized to 0-1)
    GREATEST(0, 1 - (
      dateDiff('day',
        (SELECT MAX(timestamp) FROM pm_trades_canonical_v2 WHERE wallet_address = {wallet:String}),
        now()
      ) / 30.0
    )) AS temporal_recency,

    -- VR-01: Volume reconciliation (normalized to 0-1)
    GREATEST(0, 1 - (
      abs(
        (SELECT SUM(covered_volume_usd) FROM pm_wallet_market_pnl_v2 WHERE wallet_address = {wallet:String}) -
        1383851.59
      ) / 1383851.59
    )) AS volume_reconciliation
)
SELECT
  0.35 * trade_coverage +
  0.25 * settlement_coverage +
  0.20 * metadata_coverage +
  0.10 * temporal_recency +
  0.10 * volume_reconciliation AS coverage_score,

  CASE
    WHEN coverage_score >= 0.85 THEN 'SAFE_TO_SHOW'
    WHEN coverage_score >= 0.50 THEN 'SHOW_WITH_WARNING'
    ELSE 'SUPPRESS_METRICS'
  END AS display_recommendation
FROM metrics;
```

---

## Display Thresholds

### UI Behavior Based on Coverage Score

| Coverage Score | Status | UI Behavior |
|----------------|--------|-------------|
| **≥0.85** | 🟢 SAFE_TO_SHOW | Display all metrics normally with no warnings |
| **0.50-0.84** | 🟡 SHOW_WITH_WARNING | Display metrics with prominent coverage warning banner |
| **<0.50** | 🔴 SUPPRESS_METRICS | Hide P&L/analytics, show "Insufficient data coverage" message |

**Warning Banner Text (Yellow Zone):**
```
⚠️ Data Quality Notice
Coverage: {coverage_score * 100}%
This wallet's data is incomplete. Metrics shown may not reflect true performance.
Missing: {list_missing_components}
```

**Suppression Message (Red Zone):**
```
❌ Insufficient Data Coverage
We have only {coverage_score * 100}% data coverage for this wallet.
Metrics are hidden to prevent misleading information.
[Request Manual Review]
```

---

## Coverage Report Template

### Per-Wallet Coverage Report

```markdown
# Coverage Report: {wallet_address}
**Generated:** {timestamp}
**Overall Score:** {coverage_score} ({status})

## Trade Ingestion Coverage
- API Trade Count: {api_trades}
- CLOB Fills: {clob_fills} ({tc_01}%)
- Canonical Trades: {canonical_trades} ({tc_02}%)
- P&L Positions: {pnl_positions} ({tc_03}%)
- **End-to-End Coverage:** {tc_04}%

## Settlement Coverage
- ERC1155 Transfers: {erc1155_count} ({sc_01}%)
- ERC20 Transfers: {erc20_count} ({sc_02}%)
- **Settlement Completeness:** {sc_03}%

## Market Metadata Coverage
- Markets Traded: {total_markets}
- Markets with Metadata: {markets_with_metadata} ({mc_01}%)
- Markets with Resolutions: {markets_with_resolutions} ({mc_02}%)
- **Metadata Completeness:** {mc_01}%

## Temporal Coverage
- First Trade: {first_trade_date}
- Last Trade: {last_trade_date}
- Days Since Last Trade: {days_since_last}
- **Recency Status:** {tc_05_status}

## Volume Reconciliation
- Our Volume: ${our_volume}
- API Volume: ${api_volume}
- Delta: ${volume_delta} ({volume_delta_pct}%)
- **Reconciliation Status:** {vr_01_status}

## Recommendations
{auto_generated_recommendations}
```

---

## Implementation Notes

### This is a SPECIFICATION only

**DO NOT IMPLEMENT** materialized views or automated scoring until design is approved.

### Recommended Implementation Phases

**Phase 1: Manual Audits (Week 1)**
- Run queries manually for top 10 wallets
- Validate threshold values
- Refine weighting formula

**Phase 2: Ad-Hoc Views (Week 2)**
- Create non-materialized views for on-demand scoring
- Test performance with real queries
- Document query patterns

**Phase 3: Materialized Coverage Tables (Week 3-4)**
- Create `pm_wallet_coverage_scores` materialized view
- Refresh daily via scheduled job
- Add indexes for UI queries

**Phase 4: UI Integration (Week 5-6)**
- Add coverage checks to wallet detail pages
- Implement warning banners
- Create coverage dashboard

---

## Testing Protocol

### Validation Wallets

Test coverage calculations on known wallets:

| Wallet | Expected Coverage | Expected Status |
|--------|------------------|-----------------|
| **xcnstrategy** | ~16% (0.16) | 🔴 SUPPRESS |
| **HolyMoses7** | ~85% (0.85) | 🟢 SAFE |
| **niggemon** | ~60% (0.60) | 🟡 WARNING |

### Validation Checklist

- [ ] TC-01 through TC-07 calculate correctly
- [ ] SC-01 through SC-03 calculate correctly
- [ ] MC-01 through MC-03 calculate correctly
- [ ] VR-01 through VR-03 calculate correctly
- [ ] Composite score formula produces expected values
- [ ] Thresholds trigger correct UI behavior
- [ ] Performance acceptable (<500ms per wallet)

---

## Future Enhancements

### Advanced Metrics (Phase 5+)

**Proxy Attribution Coverage:**
```sql
-- Percentage of wallet's trades captured when including proxy addresses
SELECT
  primary_wallet,
  COUNT(*) AS direct_trades,
  (
    SELECT COUNT(*)
    FROM pm_wallet_identity_map m
    JOIN pm_trades_canonical_v2 t ON lower(t.wallet_address) = lower(m.address)
    WHERE m.cluster_id = primary_wallet
  ) AS cluster_trades,
  cluster_trades / direct_trades AS proxy_coverage_multiplier
FROM pm_trades_canonical_v2
GROUP BY primary_wallet;
```

**Data Freshness Score:**
```sql
-- How "stale" is the data relative to live Polymarket activity?
SELECT
  wallet_address,
  dateDiff('hour', MAX(timestamp), now()) AS hours_stale,
  CASE
    WHEN hours_stale < 1 THEN 1.0
    WHEN hours_stale < 24 THEN 0.8
    WHEN hours_stale < 168 THEN 0.5
    ELSE 0.2
  END AS freshness_score
FROM pm_trades_canonical_v2
GROUP BY wallet_address;
```

---

## Appendix: Example Output

### xcnstrategy Coverage Report

```
# Coverage Report: 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b
**Generated:** 2025-11-16 14:32:00 UTC
**Overall Score:** 0.18 (🔴 SUPPRESS_METRICS)

## Trade Ingestion Coverage
- API Trade Count: 496
- CLOB Fills: 194 (39.1%)
- Canonical Trades: 8 (4.1%)
- P&L Positions: 90 (18.1%)
- **End-to-End Coverage:** 18.1%

## Settlement Coverage
- ERC1155 Transfers: 249 (31.9%)
- ERC20 Transfers: 0 (0.0%)
- **Settlement Completeness:** 16.0%

## Market Metadata Coverage
- Markets Traded: 90
- Markets with Metadata: 76 (84.4%)
- Markets with Resolutions: 90 (100%)
- **Metadata Completeness:** 84.4%

## Temporal Coverage
- First Trade: 2024-08-21
- Last Trade: 2025-10-15
- Days Since Last Trade: 32
- **Recency Status:** 🟡 Warning

## Volume Reconciliation
- Our Volume: $225,572.34
- API Volume: $1,383,851.59
- Delta: $1,158,279.25 (83.7%)
- **Reconciliation Status:** 🔴 Critical

## Recommendations
1. ⚠️ CRITICAL: Extend CLOB backfill to capture missing 302 trades
2. ⚠️ CRITICAL: Investigate ERC20 settlement blind spot (0 transfers despite 780 trades)
3. ⚠️ HIGH: Backfill 14 missing markets from gamma_markets
4. ⚠️ MEDIUM: Implement wallet clustering to capture proxy wallet trades
```

---

**Specification Status:** DESIGN COMPLETE - Awaiting Approval
**Estimated Implementation Time:** 4-6 weeks (phased rollout)
**Estimated Performance Impact:** +50-100ms per wallet detail page load
**Storage Requirements:** ~500KB per 1000 wallets (materialized scores)

---

*Extracted from: xcnstrategy PnL V2 Reconciliation Investigation*
*Prepared for: Data Quality Engineering Team*
