# DATABASE VIEW CLEANUP PLAN
**Status:** Ready to execute (safe to run in parallel with backfill)
**Current state:** 115 total views (91 in default, 24 in cascadian_clean)
**Target state:** ~25-30 production views

## Executive Summary

After cleaning up 69 tables (reducing from 121 → 52), we now have **115 views** that need similar analysis.

**View Categories:**
- **Temporary/Debug views** (prefixed with `_` or `tmp_`) = ~35 views
- **Versioned views** (suffixed with `_v1`, `_v2`, `_v3`) = ~20 views
- **Backup views** (containing `backup`) = ~5 views
- **Obsolete/duplicate views** = ~30 views
- **Production views to KEEP** = ~25 views

---

## View Analysis

### CASCADIAN_CLEAN Views (24 total) - Mostly Production

**Keep (Core Production - 12 views):**
```
✅ vw_resolutions_all          # Main resolutions view (used everywhere)
✅ vw_resolutions_unified       # Unified resolutions from multiple sources
✅ vw_trade_pnl_final          # Final P&L calculations
✅ vw_wallet_metrics           # Wallet analytics
✅ vw_wallet_pnl              # Wallet P&L aggregation
✅ vw_wallet_positions         # Current wallet positions
✅ vw_token_cid_map           # Token-to-condition_id mapping
✅ vw_token_to_market         # Token-to-market mapping
✅ vw_traded_markets          # All traded markets list
✅ vw_vwc_norm                # Normalized trades canonical
✅ vw_tref_norm               # Normalized trade references
✅ vw_backfill_targets        # Backfill target identification
```

**Review/Consider Dropping (12 views):**
```
⚠️  vw_resolutions_cid         # May be superseded by vw_resolutions_all
⚠️  vw_resolved_have           # May be temp helper for backfill
⚠️  vw_trade_pnl              # May be superseded by vw_trade_pnl_final
⚠️  vw_wallet_pnl_fast        # May be superseded by vw_wallet_pnl
⚠️  vw_wallet_pnl_simple      # May be superseded by vw_wallet_pnl
⚠️  vw_vwc_hex                # Helper view - may be temp
⚠️  vw_vwc_token_src          # Helper view - may be temp
⚠️  vw_vwc_token_joined       # Helper view - may be temp
⚠️  vw_vwc_token_decoded_fallback  # Fallback logic - may not be needed
⚠️  vw_token_cid_bridge_via_tx     # Bridge helper - may be temp
⚠️  vw_repair_pairs_vwc             # Repair helper - likely temp
⚠️  vw_traded_any_norm              # May be superseded by vw_traded_markets
```

---

### DEFAULT Views (91 total) - Heavy Cleanup Needed

#### Category 1: Underscore-Prefixed Views (DROP - 27 views)
**These are temporary helper views for data processing:**

```sql
DROP VIEW IF EXISTS default._candidate_contracts;
DROP VIEW IF EXISTS default._candidate_ctf_addresses;
DROP VIEW IF EXISTS default._cid_res;
DROP VIEW IF EXISTS default._fact_cid;
DROP VIEW IF EXISTS default._market_map;
DROP VIEW IF EXISTS default._mkey_to_cid;
DROP VIEW IF EXISTS default._mkey_to_cid_candidates;
DROP VIEW IF EXISTS default._mkey_vwc;
DROP VIEW IF EXISTS default._raw_missing_tx;
DROP VIEW IF EXISTS default._repair_pairs_vwc;
DROP VIEW IF EXISTS default._res_cid;
DROP VIEW IF EXISTS default._res_norm;
DROP VIEW IF EXISTS default._still_missing_cids;
DROP VIEW IF EXISTS default._token_cid_map;
DROP VIEW IF EXISTS default._token_to_cid;
DROP VIEW IF EXISTS default._tx_cid_union;
DROP VIEW IF EXISTS default._tx_cid_via_erc1155;
DROP VIEW IF EXISTS default._tx_cid_via_market;
DROP VIEW IF EXISTS default._tx_cid_via_token;
DROP VIEW IF EXISTS default._tx_vwc;
DROP VIEW IF EXISTS default._vwc_hex;
DROP VIEW IF EXISTS default._vwc_market;
DROP VIEW IF EXISTS default._vwc_norm;
DROP VIEW IF EXISTS default._vwc_token_decoded_fallback;
DROP VIEW IF EXISTS default._vwc_token_joined;
DROP VIEW IF EXISTS default._vwc_token_src;
DROP VIEW IF EXISTS default._market_map;
```

**Space impact:** Minimal (views don't store data)
**Risk:** Very low (these are clearly temp helpers)

---

#### Category 2: tmp_ Prefixed Views (DROP - 4 views)
**Explicitly temporary views:**

```sql
DROP VIEW IF EXISTS default.tmp_raw_bad;
DROP VIEW IF EXISTS default.tmp_res_norm;
DROP VIEW IF EXISTS default.tmp_trenf_norm;
DROP VIEW IF EXISTS default.tmp_vwc_norm;
```

---

#### Category 3: Backup Views (DROP - 3 views)
**Old backup views created during previous operations:**

```sql
DROP VIEW IF EXISTS default.outcome_positions_v2_backup_20251107T072157;
DROP VIEW IF EXISTS default.trade_cashflows_v3_backup_20251107T072157;
DROP VIEW IF EXISTS default.winning_index_backup_20251107T072336;
```

---

#### Category 4: Versioned Views (DROP old versions, KEEP latest - 20 views)

**Old versions to DROP:**
```sql
-- Old outcome position views
DROP VIEW IF EXISTS default.outcome_positions_v2;  # Keep v3
DROP VIEW IF EXISTS default.pos_by_condition_v1;  # Old version

-- Old realized P&L views
DROP VIEW IF EXISTS default.realized_inputs_v1;
DROP VIEW IF EXISTS default.realized_pnl_by_condition_v3;
DROP VIEW IF EXISTS default.realized_pnl_by_market;    # Keep v2 or v3
DROP VIEW IF EXISTS default.realized_pnl_by_market_v2;  # Keep v3

-- Old wallet P&L views
DROP VIEW IF EXISTS default.wallet_realized_pnl;     # Keep v2 or v3
DROP VIEW IF EXISTS default.wallet_realized_pnl_v2;  # Keep v3
DROP VIEW IF EXISTS default.wallet_unrealized_pnl;   # Keep v2
DROP VIEW IF EXISTS default.wallet_pnl_summary;      # Keep v2

-- Old trade views
DROP VIEW IF EXISTS default.resolved_trades_v1;      # Keep v2
DROP VIEW IF EXISTS default.trade_flows;             # Keep v2
DROP VIEW IF EXISTS default.winning_shares_v1;
DROP VIEW IF EXISTS default.winners_v1;

-- Old outcome position views
DROP VIEW IF EXISTS default.outcome_positions_v3;  # May be superseded
DROP VIEW IF EXISTS default.trade_cashflows_v3;    # May be superseded
```

**Latest versions to KEEP:**
```sql
✅ default.outcome_positions_v3
✅ default.realized_pnl_by_market_v3
✅ default.wallet_realized_pnl_v3
✅ default.wallet_unrealized_pnl_v2
✅ default.wallet_pnl_summary_v2
✅ default.resolved_trades_v2
✅ default.trade_flows_v2
```

---

#### Category 5: Obsolete/Duplicate Views (DROP - 15 views)

**Superseded by better views:**
```sql
DROP VIEW IF EXISTS default.condition_id_bridge;  # Old mapping approach
DROP VIEW IF EXISTS default.canonical_condition;  # Superseded by condition_market_map table
DROP VIEW IF EXISTS default.token_dim;            # Superseded by other mapping views
DROP VIEW IF EXISTS default.market_last_price;    # Obsolete
DROP VIEW IF EXISTS default.market_last_trade;    # Obsolete
DROP VIEW IF EXISTS default.trades_dedup_view;    # Superseded by vw_trades_canonical
DROP VIEW IF EXISTS default.trades_working;       # Superseded by vw_trades_canonical
DROP VIEW IF EXISTS default.trades_unique;        # Superseded by vw_trades_canonical
DROP VIEW IF EXISTS default.flows_by_condition_v1; # Old version
DROP VIEW IF EXISTS default.test_rpnl_debug;      # Debug view
DROP VIEW IF EXISTS default.markets;              # Superseded
DROP VIEW IF EXISTS default.coverage_by_source;   # Old coverage analysis
DROP VIEW IF EXISTS default.resolution_candidates_norm;    # Old resolution approach
DROP VIEW IF EXISTS default.resolution_candidates_ranked;  # Old resolution approach
DROP VIEW IF EXISTS default.resolution_rollup;    # Old resolution approach
```

---

#### Category 6: Production Views to KEEP (22 views)

**Core production views referenced by frontend/API:**
```sql
✅ default.vw_trades_canonical           # Main trades table
✅ default.vw_trades_direction           # Trade direction assignments
✅ default.vw_condition_categories       # Category mappings (just created)
✅ default.market_resolutions_flat       # Flat resolutions view
✅ default.v_market_resolutions          # Market resolutions with winner
✅ default.resolutions_norm              # Normalized resolutions
✅ default.realized_pnl_by_market_v3     # Market-level P&L
✅ default.realized_pnl_by_resolution    # Resolution-based P&L
✅ default.realized_pnl_by_market_v3     # Latest P&L calculations
✅ default.wallet_pnl_summary_v2         # Wallet P&L summary
✅ default.wallet_pnl_final_summary      # Final wallet P&L
✅ default.wallet_realized_pnl_v3        # Wallet realized P&L
✅ default.wallet_unrealized_pnl_v2      # Wallet unrealized P&L
✅ default.wallet_positions              # Current wallet positions
✅ default.wallet_positions_detailed     # Detailed wallet positions
✅ default.wallet_summary_metrics        # Wallet metrics summary
✅ default.portfolio_category_summary    # Portfolio by category
✅ default.portfolio_mtm_detailed        # Mark-to-market portfolio
✅ default.unresolved_markets            # Markets not yet resolved
✅ default.missing_ranked                # Missing data tracking
✅ default.vol_rank_by_condition         # Volume rankings
✅ default.market_outcomes_expanded      # Expanded market outcomes
```

---

## Execution Plan

### Phase 1: Drop Underscore-Prefixed Views (SAFE - Immediate)
**Target:** 27 views
**Risk:** Very low (clearly temporary)
**Time:** 2 minutes

### Phase 2: Drop tmp_ Prefixed Views (SAFE - Immediate)
**Target:** 4 views
**Risk:** Very low
**Time:** 1 minute

### Phase 3: Drop Backup Views (SAFE - After Verification)
**Target:** 3 views
**Risk:** Low (dated backups from Nov 7)
**Time:** 1 minute

### Phase 4: Drop Old Versioned Views (SAFE - Keep Latest)
**Target:** ~15 views
**Risk:** Low (keep v2/v3 versions)
**Time:** 2 minutes

### Phase 5: Drop Obsolete/Duplicate Views (REVIEW FIRST)
**Target:** ~15 views
**Risk:** Medium (verify not referenced)
**Time:** 3 minutes

### Phase 6: Review cascadian_clean Views (AFTER BACKFILL)
**Target:** Review 12 helper views
**Risk:** Medium (wait for backfill completion)
**Time:** 5 minutes

---

## Safety Checks Before Dropping

Before executing, verify:
- [ ] Views not referenced in `FINAL_DATABASE_SCHEMA.md`
- [ ] Views not used in frontend (grep through `src/` directory)
- [ ] Views not used in API routes (`src/app/api/`)

---

## Estimated Results

**Before:**
- 115 total views
- Confusing naming (many duplicates, versions, temp views)

**After:**
- ~30 production views
- Clean naming convention
- Clear purpose for each view
- All aligned with FINAL_DATABASE_SCHEMA.md

**Benefits:**
- Faster query planning (ClickHouse scans fewer views)
- Clearer data architecture
- Easier maintenance
- Better developer onboarding

---

## Rollback Plan

Views can be recreated from:
1. ClickHouse `system.tables` metadata (stores view definitions)
2. Git history (if view definitions were in migration scripts)
3. Re-run view creation scripts from previous phases

Since views don't store data, dropping them is low-risk and easily reversible.
