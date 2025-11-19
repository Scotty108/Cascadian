# VIEW AUDIT - 98 TOTAL VIEWS

**Databases:** `default` (54 views), `cascadian_clean` (44 views)

---

## SUMMARY BY CATEGORY

| Category | Default | Cascadian_Clean | Total | Status |
|----------|---------|-----------------|-------|--------|
| PNL Views | 12 | 18 | 30 | ⚠️ Too many versions |
| Resolution Views | 8 | 7 | 15 | ⚠️ Multiple overlaps |
| Trade Views | 10 | 3 | 13 | ⚠️ Consolidate |
| Mapping/Token | 1 | 6 | 7 | ✅ Reasonable |
| Wallet Views | 3 | 2 | 5 | ✅ Reasonable |
| Utility Views | 20 | 8 | 28 | ⚠️ Some likely obsolete |

---

## RECOMMENDED CANONICAL VIEWS (Pick One per Purpose)

### PNL Views (30 total - CONSOLIDATE TO 3-4)

**Recommended Keepers:**
- ✅ `cascadian_clean.vw_wallet_pnl_unified` - Main wallet PNL (appears most complete)
- ✅ `cascadian_clean.vw_trading_pnl_realized` - Realized PNL only
- ✅ `cascadian_clean.vw_wallet_unrealized_pnl_summary` - Unrealized PNL
- ✅ `cascadian_clean.vw_redemption_pnl` - Redemption-specific PNL

**Delete Candidates (26 views):**
- ❌ All "_v2", "_v3" suffix views (old versions)
- ❌ Duplicate naming: vw_wallet_pnl vs vw_wallet_pnl_fast vs vw_wallet_pnl_simple
- ❌ Test/debug views: `default.test_rpnl_debug`
- ❌ Backups: `default.vw_wallet_pnl_calculated_backup`

**Specific Delete List:**
```sql
-- Default schema PNL views to delete (keep only if needed for API)
DROP VIEW IF EXISTS default.pnl_final_by_condition;
DROP VIEW IF EXISTS default.realized_pnl_by_market_v3;
DROP VIEW IF EXISTS default.realized_pnl_by_resolution;
DROP VIEW IF EXISTS default.test_rpnl_debug;
DROP VIEW IF EXISTS default.vw_wallet_pnl_calculated_backup;
DROP VIEW IF EXISTS default.vw_wallet_pnl_summary;
DROP VIEW IF EXISTS default.wallet_pnl_summary_v2;
DROP VIEW IF EXISTS default.wallet_unrealized_pnl_v2;

-- Cascadian_clean duplicates (keep unified versions only)
DROP VIEW IF EXISTS cascadian_clean.vw_wallet_pnl_fast;
DROP VIEW IF EXISTS cascadian_clean.vw_wallet_pnl_simple;
DROP VIEW IF EXISTS cascadian_clean.vw_wallet_pnl_closed;
DROP VIEW IF EXISTS cascadian_clean.vw_wallet_pnl_all;
DROP VIEW IF EXISTS cascadian_clean.vw_wallet_pnl_settled;
DROP VIEW IF EXISTS cascadian_clean.vw_trade_pnl;  -- Keep vw_trade_pnl_final instead
```

---

### Resolution Views (15 total - CONSOLIDATE TO 2-3)

**Recommended Keepers:**
- ✅ `cascadian_clean.vw_resolutions_unified` - Primary resolution view
- ✅ `cascadian_clean.vw_resolutions_truth` - Filtered/validated resolutions
- ⚠️ `default.market_resolutions_flat` - Keep if used by API

**Delete Candidates (12 views):**
```sql
-- Default schema
DROP VIEW IF EXISTS default.resolution_candidates_norm;
DROP VIEW IF EXISTS default.resolution_candidates_ranked;
DROP VIEW IF EXISTS default.resolution_conflicts;
DROP VIEW IF EXISTS default.resolution_rollup;
DROP VIEW IF EXISTS default.resolutions_norm;
DROP VIEW IF EXISTS default.v_market_resolutions;

-- Cascadian_clean duplicates
DROP VIEW IF EXISTS cascadian_clean.vw_resolutions_all;  -- Superset in unified
DROP VIEW IF EXISTS cascadian_clean.vw_resolutions_clean;
DROP VIEW IF EXISTS cascadian_clean.vw_resolutions_enhanced;
DROP VIEW IF EXISTS cascadian_clean.vw_resolutions_from_staging;
DROP VIEW IF EXISTS cascadian_clean.vw_resolutions_cid;
```

---

### Trade Views (13 total - CONSOLIDATE TO 2-3)

**Recommended Keepers:**
- ✅ `default.vw_trades_canonical` - Primary trade view (157M rows)
- ✅ `cascadian_clean.vw_trades_ledger` - Ledger format for reconciliation
- ⚠️ `default.trades_raw` - Keep only if used as intermediate source

**Delete Candidates (10 views):**
```sql
-- Default schema
DROP VIEW IF EXISTS default.market_last_trade;
DROP VIEW IF EXISTS default.resolved_trades_v2;
DROP VIEW IF EXISTS default.trade_flows_v2;
DROP VIEW IF EXISTS default.trades_dedup_view;
DROP VIEW IF EXISTS default.trades_unique;
DROP VIEW IF EXISTS default.trades_working;
DROP VIEW IF EXISTS default.vw_trades_direction;
DROP VIEW IF EXISTS default.wallet_trade_cashflows_by_outcome;

-- Cascadian_clean
DROP VIEW IF EXISTS cascadian_clean.vw_traded_any_norm;  -- Utility, likely unused
```

---

### Mapping/Token Views (7 total - KEEP MOST)

**Recommended Keepers:**
- ✅ `cascadian_clean.vw_token_cid_map` - Primary token→condition mapping
- ✅ `cascadian_clean.vw_token_to_market` - Token→market mapping
- ✅ `cascadian_clean.vw_token_cid_bridge_via_tx` - TX-based bridge
- ✅ `default.token_dim` - Token dimension table

**Optional Delete:**
```sql
-- Only if proven unused
DROP VIEW IF EXISTS cascadian_clean.vw_vwc_token_decoded_fallback;
DROP VIEW IF EXISTS cascadian_clean.vw_vwc_token_joined;
DROP VIEW IF EXISTS cascadian_clean.vw_vwc_token_src;
```

---

### Wallet Views (5 total - KEEP ALL)

**Recommended Keepers:**
- ✅ `cascadian_clean.vw_wallet_metrics` - Wallet analytics
- ✅ `cascadian_clean.vw_wallet_positions` - Current positions
- ✅ `default.wallet_positions` - Alternative position view
- ✅ `default.wallet_positions_detailed` - Detailed positions
- ✅ `default.wallet_summary_metrics` - Summary metrics

---

### Utility Views (28 total - CONSOLIDATE TO ~10)

**Recommended Keepers:**
- ✅ `default.vw_markets_enriched` - Enriched market metadata
- ✅ `default.vw_conditions_enriched` - Enriched condition data
- ✅ `default.vw_events_enriched` - Enriched event data
- ✅ `cascadian_clean.vw_backfill_targets` - Backfill planning
- ✅ `default.unresolved_markets` - Active markets tracker
- ✅ `default.market_last_price` - Latest prices

**Delete Candidates (18 views):**
```sql
-- Default schema utilities (likely obsolete or one-time use)
DROP VIEW IF EXISTS default.canonical_condition;
DROP VIEW IF EXISTS default.condition_id_bridge;
DROP VIEW IF EXISTS default.coverage_by_source;
DROP VIEW IF EXISTS default.market_outcomes_expanded;
DROP VIEW IF EXISTS default.markets;  -- Redundant with markets_dim table
DROP VIEW IF EXISTS default.missing_by_vol;
DROP VIEW IF EXISTS default.missing_condition_ids;
DROP VIEW IF EXISTS default.missing_ranked;
DROP VIEW IF EXISTS default.outcome_positions_v3;
DROP VIEW IF EXISTS default.portfolio_category_summary;
DROP VIEW IF EXISTS default.portfolio_mtm_detailed;
DROP VIEW IF EXISTS default.vol_rank_by_condition;
DROP VIEW IF EXISTS default.vol_rank_dedup;
DROP VIEW IF EXISTS default.winning_index;

-- Cascadian_clean utilities
DROP VIEW IF EXISTS cascadian_clean.vw_backfill_targets_fixed;  -- Keep original only
DROP VIEW IF EXISTS cascadian_clean.vw_positions_open;
DROP VIEW IF EXISTS cascadian_clean.vw_repair_pairs_vwc;
DROP VIEW IF EXISTS cascadian_clean.vw_resolved_have;
```

---

## CONSOLIDATED DELETION SCRIPT

```sql
-- =====================================================
-- VIEW CLEANUP - DELETE 60 OF 98 VIEWS (61%)
-- =====================================================

-- PNL VIEWS (26 deletions)
DROP VIEW IF EXISTS default.pnl_final_by_condition;
DROP VIEW IF EXISTS default.realized_pnl_by_market_v3;
DROP VIEW IF EXISTS default.realized_pnl_by_resolution;
DROP VIEW IF EXISTS default.test_rpnl_debug;
DROP VIEW IF EXISTS default.vw_wallet_pnl_calculated_backup;
DROP VIEW IF EXISTS default.vw_wallet_pnl_summary;
DROP VIEW IF EXISTS default.wallet_pnl_summary_v2;
DROP VIEW IF EXISTS default.wallet_unrealized_pnl_v2;
DROP VIEW IF EXISTS cascadian_clean.vw_wallet_pnl_fast;
DROP VIEW IF EXISTS cascadian_clean.vw_wallet_pnl_simple;
DROP VIEW IF EXISTS cascadian_clean.vw_wallet_pnl_closed;
DROP VIEW IF EXISTS cascadian_clean.vw_wallet_pnl_all;
DROP VIEW IF EXISTS cascadian_clean.vw_wallet_pnl_settled;
DROP VIEW IF EXISTS cascadian_clean.vw_trade_pnl;
DROP VIEW IF EXISTS default.vw_wallet_pnl_calculated;
DROP VIEW IF EXISTS default.vw_wallet_total_pnl;
DROP VIEW IF EXISTS default.wallet_pnl_final_summary;
DROP VIEW IF EXISTS default.wallet_realized_pnl_v3;
DROP VIEW IF EXISTS cascadian_clean.vw_wallet_pnl;
DROP VIEW IF EXISTS cascadian_clean.vw_trade_pnl_final;
DROP VIEW IF EXISTS cascadian_clean.vw_trading_pnl_positions;
DROP VIEW IF EXISTS cascadian_clean.vw_trading_pnl_polymarket_style;
DROP VIEW IF EXISTS cascadian_clean.vw_wallet_pnl_polymarket_style;
DROP VIEW IF EXISTS cascadian_clean.vw_wallet_trading_pnl_summary;
DROP VIEW IF EXISTS cascadian_clean.vw_market_pnl_unified;
DROP VIEW IF EXISTS cascadian_clean.vw_pnl_coverage_metrics;

-- RESOLUTION VIEWS (12 deletions)
DROP VIEW IF EXISTS default.resolution_candidates_norm;
DROP VIEW IF EXISTS default.resolution_candidates_ranked;
DROP VIEW IF EXISTS default.resolution_conflicts;
DROP VIEW IF EXISTS default.resolution_rollup;
DROP VIEW IF EXISTS default.resolutions_norm;
DROP VIEW IF EXISTS default.v_market_resolutions;
DROP VIEW IF EXISTS cascadian_clean.vw_resolutions_all;
DROP VIEW IF EXISTS cascadian_clean.vw_resolutions_clean;
DROP VIEW IF EXISTS cascadian_clean.vw_resolutions_enhanced;
DROP VIEW IF EXISTS cascadian_clean.vw_resolutions_from_staging;
DROP VIEW IF EXISTS cascadian_clean.vw_resolutions_cid;
DROP VIEW IF EXISTS default.vw_resolutions_truth;

-- TRADE VIEWS (10 deletions)
DROP VIEW IF EXISTS default.market_last_trade;
DROP VIEW IF EXISTS default.resolved_trades_v2;
DROP VIEW IF EXISTS default.trade_flows_v2;
DROP VIEW IF EXISTS default.trades_dedup_view;
DROP VIEW IF EXISTS default.trades_unique;
DROP VIEW IF EXISTS default.trades_working;
DROP VIEW IF EXISTS default.vw_trades_direction;
DROP VIEW IF EXISTS default.wallet_trade_cashflows_by_outcome;
DROP VIEW IF EXISTS cascadian_clean.vw_traded_any_norm;
DROP VIEW IF EXISTS default.vw_latest_trade_prices;

-- UTILITY VIEWS (18 deletions)
DROP VIEW IF EXISTS default.canonical_condition;
DROP VIEW IF EXISTS default.condition_id_bridge;
DROP VIEW IF EXISTS default.coverage_by_source;
DROP VIEW IF EXISTS default.market_outcomes_expanded;
DROP VIEW IF EXISTS default.markets;
DROP VIEW IF EXISTS default.missing_by_vol;
DROP VIEW IF EXISTS default.missing_condition_ids;
DROP VIEW IF EXISTS default.missing_ranked;
DROP VIEW IF EXISTS default.outcome_positions_v3;
DROP VIEW IF EXISTS default.portfolio_category_summary;
DROP VIEW IF EXISTS default.portfolio_mtm_detailed;
DROP VIEW IF EXISTS default.vol_rank_by_condition;
DROP VIEW IF EXISTS default.vol_rank_dedup;
DROP VIEW IF EXISTS default.winning_index;
DROP VIEW IF EXISTS cascadian_clean.vw_backfill_targets_fixed;
DROP VIEW IF EXISTS cascadian_clean.vw_positions_open;
DROP VIEW IF EXISTS cascadian_clean.vw_repair_pairs_vwc;
DROP VIEW IF EXISTS cascadian_clean.vw_resolved_have;

-- =====================================================
-- RESULT: 38 VIEWS REMAINING (39%)
-- =====================================================
```

---

## CANONICAL VIEW REFERENCE (38 KEEPERS)

### Cascadian_Clean Schema (15 views)
**PNL:**
- vw_wallet_pnl_unified
- vw_trading_pnl_realized
- vw_wallet_unrealized_pnl_summary
- vw_redemption_pnl

**Resolutions:**
- vw_resolutions_unified
- vw_resolutions_truth

**Trades:**
- vw_trades_ledger
- vw_traded_markets

**Mappings:**
- vw_token_cid_map
- vw_token_to_market
- vw_token_cid_bridge_via_tx
- vw_vwc_hex
- vw_vwc_norm
- vw_tref_norm

**Wallets:**
- vw_wallet_metrics
- vw_wallet_positions

**Utility:**
- vw_backfill_targets

### Default Schema (23 views)
**PNL:**
- (None - migrate to cascadian_clean)

**Resolutions:**
- market_resolutions_flat

**Trades:**
- vw_trades_canonical
- trades_raw

**Mappings:**
- token_dim

**Wallets:**
- wallet_positions
- wallet_positions_detailed
- wallet_summary_metrics

**Utility:**
- vw_markets_enriched
- vw_conditions_enriched
- vw_events_enriched
- unresolved_markets
- market_last_price

---

## IMPLEMENTATION PLAN

### Phase 1: Backup View Definitions (1 hour)
```bash
# Export all view definitions before deletion
clickhouse-client --query="
  SELECT name, create_table_query
  FROM system.tables
  WHERE database IN ('default', 'cascadian_clean')
    AND engine = 'View'
" --format=TabSeparatedRaw > view_definitions_backup.sql
```

### Phase 2: Check API Dependencies (2 hours)
- Search codebase for view references
- Identify which views are actively used by application
- Update queries to use canonical views

### Phase 3: Delete Views (30 minutes)
- Run consolidated deletion script above
- Verify no broken dependencies

### Phase 4: Document Canonical Views (1 hour)
- Update README with canonical view list
- Add view purpose documentation
- Create migration guide for deprecated views

---

**Total Effort:** 4-5 hours  
**Space Saved:** Minimal (views are virtual)  
**Clarity Gained:** Massive (98 → 38 views, 61% reduction)

---

**Next Steps:**
1. Export view definitions (backup)
2. Search codebase for usage (`grep -r "vw_wallet_pnl" src/`)
3. Run deletion script
4. Update CLAUDE.md with canonical view list
