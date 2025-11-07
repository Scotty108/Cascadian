# Dune Spellbook → Cascadian Schema Mapping

**Purpose:** Explicitly map Dune's clean 15-table architecture to Cascadian's 87 tables, identifying consolidation opportunities and anti-patterns.

---

## Architecture Comparison Diagram

```
DUNE (15 TABLES - CLEAN)          CASCADIAN (87 TABLES - MESSY)

Tier 1: Raw (4)                   Tier 1: Raw (?)
├─ market_trades_raw              ├─ trades_raw or clob_trades, clob_fills
├─ positions_raw                  ├─ positions_raw, erc1155_balances_daily
├─ base_ctf_tokens                ├─ ctf_token_registrations, token_mappings, ctf_listings
└─ base_market_conditions         └─ (scattered across condition_id tables?)

Tier 2: Base/Mapping (0)          Tier 2: Base/Mapping (many)
                                  ├─ condition_id_normalization
                                  ├─ token_pair_mappings
                                  ├─ outcome_resolution_maps
                                  ├─ market_metadata_enrichments
                                  └─ (deduplicated trade id layers)

Tier 3: Staging (6)               Tier 3: Staging (40+)
├─ market_details                 ├─ trades_enriched, trades_with_fees
├─ market_trades                  ├─ positions_with_market, positions_daily_snapshots
├─ positions                      ├─ market_details, market_conditions, market_outcomes
├─ users_capital_actions          ├─ capital_flows_deposits, capital_flows_withdrawals
├─ market_outcomes                ├─ user_proxies, safe_wallets, magic_wallets
└─ market_prices_*                ├─ price_history_hourly, price_history_daily
                                  ├─ trades_deduped, trades_canonical, trades_with_direction
                                  ├─ wallet_pnl_realized, wallet_pnl_unrealized
                                  ├─ outcome_winning_index, outcome_payout_vectors
                                  └─ [20+ more intermediate tables]

Tier 4: Analytics (5)             Tier 4: Analytics (20+)
├─ markets                        ├─ wallet_pnl, wallet_positions_final
├─ prices_daily                   ├─ market_pnl_summary, market_trade_summary
├─ prices_hourly                  ├─ leaderboard_metrics, wallet_smart_money_scores
├─ prices_latest                  └─ [15+ more reporting tables]
└─ users
```

---

## Detailed Table Mapping

### TIER 1: RAW/IMMUTABLE BLOCKCHAIN DATA

**Dune Pattern:** 4 raw tables capturing events directly from blockchain

| Dune Table | Cascadian Equivalent(s) | Status | Consolidation |
|-----------|------------------------|--------|---|
| `market_trades_raw` | `trades_raw` OR `clob_trades` OR `clob_fills` | Ambiguous | CONSOLIDATE: Choose one source table, alias others to it |
| `positions_raw` | `erc1155_balances_daily` OR `positions_raw` OR `wallet_balances_snapshots` | Multiple sources | CONSOLIDATE: One daily snapshot table, append-only |
| `base_ctf_tokens` | `ctf_token_registrations` OR `token_pair_mappings` OR `ctf_listings` | Scattered | CONSOLIDATE: Single immutable mapping table |
| `base_market_conditions` | `condition_registrations` OR `market_condition_events` OR Missing? | Unclear | CREATE: If missing, build from on-chain events |

**Action Items:**
1. Audit which table is the authoritative raw source for each data type
2. Mark authoritative table as `_raw`, deprecate alternatives
3. Document deduplication logic (first occurrence? latest? union?)

---

### TIER 2: BASE/MAPPING TABLES

**Dune Pattern:** 0 base tables (direct: raw → staging)

**Cascadian Current:** ~15-20 intermediate mapping tables (fragmented)

| Purpose | Cascadian Tables | Dune Equivalent | Recommendation |
|---------|------------------|-----------------|---|
| Token → Outcome Mapping | `token_outcome_mapping`, `ctf_token_index_lookup`, `condition_token_outcome_map` | `base_ctf_tokens` | CONSOLIDATE into single `ctf_token_mapping` table |
| Condition → Market Mapping | `condition_id_normalization`, `market_condition_details`, `condition_metadata` | `base_market_conditions` | CONSOLIDATE into single `condition_metadata` table |
| Outcome Text → Index Mapping | `outcome_resolver_map`, `resolved_outcome_index_map`, `outcome_labels` | (implicit in market_details) | CREATE single `outcome_resolver_map` table |
| Wallet Proxy Mapping | `magic_wallet_proxies`, `safe_wallet_proxies`, `user_proxy_mapping` | `users_safe_proxies`, `users_magic_wallet_proxies` | KEEP SEPARATE (Dune pattern) - easier to debug |

**Action Items:**
1. Create canonical Tier 2 tables (consolidate 15→3)
2. Document each table's grain and unique key
3. Mark as `base_*` to signal "derived from raw, immutable"

---

### TIER 3: STAGING/ENRICHMENT TABLES

**Dune Pattern:** 6 staging tables (clear grain, enriched with joins)

**Cascadian Current:** 40+ staging tables (many duplicative)

#### Cluster A: Trade Enrichment

| Dune | Cascadian (Should Keep) | Cascadian (Duplicate/Remove) | Action |
|------|------------------------|------------------------|--------|
| `market_trades` | `trades_enriched` | `trades_with_fees`, `trades_with_direction`, `trades_canonical`, `trades_deduped` | CONSOLIDATE: trades_enriched with all fields; remove duplicates |

**Recommended trades_enriched schema:**
```sql
SELECT
  -- Raw event data
  block_time, tx_hash, evt_index, action,
  -- Market mapping
  condition_id, token_id, outcome_index,
  -- Trade details (normalized)
  maker, taker, amount, shares, price, fee,
  -- Computed fields
  direction, -- BUY/SELL (computed)
  outcome_name, market_question -- from enrichment
FROM trades_raw
LEFT JOIN ctf_token_mapping USING (condition_id, token_id)
LEFT JOIN outcome_resolver_map USING (condition_id, outcome_index)
```

#### Cluster B: Position Enrichment

| Dune | Cascadian (Should Keep) | Cascadian (Duplicate/Remove) | Action |
|------|------------------------|------------------------|--------|
| `positions` | `positions_enriched` | `positions_daily_snapshots`, `wallet_balances_historical`, `positions_with_market` | CONSOLIDATE: positions_enriched with market context only |

**Recommended positions_enriched schema:**
```sql
SELECT
  -- Raw snapshot
  day, address, token_id, balance,
  -- Market mapping
  condition_id, outcome_index,
  -- Market context (denormalized per Dune)
  market_question, outcome_name, market_status, resolved_on_timestamp
FROM positions_raw
LEFT JOIN ctf_token_mapping USING (token_id)
LEFT JOIN market_details USING (condition_id)
```

#### Cluster C: Market Metadata Enrichment

| Dune | Cascadian (Should Keep) | Action |
|------|------------------------|--------|
| `market_details` (API + on-chain merged) | `market_details` OR `market_metadata` (pick one) | CONSOLIDATE: Ensure API + on-chain merged in one table |
| (implicit in positions/trades) | `market_conditions`, `market_outcomes`, `market_resolutions` | MOVE TO MARTS: Don't enrich every staging table with these |

#### Cluster D: User/Capital Flows

| Dune | Cascadian (Should Keep) | Cascadian (Duplicate/Remove) | Action |
|------|------------------------|------------------------|--------|
| `users_capital_actions` | `capital_flows` | `deposits`, `withdrawals`, `conversions` (separate) | CONSOLIDATE: Single capital_flows table with action_type |
| `users_safe_proxies`, `users_magic_wallet_proxies` | (separate tables) | `user_proxies_unified` | KEEP SEPARATE per Dune: easier to debug specific proxy type |

#### Cluster E: Aggregations (Time-Series)

| Dune | Cascadian (Should Keep) | Action |
|------|------------------------|--------|
| `market_prices_hourly`, `market_prices_daily` | `price_history_hourly`, `price_history_daily` | CONSOLIDATE: Both from trades; test for consistency |

**Action Items:**
1. For each Cascadian staging table, identify its Dune equivalent
2. If no equivalent, ask: "Is this a final computation (→move to marts) or enrichment (→consolidate)?"
3. Target: Reduce 40→8 staging tables

---

### TIER 4: ANALYTICS MARTS (Final Output)

**Dune Pattern:** 5 marts (markets, prices_daily, prices_hourly, prices_latest, users)

**Cascadian Current:** 20+ marts (many redundant or unsupported)

#### Recommended Marts for Cascadian

| Category | Mart Table | Grain | Source | Purpose |
|----------|-----------|-------|--------|---------|
| Markets | `markets` | one row per condition_id | market_details | Directory & metadata |
| Prices | `prices_daily` | one row per condition_id, token_id, day | trades_enriched aggregate | Time-series analytics |
| Prices | `prices_latest` | one row per condition_id, token_id | prices_daily latest | Dashboard queries |
| Users | `users` | one row per address | users_safe_proxies UNION users_magic_wallet_proxies | Unified user directory |
| **NEW:** P&L | `wallet_pnl` | one row per address, condition_id | positions × payouts + cost_basis | Core analytics |
| **NEW:** P&L | `market_pnl` | one row per condition_id | SUM(wallet_pnl) | Market-level rollup |

**Current Cascadian Marts to Deprecate:**
- `wallet_pnl_realized` → Consolidate into `wallet_pnl`
- `wallet_pnl_unrealized` → Consolidate into `wallet_pnl`
- `leaderboard_metrics` → Build dynamically from marts
- `smart_money_scores` → Build dynamically from marts
- (20+ more redundant marts) → Archive

**Action Items:**
1. Identify which marts are actually queried by the application
2. Consolidate redundant P&L tables (realized + unrealized → one table with both)
3. Remove static marts; build dashboards dynamically from base marts
4. Document mart grain and uniqueness constraint

---

## Critical Differences: Dune vs. Cascadian

### 1. P&L Calculation Location

| System | Approach | Issue |
|--------|----------|-------|
| **Dune** | P&L in application/dashboards, not in SQL | Clean separation of concerns |
| **Cascadian (Current)** | P&L in 10+ staging tables (realized, unrealized, by wallet, by market, etc.) | Redundant, hard to maintain |
| **Cascadian (Should Be)** | P&L computed in final marts only, sourced from positions + payout vectors | Single source of truth |

**Recommendation:** Move all P&L logic to final `wallet_pnl` and `market_pnl` marts. Staging tables should not contain payout vectors or payout_numerator/denominator.

### 2. Deduplication Strategy

| System | Approach | Issue |
|--------|----------|-------|
| **Dune** | Dedup at base layer with ROW_NUMBER + PARTITION | Applied once, inherited by all downstream |
| **Cascadian (Current)** | Multiple dedup layers (trades_deduped, trades_canonical, etc.) | Unclear which is authoritative |
| **Cascadian (Should Be)** | Dedup in `trades_enriched` only, all downstream tables inherit | Single dedup point |

**Recommendation:** Apply dedup in Tier 3 (staging), not repeated in multiple intermediate tables.

### 3. Direction Inference (BUY/SELL)

| System | Approach | Issue |
|--------|----------|-------|
| **Dune** | Implicit in CLOB event (can infer from maker/taker roles) | Not calculated in SQL |
| **Cascadian (Current)** | Multiple `*_direction` fields in different tables | Inconsistent calculations |
| **Cascadian (Should Be)** | Computed in trades_enriched using stable formula | Stable, inherited by all downstream |

**Recommendation:** Document NDR (Net Direction Rule) once; apply in trades_enriched; never recalculate downstream.

### 4. Outcome Resolution & Payout Vectors

| System | Approach | Issue |
|--------|----------|-------|
| **Dune** | Binary outcomes; stored in market_outcomes table | Straightforward |
| **Cascadian (Current)** | Multi-outcome with payout vectors; scattered across tables | Complex, hard to validate |
| **Cascadian (Should Be)** | Payout vectors in winning_outcomes (Tier 4); used only in final marts | Isolated from staging |

**Recommendation:** Create separate `winning_outcomes` table (Tier 4) with payout_numerators, payout_denominator. Use only in final PnL marts.

---

## Consolidation Roadmap (87 → 18 Tables)

### Phase 1: Freeze & Document Raw (Week 1)
- [ ] Audit all _raw tables; consolidate to 4-5 sources
- [ ] Document each raw table's grain, uniqueness constraint, dedup logic
- [ ] Mark as append-only; block UPDATEs/DELETEs
- [ ] **Result:** 87 → 50 tables

### Phase 2: Build Clean Tier 2 (Week 2)
- [ ] Create `ctf_token_mapping` (condition_id → token0, token1)
- [ ] Create `condition_metadata` (condition_id → oracle, status)
- [ ] Create `outcome_resolver_map` (condition_id, outcome_text → outcome_index)
- [ ] **Result:** 50 → 40 tables

### Phase 3: Consolidate Staging (Week 3-4)
- [ ] Consolidate `trades_*` → `trades_enriched` (9 tables → 1)
- [ ] Consolidate `positions_*` → `positions_enriched` (6 tables → 1)
- [ ] Consolidate `price_*` → `prices_hourly`, `prices_daily` (4 tables → 2)
- [ ] Consolidate `capital_*` → `capital_flows` (3 tables → 1)
- [ ] Consolidate user proxies into 2 separate tables (keep separate per Dune)
- [ ] **Result:** 40 → 18 tables

### Phase 4: Clean Marts (Week 4-5)
- [ ] Identify core marts (6-8 total): markets, prices_*, users, wallet_pnl, market_pnl
- [ ] Deprecate leaderboard/smart_money marts (build dynamically)
- [ ] Archive old marts to `marts_archive/`
- [ ] Document each mart's refresh cadence
- [ ] **Result:** 18 → 12 final tables

### Phase 5: Validate & Test (Week 5)
- [ ] Run full backfill on clean schema
- [ ] Compare row counts to old schema (verify no data loss)
- [ ] Update application queries to use new marts
- [ ] Archive old schema files
- [ ] **Result:** 12 final tables, validated

---

## Checklist: Table Consolidation

For each Cascadian table, ask:

- [ ] **Is it raw?** (Source = blockchain events)
  - YES → Consolidate with other _raw tables; keep only 4-5 sources
  - NO → Continue below

- [ ] **Is it a simple map/join?** (e.g., condition_id → token pair)
  - YES → Move to Tier 2 base_* tables; 3-4 total
  - NO → Continue below

- [ ] **Is it enriched staging?** (raw + left join + map)
  - YES → Consolidate with similar enrichment tables; 8 total
  - NO → Continue below

- [ ] **Is it time-series aggregation?** (e.g., daily prices)
  - YES → Keep in staging if intermediate; move to marts if final
  - NO → Continue below

- [ ] **Is it final P&L?** (e.g., wallet_pnl, market_pnl)
  - YES → Keep in Tier 4 (marts); 2-3 total
  - NO → Continue below

- [ ] **Is it a deprecated mart?** (e.g., leaderboard_metrics, smart_money_scores)
  - YES → Archive to `marts_archive/`
  - NO → Continue below

- [ ] **Unknown purpose?**
  - YES → INVESTIGATE: Search for queries using this table
  - If not used → ARCHIVE
  - If used → CONSOLIDATE with logical peer

---

## Naming Convention Fixes

### Current Issues

1. **No tier prefixes:** Can't distinguish raw from marts
   - `trades_raw`, `trades_enriched`, `trades_canonical`, `trades_deduped` (all similar but different purposes)

2. **No consistent pattern:** Mix of `_raw`, `_enriched`, `_with_*`, `_by_*`
   - Should be: tier level only, not purpose

3. **Outcome reference inconsistent:** `outcome_index`, `outcome_id`, `outcome_name`, `token_outcome`
   - Should standardize to: outcome_index (from payout vector), outcome_name (descriptive)

### Recommended Fixes

| Current | New | Tier | Reason |
|---------|-----|------|--------|
| `trades_raw` | `trades_raw` | 1 | Keep; clear |
| `trades_enriched` | `trades` | 3 | Drop `_enriched`; tier is implicit |
| `trades_canonical` | → `trades` | 3 | Consolidate |
| `trades_deduped` | → `trades` | 3 | Consolidate |
| `positions_raw` | `positions_raw` | 1 | Keep; clear |
| `positions_with_market` | `positions` | 3 | Standardize naming |
| `ctf_token_mapping` | `base_ctf_tokens` | 2 | Add `base_` prefix |
| `outcome_resolver_map` | `base_outcome_resolver` | 2 | Add `base_` prefix |
| `condition_metadata` | `base_market_conditions` | 2 | Align with Dune |
| `market_details` | `market_details` | 3 | Keep (already good) |
| `capital_flows` | `capital_flows` | 3 | Keep (already good) |
| `users_safe_proxies` | `users_safe_proxies` | 3 | Keep (already good) |
| `users_magic_wallet_proxies` | `users_magic_wallet_proxies` | 3 | Keep (already good) |
| `users` | `users` | 4 | Keep (mart) |
| `wallet_pnl` | `wallet_pnl` | 4 | Keep (mart) |
| `market_pnl` | `market_pnl` | 4 | Keep (mart) |

---

## Validation Checklist

After consolidation, verify:

- [ ] All 18 tables follow grain documented in schema
- [ ] No circular dependencies (data flows one direction only)
- [ ] All joins are explicit and documented
- [ ] Raw tables never updated, only appended
- [ ] Tier 2 tables are recomputable from Tier 1
- [ ] Tier 3 tables are recomputable from Tier 1+2
- [ ] Tier 4 tables are recomputable from Tier 1+2+3
- [ ] Row counts match original schema (no data loss)
- [ ] PnL values match within tolerance (±2%)
- [ ] Application queries use new schema without changes
- [ ] Documentation updated for all 18 tables

---

## References

- **Dune Reference:** https://github.com/duneanalytics/spellbook/tree/main/dbt_subprojects/daily_spellbook/models/_projects/polymarket/polygon
- **Cascadian Current:** `/lib/clickhouse/` (87 tables)
- **Analysis:** `DUNE_POLYMARKET_SPELLBOOK_ANALYSIS.md`

