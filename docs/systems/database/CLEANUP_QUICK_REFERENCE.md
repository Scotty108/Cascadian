# PnL Cleanup - Quick Reference

**See:** `CLEANUP_RECOMMENDATIONS.md` for full audit

---

## What's Safe to Delete (Already staged in git)

### Deleted Scripts (200+)
```
scripts/03-xcnstrategy-pnl-check.ts
scripts/04-xcnstrategy-realized-pnl.ts
... (170+ more investigation artifacts)
```
**Status:** Already marked "D" in git status  
**Risk:** None - never used by production code  
**Action:** Confirm in git commit (don't restore)

### Deleted Documentation (15 files)
```
docs/operations/CLAUDE_PNL_FIX_GUIDE.md
docs/operations/PNL_IMPLEMENTATION_GUIDE.md
... (13 more legacy guides)
```
**Status:** Already marked "D" in git status  
**Risk:** None - specs still exist in `/docs/systems/database/`  
**Action:** Confirm in git commit

---

## What to KEEP (Production)

### PnL Engines (NEVER delete)
```
✅ lib/pnl/uiActivityEngineV3.ts
✅ lib/pnl/polymarketSubgraphEngine.ts
✅ lib/pnl/computeUiPnlFromLedger.ts
✅ lib/pnl/polymarketEventLoader.ts
```

### Core Tables (NEVER delete)
```
✅ pm_trader_events_v2           (CLOB fills)
✅ pm_ctf_events                 (Splits/Merges/Redemptions)
✅ pm_condition_resolutions      (Market resolutions)
✅ pm_token_to_condition_map_v3  (Token ID mappings)
✅ pm_erc1155_transfers
✅ pm_erc20_usdc_flows
✅ pm_market_metadata
✅ pm_wallet_classification
✅ pm_unified_ledger_v5
```

### Active Views (KEEP)
```
✅ pm_wallet_market_pnl_v2          (Default - PRODUCTION)
✅ vw_wallet_market_pnl_v3          (Beta - feature-flagged)
✅ vw_pm_retail_wallets_v1
✅ pm_trades_canonical_v2
✅ vw_trades_canonical_current
```

### Active Scripts in `/scripts/pnl/` (KEEP all 15)
```
✅ ui-activity-pnl-simulator-v3.ts
✅ test-polymarket-subgraph-pnl.ts
✅ test-ui-pnl-estimate.ts
✅ compute-wallet-pnl.ts
✅ retail-pnl-benchmark.ts
✅ test-market-pnl.ts
✅ create-unified-ledger-v5.ts
✅ create-wallet-classification-table.ts
✅ create-wallet-pnl-ui-activity-v1-table.ts
✅ materialize-wallet-pnl-ui-activity-v1.ts
✅ create-retail-wallet-view.ts
✅ create-ctf-ledger-tables.ts
✅ migrate-erc1155-transfers.ts
✅ migrate-erc20-usdc-flows.ts
✅ create-v9-unified-ledger.ts
```

---

## What to Investigate

| Item | Status | Action |
|------|--------|--------|
| `pm_wallet_condition_ledger_v9` | Unclear | Verify if used by any production code |
| `pm_ctf_flows_inferred` | Unclear | Check if created/maintained daily |
| `pm_wallet_pnl_ui_activity_v1` | Materialized | Confirm if still needed |
| `pm_erc1155_transfers` | Optional | Used only if transfer-aware PnL enabled |

---

## Timeline

| Date | Action |
|------|--------|
| **Now (Nov 29)** | Review cleanup document, confirm deletions in git |
| **Dec 2** | Archive remaining investigation scripts |
| **Dec 2** | Create `PNL_ARCHITECTURE_ACTIVE.md` (new doc) |
| **Dec 5** | Deprecate legacy views (rename with `_DEPRECATED_` prefix) |
| **Dec 30** | Delete deprecated views (after 30-day monitoring) |

---

## Risk Assessment

| Action | Risk | Mitigation |
|--------|------|-----------|
| Delete 200+ scripts | None | Already in git history |
| Delete 15 docs | None | Specs still exist |
| Keep legacy tables | Low storage cost | Don't add new ones |
| Deprecate old views | Very low | 30-day monitoring window |

---

## One-Liner Commands

```bash
# What's marked for deletion in git?
git status --short | grep "^D" | head -20

# How many PnL scripts are orphaned?
git status --short | grep "^D.*scripts" | wc -l

# Are legacy views still used?
grep -r "pm_wallet_pnl_summary\|vw_realized_pnl_v[1-7]" lib app

# What PnL tables exist?
SELECT name FROM system.tables WHERE database = 'default' AND name LIKE '%pnl%' OR name LIKE '%pm_%'
```

---

## Key Facts

1. **Feature flags in use:** `ENABLE_V3_PNL_VIEWS` (defaults to false → V2)
2. **Active PnL view selector:** `lib/clickhouse/pnl-views.ts`
3. **Production default:** V2 (stable, tested) - not V3 (beta)
4. **Retail wallets:** Use ledger-based fast path (0.1s vs 5s for V11_POLY)
5. **Operator wallets:** Fallback to V11_POLY canonical (more accurate for market makers)

---

**For full audit details, see:** `CLEANUP_RECOMMENDATIONS.md`
