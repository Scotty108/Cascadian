# Complete 87-Table Audit: Keep, Archive, or Delete
**Definitive Reference for Schema Consolidation**

**Quick Stats:**
- **Keep:** 5 raw + 0 existing base + 1 existing staging = 6 tables
- **Create:** 3 base + 5 staging + 4 marts = 12 tables
- **Archive:** 20 tables (backups, old versions)
- **Delete:** 49 tables (redundant, temporary, broken)

**Final Count:** 18 tables (6 kept + 12 created)

---

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ KEEP | Keep as-is or with minor updates |
| 🔨 CREATE | Create new consolidated table |
| 📦 ARCHIVE | Move to archive schema (reversible) |
| 🗑️ DELETE | Drop table (not needed) |
| 🔄 CONSOLIDATE | Merge into another table |

---

## TIER 0: RAW TABLES (15 existing → 5 keep)

### Core Raw Tables: ✅ KEEP (5 tables)

| # | Table | Rows | Action | Reason |
|---|-------|------|--------|--------|
| 1 | `trades_raw` | 159.5M | ✅ KEEP | Primary CLOB fills source |
| 2 | `erc1155_transfers` | 388M | ✅ KEEP | Token transfers for positions |
| 3 | `erc20_transfers` | 500M | ✅ KEEP | USDC transfers for cashflows |
| 4 | `market_resolutions_final` | 224K | ✅ KEEP | Authoritative resolution data |
| 5 | `gamma_markets` | 150K | ✅ KEEP | Market catalog from Polymarket API |

### Backup Variants: 📦 ARCHIVE (7 tables)

| # | Table | Rows | Action | Reason |
|---|-------|------|--------|--------|
| 6 | `trades_raw_backup` | ? | 📦 ARCHIVE | Point-in-time backup (keep for recovery) |
| 7 | `trades_raw_old` | ? | 📦 ARCHIVE | Pre-refactor version |
| 8 | `trades_raw_pre_pnl_fix` | ? | 📦 ARCHIVE | Before P&L fix backup |
| 9 | `trades_raw_before_pnl_fix` | ? | 📦 ARCHIVE | Duplicate backup |
| 10 | `market_resolutions_final_backup` | ? | 📦 ARCHIVE | Resolution backup |
| 11 | `erc1155_transfers_staging` | ? | 📦 ARCHIVE | Staging backup |
| 12 | `erc20_transfers_staging` | ? | 📦 ARCHIVE | Staging backup |

### Debug/Broken: 🗑️ DELETE (3 tables)

| # | Table | Rows | Action | Reason |
|---|-------|------|--------|--------|
| 13 | `trades_raw_broken` | ? | 🗑️ DELETE | Temporary debug table |
| 14 | `trades_raw_fixed` | ? | 🗑️ DELETE | Temporary debug table |
| 15 | `trades_raw_with_full_pnl` | ? | 🔄 CONSOLIDATE → trades_raw | Merge P&L columns back |

---

## TIER 1: BASE/MAPPING TABLES (20 existing → 3 create)

### Create New Base Layer: 🔨 CREATE (3 tables)

| # | Table | Grain | Action | Consolidates From |
|---|-------|-------|--------|-------------------|
| 16 | `base_ctf_tokens` | token_id | 🔨 CREATE | ctf_token_map, ctf_condition_meta, ctf_payout_data, api_ctf_bridge (4 tables) |
| 17 | `base_market_conditions` | condition_id | 🔨 CREATE | condition_market_map, gamma_markets partial (2 tables) |
| 18 | `base_outcome_resolver` | condition_id, outcome_text | 🔨 CREATE | Computed from market_outcomes |

### Token/Condition Maps: 🔄 CONSOLIDATE (4 → 1)

| # | Table | Rows | Action | Consolidate To |
|---|-------|------|--------|----------------|
| 19 | `ctf_token_map` | 2K+ | 🔄 CONSOLIDATE | base_ctf_tokens |
| 20 | `ctf_condition_meta` | ? | 🔄 CONSOLIDATE | base_ctf_tokens |
| 21 | `ctf_payout_data` | ? | 🔄 CONSOLIDATE | base_market_conditions (payout vectors) |
| 22 | `api_ctf_bridge` | ? | 🔄 CONSOLIDATE | base_ctf_tokens |
| 23 | `api_ctf_bridge_final` | ? | 🔄 CONSOLIDATE | base_ctf_tokens |

### Market/Condition Maps: 🔄 CONSOLIDATE (3 → 1)

| # | Table | Rows | Action | Consolidate To |
|---|-------|------|--------|----------------|
| 24 | `condition_market_map` | 152K | 🔄 CONSOLIDATE | base_market_conditions |
| 25 | `condition_market_map_bad` | ? | 🗑️ DELETE | Debug table, not needed |
| 26 | `condition_market_map_old` | ? | 📦 ARCHIVE | Old version |

### ID/Key Maps: 🗑️ DELETE (3 tables)

| # | Table | Rows | Action | Reason |
|---|-------|------|--------|--------|
| 27 | `id_bridge` | ? | 🗑️ DELETE | Redundant with base_ctf_tokens |
| 28 | `market_key_map` | 157K | 🗑️ DELETE | Redundant with base_market_conditions |
| 29 | `market_to_condition_dict` | ? | 🗑️ DELETE | Redundant mapping |

### Resolution Temps: 🗑️ DELETE (5 tables)

| # | Table | Rows | Action | Reason |
|---|-------|------|--------|--------|
| 30 | `resolution_candidates` | ? | 🗑️ DELETE | Intermediate query result |
| 31 | `resolution_status_cache` | ? | 🗑️ DELETE | Materialized query, rebuild on demand |
| 32 | `resolutions_temp` | ? | 🗑️ DELETE | Temporary processing table |
| 33 | `staging_resolutions_union` | ? | 🗑️ DELETE | Intermediate union |
| 34 | `temp_onchain_resolutions` | ? | 🗑️ DELETE | Temporary |

### Market Resolution Variants: 🔄 CONSOLIDATE (5 → 1)

| # | Table | Rows | Action | Consolidate To |
|---|-------|------|--------|----------------|
| 35 | `market_resolutions` | ? | 🔄 CONSOLIDATE | market_resolutions_final (already kept) |
| 36 | `market_resolutions_by_market` | ? | 🗑️ DELETE | View alternative |
| 37 | `market_resolutions_ctf` | ? | 🔄 CONSOLIDATE | market_resolutions_final |
| 38 | `market_resolutions_normalized` | ? | 🗑️ DELETE | Redundant normalization |

### Gamma Variants: 🗑️ DELETE (3 tables)

| # | Table | Rows | Action | Reason |
|---|-------|------|--------|--------|
| 39 | `gamma_markets_catalog` | ? | 🗑️ DELETE | Redundant with gamma_markets |
| 40 | `gamma_markets_resolutions` | ? | 🔄 CONSOLIDATE | market_resolutions_final |
| 41 | `gamma_markets_resolved` | ? | 🗑️ DELETE | View alternative |

---

## TIER 2: ENRICHED STAGING (40 existing → 6 create)

### Create New Staging Tables: 🔨 CREATE (6 tables)

| # | Table | Grain | Action | Consolidates From |
|---|-------|-------|--------|-------------------|
| 42 | `trades` | trade_id | 🔨 CREATE | 9 trade tables (see below) |
| 43 | `positions` | wallet, token_id, day | 🔨 CREATE | 4 position tables (see below) |
| 44 | `capital_flows` | wallet, tx_hash | 🔨 CREATE | New (from erc20_transfers) |
| 45 | `market_details` | condition_id | ✅ KEEP + UPDATE | Existing (merge market_outcomes) |
| 46 | `prices_hourly` | condition_id, token_id, hour | 🔨 CREATE | Aggregate from trades |
| 47 | `prices_daily` | condition_id, token_id, day | 🔨 CREATE | Aggregate from trades |

### Trade Enrichment: 🔄 CONSOLIDATE (9 → 1)

| # | Table | Rows | Action | Consolidate To |
|---|-------|------|--------|----------------|
| 48 | `vw_trades_canonical` | 157.5M | 🔄 CONSOLIDATE | trades |
| 49 | `vw_trades_canonical_v2` | 516K | 🔄 CONSOLIDATE | trades |
| 50 | `trades_with_direction` | 82M | 🔄 CONSOLIDATE | trades |
| 51 | `trades_with_recovered_cid` | 82M | 🔄 CONSOLIDATE | trades |
| 52 | `trades_with_pnl` | 516K | 🗑️ DELETE | Move P&L to marts |
| 53 | `trades_with_pnl_old` | ? | 📦 ARCHIVE | Old version |
| 54 | `trade_direction_assignments` | 129.6M | 🔄 CONSOLIDATE | trades (direction computed) |

### Dedup Helpers: 🗑️ DELETE (2 tables)

| # | Table | Rows | Action | Reason |
|---|-------|------|--------|--------|
| 55 | `trades_dedup_mat` | ? | 🗑️ DELETE | Dedup applied once in trades |
| 56 | `trades_dedup_mat_new` | ? | 🗑️ DELETE | Temporary variant |

### Position Tables: 🔄 CONSOLIDATE (4 → 1)

| # | Table | Rows | Action | Consolidate To |
|---|-------|------|--------|----------------|
| 57 | `outcome_positions_v2` | ? | 🔄 CONSOLIDATE | positions |
| 58 | `pm_erc1155_flats` | ? | 🔄 CONSOLIDATE | positions |
| 59 | `pm_trades` | ? | 🗑️ DELETE | Redundant with trades_raw |
| 60 | `wallet_resolution_outcomes` | ? | 🗑️ DELETE | Move to marts |

### Market Metadata: 🔄 CONSOLIDATE (5 → 1)

| # | Table | Rows | Action | Consolidate To |
|---|-------|------|--------|----------------|
| 61 | `market_metadata` | ? | 🔄 CONSOLIDATE | market_details |
| 62 | `market_outcomes` | ? | 🔄 CONSOLIDATE | market_details |
| 63 | `market_outcome_catalog` | ? | 🗑️ DELETE | Redundant |
| 64 | `market_resolution_map` | ? | 🗑️ DELETE | Redundant with base layer |

### Price History: 🔄 CONSOLIDATE (4 → 3)

| # | Table | Rows | Action | Consolidate To / Reason |
|---|-------|------|--------|------------------------|
| 65 | `market_candles_5m` | 8M | ✅ KEEP | High-freq trading (Cascadian-specific) |
| 66 | `market_price_history` | ? | 🔄 CONSOLIDATE | prices_daily |
| 67 | `market_price_momentum` | ? | 🗑️ DELETE | Computed in application |

### Flow Metrics: 🗑️ DELETE (1 table)

| # | Table | Rows | Action | Reason |
|---|-------|------|--------|--------|
| 68 | `market_flow_metrics` | ? | 🗑️ DELETE | Rebuild dynamically in marts |

### Wallet Proxies: ✅ KEEP (1 table)

| # | Table | Rows | Action | Reason |
|---|-------|------|--------|--------|
| 69 | `pm_user_proxy_wallets` | ? | ✅ KEEP (rename) | Rename to users_proxy_wallets |

---

## TIER 3: ANALYTICS MARTS (20+ existing → 4 create)

### Create New Marts: 🔨 CREATE (4 tables)

| # | Table | Grain | Action | Consolidates From |
|---|-------|-------|--------|-------------------|
| 70 | `markets` | condition_id | 🔨 CREATE | Aggregate from market_details + trades |
| 71 | `users` | wallet_address | 🔨 CREATE | From pm_user_proxy_wallets + trades |
| 72 | `wallet_pnl` | wallet_address | 🔨 CREATE | **ALL P&L TABLES** (10+ tables) |
| 73 | `prices_latest` | condition_id, token_id | 🔨 CREATE | Latest from prices_daily |

### P&L Tables: 🔄 CONSOLIDATE (10+ → 1)

| # | Table | Rows | Action | Consolidate To | Issue |
|---|-------|------|--------|----------------|-------|
| 74 | `wallet_pnl_correct` | ? | 🔄 CONSOLIDATE | wallet_pnl | - |
| 75 | `wallet_pnl_summary_final` | ? | 🔄 CONSOLIDATE | wallet_pnl | - |
| 76 | `wallet_realized_pnl_final` | ? | 🔄 CONSOLIDATE | wallet_pnl | - |
| 77 | `wallet_realized_pnl_v2` | 43K | 🔄 CONSOLIDATE | wallet_pnl | 16,267x inflation bug! |
| 78 | `wallet_pnl_summary_v2` | 43K | 🔄 CONSOLIDATE | wallet_pnl | Uses broken v2 |
| 79 | `realized_pnl_by_market_final` | ? | 🗑️ DELETE | Intermediate, recompute |
| 80 | `realized_pnl_corrected_v2` | ? | 🗑️ DELETE | Intermediate |
| 81 | `realized_pnl_by_market_v2` | 500K | 🗑️ DELETE | Index offset bug |
| 82 | `trade_cashflows_v3` | ? | 🗑️ DELETE | 18.7x duplication bug |

### Wallet Metrics: 🗑️ DELETE (8 tables)

| # | Table | Rows | Action | Reason |
|---|-------|------|--------|--------|
| 83 | `wallet_metrics` | ? | 🗑️ DELETE | Rebuild from wallet_pnl + trades |
| 84 | `wallet_metrics_v1` | ? | 📦 ARCHIVE | Old version |
| 85 | `wallet_metrics_v1_backup` | ? | 📦 ARCHIVE | Backup |
| 86 | `wallet_metrics_v1_backup_27k` | ? | 📦 ARCHIVE | Backup variant |
| 87 | `wallet_metrics_v1_backup_pre_universal` | ? | 📦 ARCHIVE | Backup variant |
| 88 | `wallet_metrics_by_category` | ? | 🗑️ DELETE | Rebuild dynamically |
| 89 | `wallet_metrics_complete` | ? | 🗑️ DELETE | Rebuild dynamically |
| 90 | `wallet_category_performance` | ? | 🗑️ DELETE | Rebuild dynamically |

### Category Analytics: 🗑️ DELETE (3 tables)

| # | Table | Rows | Action | Reason |
|---|-------|------|--------|--------|
| 91 | `category_analytics` | ? | 🗑️ DELETE | Rebuild from trades by category |
| 92 | `category_leaders_v1` | ? | 🗑️ DELETE | Rebuild dynamically |
| 93 | `category_stats` | ? | 🗑️ DELETE | Rebuild dynamically |

### Signals/Strategy: 🗑️ DELETE (3 tables)

| # | Table | Rows | Action | Reason |
|---|-------|------|--------|--------|
| 94 | `elite_trade_attributions` | ? | 🗑️ DELETE | Computed in application |
| 95 | `fired_signals` | ? | 🗑️ DELETE | Computed in application |
| 96 | `momentum_trading_signals` | ? | 🗑️ DELETE | Computed in application |

---

## UTILITY/OPERATIONAL TABLES (keep separate)

### Keep Operational: ✅ KEEP (3 tables)

| # | Table | Purpose | Action |
|---|-------|---------|--------|
| 97 | `backfill_checkpoint` | Track backfill progress | ✅ KEEP |
| 98 | `worker_heartbeats` | Monitor workers | ✅ KEEP |
| 99 | `schema_migrations` | Track schema versions | ✅ KEEP |

### Dimension Tables: 🔄 CONSOLIDATE (3 tables)

| # | Table | Rows | Action | Consolidate To |
|---|-------|------|--------|----------------|
| 100 | `events_dim` | 5.8K | ✅ KEEP | Keep as dimension |
| 101 | `markets_dim` | 5.8K | 🗑️ DELETE | Redundant with markets mart |
| 102 | `wallets_dim` | ? | 🗑️ DELETE | Redundant with users mart |

### Temporary/Debug: 🗑️ DELETE (2 tables)

| # | Table | Rows | Action | Reason |
|---|-------|------|--------|--------|
| 103 | `price_snapshots_10s` | ? | 🗑️ DELETE | Not used in production |
| 104 | `tmp_repair_cids` | ? | 🗑️ DELETE | Temporary repair table |

---

## SUMMARY BY ACTION

### ✅ KEEP (6 tables)
1. trades_raw
2. erc1155_transfers
3. erc20_transfers
4. market_resolutions_final
5. gamma_markets
6. market_candles_5m (Cascadian-specific)
7. market_details (existing, will update)
8. pm_user_proxy_wallets (rename to users_proxy_wallets)
9. backfill_checkpoint
10. worker_heartbeats
11. schema_migrations
12. events_dim

**Total: 12 existing tables kept**

### 🔨 CREATE (12 new tables)
**Tier 1 Base:**
1. base_ctf_tokens
2. base_market_conditions
3. base_outcome_resolver

**Tier 2 Staging:**
4. trades (consolidates 9 tables)
5. positions (consolidates 4 tables)
6. capital_flows (new)
7. prices_hourly (new)
8. prices_daily (new)

**Tier 3 Marts:**
9. markets (new)
10. users (new)
11. wallet_pnl (consolidates 10+ tables)
12. prices_latest (new)

**Total: 12 new tables created**

### 📦 ARCHIVE (20 tables)
- All backup variants (7 tables)
- All old versions (5 tables)
- All pre-fix snapshots (5 tables)
- All v1 metric backups (3 tables)

### 🗑️ DELETE (49 tables)
- Debug/broken tables (5 tables)
- Redundant mappings (10 tables)
- Intermediate computations (15 tables)
- Deprecated marts (19 tables)

---

## FINAL SCHEMA: 18 TABLES

### Tier 0: Raw (5 tables)
- trades_raw
- erc1155_transfers
- erc20_transfers
- market_resolutions_final
- gamma_markets

### Tier 1: Base (3 tables)
- base_ctf_tokens
- base_market_conditions
- base_outcome_resolver

### Tier 2: Staging (6 tables)
- trades
- positions
- capital_flows
- market_details
- prices_hourly
- prices_daily

### Tier 3: Marts (4 tables)
- markets
- users
- wallet_pnl
- prices_latest

**Plus 4 operational tables:** backfill_checkpoint, worker_heartbeats, schema_migrations, events_dim

---

## VALIDATION CHECKLIST

For each consolidated table, verify:

- [ ] Row count matches source (±0.1%)
- [ ] All foreign keys resolve
- [ ] Indexes created for common queries
- [ ] Sample queries return correct results
- [ ] Performance benchmarks pass

---

## NOTES

### Why Keep market_candles_5m?
- Cascadian-specific feature (high-frequency trading)
- Dune doesn't have sub-hourly granularity
- Only 8M rows (manageable)
- Used by momentum trading strategies

### Why Create base_outcome_resolver?
- Complex logic: outcome text → outcome index
- Used in P&L calculation (critical path)
- Better to precompute and cache
- Dune does this implicitly in application

### Why Only 1 P&L Table?
- Current: 10+ competing formulas
- Result: 16,267x inflation bug
- Solution: Single source of truth
- All other P&L computations from this mart

---

**Document Status:** Complete table-by-table audit
**Next Step:** Review and approve, then begin Phase 0
**Contact:** Database Architect for questions
