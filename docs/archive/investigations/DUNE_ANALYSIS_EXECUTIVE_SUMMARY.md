# Dune Polymarket Spellbook Analysis - Executive Summary

**Analyzed:** 15-table Dune Analytics Polymarket architecture (GitHub reference)
**Comparison:** Against Cascadian's current 87-table schema
**Recommendation:** Consolidate to 18 clean tables following Dune's tier pattern

---

## Quick Facts: Dune's Clean Architecture

| Metric | Dune | Cascadian (Current) | Cascadian (Target) |
|--------|------|-------------------|-------------------|
| **Total Tables** | 15 | 87 | 18 |
| **Tier 1 (Raw)** | 4 | ? | 5 |
| **Tier 2 (Base/Mapping)** | 0 | 15-20 | 3 |
| **Tier 3 (Staging)** | 6 | 40+ | 8 |
| **Tier 4 (Analytics)** | 5 | 20+ | 2-3 |
| **Data Flow** | Linear (one direction) | Circular (multiple dependencies) | Linear |
| **P&L Calculation** | Application layer | In 10+ staging tables | Final marts only |
| **Deduplication** | Once at base | Multiple layers | Once at staging |

---

## The Dune Pattern (Copy This)

Dune uses a **four-tier hierarchy** with clear responsibilities:

```
TIER 1: RAW (Blockchain Events)
  ├─ polymarket_polygon_market_trades_raw     (immutable, append-only)
  ├─ polymarket_polygon_positions_raw
  ├─ polymarket_polygon_base_ctf_tokens
  └─ polymarket_polygon_base_market_conditions

TIER 2: BASE/MAPPING (Simple Joins)
  ├─ polymarket_polygon_base_ctf_tokens
  └─ polymarket_polygon_base_market_conditions

TIER 3: STAGING (Enriched, Normalized)
  ├─ polymarket_polygon_market_details        (denormalized for query speed)
  ├─ polymarket_polygon_market_trades         (raw + market context)
  ├─ polymarket_polygon_positions             (raw + market context)
  ├─ polymarket_polygon_users_capital_actions
  ├─ polymarket_polygon_market_outcomes
  └─ polymarket_polygon_market_prices_*

TIER 4: ANALYTICS (Final Query Layer)
  ├─ polymarket_polygon_markets
  ├─ polymarket_polygon_prices_daily
  ├─ polymarket_polygon_prices_hourly
  ├─ polymarket_polygon_prices_latest
  └─ polymarket_polygon_users
```

**Key Rules:**
1. Data flows ONE direction: Raw → Base → Staging → Analytics (no circular deps)
2. Each table has one clear grain (e.g., "one row per trade", "one row per address, token, day")
3. Staging is intentionally denormalized for join speed
4. Final analytics tables are optimized for dashboards
5. All tables are incremental-safe (rerunnable, idempotent)

---

## Critical Insight: P&L Calculation

### Dune's Approach
- **Binary outcomes only** → Simple resolution (outcome 0 or 1)
- **Position snapshots daily** → Final balance is captured
- **No payout vectors in SQL** → Computed in dashboards
- **Formula:** `PnL = final_balance - cost_basis` (implicit)

### Cascadian's Complexity
- **Multi-outcome markets** → Payout vectors (0.25x, 0.75x, etc.)
- **Shares per outcome** → Must track which outcome you own
- **Must compute:** `PnL = shares × (payout_numerator / denominator) - cost_basis`
- **Current problem:** This logic is spread across 10+ staging tables

### Solution for Cascadian
Move all P&L computation to **final marts only**:
- Create `winning_outcomes` table (Tier 4): condition_id → outcome_index, payout_numerators, payout_denominator
- Create `wallet_pnl` table (Tier 4): Apply formula once, final result
- Remove P&L fields from staging tables
- Use staging for **positions + costs** only

---

## Consolidation Strategy (87 → 18)

### What to Keep (From Dune Pattern)
1. **Separate raw tables** (trades_raw, positions_raw, etc.) - append-only, never update
2. **Explicit base/mapping tables** (ctf_token_mapping, condition_metadata, outcome_resolver) - lookup joins
3. **Enriched staging tables** (trades, positions, capital_flows) - join + left-preserve pattern
4. **Final analytics marts** (wallet_pnl, market_pnl, markets, prices) - optimized for queries

### What to Remove
1. **Multiple _raw tables** → Consolidate to one source per data type
2. **Scattered mapping tables** → Consolidate to 3 base tables (ctf, condition, outcome)
3. **Duplicate staging** (trades_enriched, trades_canonical, trades_deduped) → Merge to one
4. **P&L in staging** (wallet_pnl_realized, wallet_pnl_unrealized) → Move to final marts
5. **Deprecated marts** (leaderboard, smart_money, etc.) → Archive if not queried

### The Math
```
Tier 1:  4-5 raw
Tier 2:  3 base/mapping
Tier 3:  8 staging
Tier 4:  2-3 final
─────────────────────
Total:   17-19 tables (vs. 87 today)
```

---

## Design Patterns to Adopt

### Pattern 1: Left-Join Preservation
```sql
-- CORRECT: Preserve all raw rows
SELECT raw.*, enriched.*
FROM raw_table raw
LEFT JOIN enriched_table enriched USING (id)

-- WRONG: Lose rows without enrichment
SELECT raw.*, enriched.*
FROM raw_table raw
INNER JOIN enriched_table enriched USING (id)
```

### Pattern 2: Dedup Once, Inherit Forever
```sql
-- Build once in staging, never recalculate
WITH dedup AS (
  SELECT *,
    ROW_NUMBER() OVER (PARTITION BY condition_id, tx_hash ORDER BY block_time) as rn
  FROM raw_trades
)
SELECT * FROM dedup WHERE rn = 1
-- All downstream queries use this deduplicated source
```

### Pattern 3: Direction Inference (Stable)
```sql
-- Compute BUY/SELL once, mark condition globally
CASE
  WHEN usdc_net > 0 AND token_net > 0 THEN 'BUY'
  WHEN usdc_net < 0 AND token_net < 0 THEN 'SELL'
  ELSE 'UNKNOWN'
END as direction
-- Never recalculate in downstream tables
```

### Pattern 4: Denormalize at Marts Only
```sql
-- Staging: Join when needed for queries
SELECT raw.*, market.name, outcome.label
FROM raw_trades raw
LEFT JOIN markets market USING (condition_id)
LEFT JOIN outcomes outcome USING (outcome_id)

-- Final Mart: Denormalized for dashboard speed
SELECT
  block_time, tx_hash, maker, taker, amount, shares,
  market_name,      -- DUPLICATED (denormalized)
  outcome_label     -- DUPLICATED (denormalized)
FROM staging_trades
```

### Pattern 5: Naming Convention
```
Raw tables:   *_raw              (e.g., trades_raw, positions_raw)
Base/mapping: base_*             (e.g., base_ctf_tokens)
Staging:      {domain}           (e.g., trades, positions, market_details)
Marts:        {domain}_metric    (e.g., wallet_pnl, market_pnl) or {domain} (e.g., markets)
```

---

## Red Flags in Cascadian's Current Schema

1. ✗ **Multiple raw sources** (trades_raw, clob_trades, clob_fills)
   - → Fix: Consolidate to one authoritative source

2. ✗ **P&L in staging** (wallet_pnl_realized, wallet_pnl_unrealized)
   - → Fix: Move to final marts; staging tracks positions only

3. ✗ **Duplicate dedup layers** (trades_deduped, trades_canonical)
   - → Fix: Dedup once in staging, reuse everywhere

4. ✗ **Direction in multiple tables** (multiple `direction` or `side` fields)
   - → Fix: Compute in staging, inherit in marts

5. ✗ **Scattered mapping tables** (condition_id, token, outcome lookups)
   - → Fix: Consolidate to 3 base tables

6. ✗ **No clear grain documentation**
   - → Fix: Mark each table with grain in schema docs

7. ✗ **Circular dependencies** (unclear data flow)
   - → Fix: Ensure one-way flow: raw → base → staging → marts

---

## Implementation Plan

### Phase 1: Audit & Document (1 week)
- [ ] List all 87 tables with their purpose and source
- [ ] Identify authoritative raw tables (mark others as deprecated)
- [ ] Document grain for each table
- [ ] Find circular dependencies

### Phase 2: Build Tier 2 (1 week)
- [ ] Create `base_ctf_tokens` (condition_id, token0, token1)
- [ ] Create `base_market_conditions` (condition_id, oracle, status)
- [ ] Create `base_outcome_resolver` (condition_id, outcome_index, outcome_text)
- [ ] Test: Row counts match source data

### Phase 3: Consolidate Staging (2 weeks)
- [ ] Merge 9 `trades_*` tables → `trades` (one staging table)
- [ ] Merge 6 `positions_*` tables → `positions` (one staging table)
- [ ] Merge 4 `price_*` tables → `prices_hourly`, `prices_daily` (two tables)
- [ ] Merge 3 `capital_*` tables → `capital_flows` (one table)
- [ ] Keep proxy tables separate: `users_safe_proxies`, `users_magic_wallet_proxies`
- [ ] Test: Row counts match original tables (within tolerance)

### Phase 4: Clean Marts (1 week)
- [ ] Keep: `wallet_pnl`, `market_pnl`, `markets`, `prices_latest`, `users`
- [ ] Archive: leaderboard, smart_money, and other deprecated marts
- [ ] Test: Dashboard queries work with new schema

### Phase 5: Validation (1 week)
- [ ] Run full backfill on clean schema
- [ ] Compare PnL values (should match within ±2%)
- [ ] Update application queries
- [ ] Archive old tables
- [ ] Documentation complete

---

## Success Metrics

After consolidation, you should have:

- [x] **17-18 total tables** (down from 87)
- [x] **Clear tier structure:** 5 raw, 3 base, 8 staging, 2 marts
- [x] **One-way data flow:** No circular dependencies
- [x] **Documented grain:** Every table documents its grain
- [x] **Single P&L source:** wallet_pnl and market_pnl are authoritative
- [x] **Idempotent rebuilds:** Any table rerun produces identical results
- [x] **Row count verification:** Old vs. new schema match (±0.5%)
- [x] **PnL accuracy:** Wallet PnL matches old schema (±2%)
- [x] **Application tested:** Dashboards use new schema

---

## Key Files to Reference

These Dune files demonstrate the pattern best:

1. **polymarket_polygon_market_trades_raw.sql** - How to capture raw events
2. **polymarket_polygon_base_ctf_tokens.sql** - How to deduplicate and map
3. **polymarket_polygon_market_details.sql** - How to merge on-chain + API
4. **polymarket_polygon_market_trades.sql** - How to enrich with left joins
5. **polymarket_polygon_positions.sql** - How to join positions to market context

Each file is <100 lines and demonstrates a single responsibility.

---

## Cascadian-Specific Guidance

Unlike Dune's binary outcomes, Cascadian must handle:

1. **Multi-outcome markets** → Store outcome_index alongside outcome_name
2. **Payout vectors** → Defer to final marts only (winning_outcomes table)
3. **Direction inference** → Use NDR rule (documented in CLAUDE.md)
4. **Shares tracking** → Keep in staging (positions + cost_basis)
5. **PnL computation** → Apply formula in final marts only

The pattern remains the same; the complexity is isolated to Tier 4 (marts).

---

## Quick Reference: 5 Design Rules

1. **Raw tables are append-only.** Never update, only append new blocks.
2. **Staging joins with LEFT PRESERVE.** Never lose rows at staging layer.
3. **Denormalization at marts only.** Staging stays normalized.
4. **One-direction data flow.** Raw → Base → Staging → Marts (never circular).
5. **Dedup once, inherit forever.** Don't recalculate dedup downstream.

---

## Documents in This Analysis

- **DUNE_POLYMARKET_SPELLBOOK_ANALYSIS.md** - Full detailed analysis (5000+ words)
- **DUNE_VS_CASCADIAN_MAPPING.md** - Explicit table-by-table mapping (detailed)
- **DUNE_ANALYSIS_EXECUTIVE_SUMMARY.md** - This file (quick reference)

---

## Next Steps

1. **Read:** DUNE_POLYMARKET_SPELLBOOK_ANALYSIS.md (full context)
2. **Audit:** List Cascadian's 87 tables; map to Dune tier pattern
3. **Plan:** Use DUNE_VS_CASCADIAN_MAPPING.md consolidation roadmap
4. **Build:** Follow 5-phase plan (audit → base → staging → marts → validate)
5. **Test:** Verify row counts and PnL accuracy match original schema

**Estimated Time:** 4-5 weeks for complete consolidation + validation

---

**Analysis Date:** 2025-11-07
**Source:** https://github.com/duneanalytics/spellbook
**Reference:** CLAUDE.md, CLAUDE_FINAL_CHECKLIST.md

