# Polymarket Data Stack Reference

## Core Tables (Authoritative Sources)
| Domain | Table/View | Purpose |
|--------|------------|---------|
| Trades | `default.vw_trades_canonical` | Full trade universe from CLOB feed. Fields: `tx_hash`, `wallet_address_norm`, `condition_id_norm` (token ID), `outcome_index`, `trade_direction`, `shares`, `entry_price`, `usd_value`. Used to rebuild `fact_trades_clean` and compute PnL per fill. |
| Trades (deduped) | `cascadian_clean.fact_trades_clean` | ReplacingMergeTree copy of canonical trades deduped on `(tx_hash, cid_hex, wallet_address)`. Drives wallet-level analytics and joins to resolutions. |
| Wallet remap | `cascadian_clean.system_wallet_map` | Maps infrastructure relayer wallets (e.g., `0x4bfb…`) to actual user wallets by tx hash. Used in `vw_wallet_positions` to attribute trades correctly. |
| Resolutions – warehouse | `default.market_resolutions_final` | Legacy resolution feed (~56k markets). Provides `winning_index`, `payout_numerators`, `payout_denominator`. |
| Resolutions – gamma metadata | `default.gamma_markets` | Market-level info (question, description, category, tags, closed flag, resolved outcome). Condition IDs already normalized at market level. |
| Resolutions – API backfill | `cascadian_clean.resolutions_src_api` | Populated by Option B backfill. Stores missing markets fetched from Gamma API with payout vectors + metadata. |
| Unified resolutions view | `cascadian_clean.vw_resolutions_all` | UNION of warehouse, gamma, and API sources (priority ordered). Every downstream query joins to this view for payouts + metadata. |
| Token→market bridge | `cascadian_clean.vw_token_to_market` | Maps ERC‑1155 token IDs (condition_id_norm in trades) to market-level condition IDs (strip last byte). Used to deduplicate API calls and link token-level trades to market-level metadata. |
| Pending markets | `cascadian_clean.vw_backfill_targets` | Materialized list of market IDs that appear in trades but lack resolutions. Drives the backfill job. |

## Analytical Views (ready for consumption)
| View | Source Tables | Description |
|------|---------------|-------------|
| `cascadian_clean.vw_trade_pnl_final` | `fact_trades_clean` + `vw_resolutions_all` + `system_wallet_map` | Per-trade PnL joined to payouts. Filters out zero/blank condition_ids. Returns `NULL` when unresolved so no fake losses. |
| `cascadian_clean.vw_wallet_positions` | `vw_trade_pnl_final` | Aggregates trades per wallet + condition_id/outcome. Provides total shares, cost basis, realized PnL, `is_resolved`. |
| `cascadian_clean.vw_wallet_pnl` | `vw_wallet_positions` + `gamma_markets` | Wallet-level summary (total PnL, gains, losses, win rate). Optionally enriched with category/tags from gamma. |
| `cascadian_clean.vw_market_events` | `gamma_markets` | Canonical market metadata (category, tags, market slug, open/close). Used to enrich any PnL by category report. |

## Supporting Tables
| Table | Purpose |
|-------|---------|
| `cascadian_clean.backfill_progress` | Tracks last processed market ID/batch for the API backfill job. Allows safe pause/resume. |
| `cascadian_clean.resolutions_by_cid` (if materialized) | Optional rekeyed copy of warehouse resolutions keyed by token IDs. Helpful for diagnostics, but `vw_resolutions_all` is the main interface. |
| `default.outcome_positions_v2` | Precomputed net positions (wallet, condition_id, outcome_idx, net_shares). Useful for light-weight PnL checks or if we need a faster approximation without scanning all trades. |
| `default.condition_market_map` | Mapping between condition_id and market_id (text-based). Useful when joining to legacy market datasets that only have numeric market ids. |
| `default.market_id_mapping`, `default.market_key_map` | Additional mappings and descriptive info; good for cross-referencing events or building dashboards. |

## Usage Cheat Sheet
1. **Full trade export** – query `vw_trades_canonical` (or `fact_trades_clean` for deduped view). This is the entire Polymarket trading universe we ingest. 
2. **Wallet PnL** – use `vw_wallet_pnl`. Join to `vw_market_events` if you need category or tags. Filter `is_resolved = 1` for realized numbers; include `NULL`s to show unrealized positions. 
3. **Category/Tag analytics** – join `vw_trade_pnl_final` or `vw_wallet_positions` to `gamma_markets` on market-level condition_id (use `vw_token_to_market` to strip outcome byte). Aggregate by `category`, `tags`, `question`. 
4. **Backfill monitoring** – monitor `backfill_progress` and `resolutions_src_api`. Once complete, rerun `create-unified-resolutions-view.ts` so `vw_resolutions_all` includes the new data. 
5. **Coverage check** – run `real-coverage-calculation.ts` (or equivalent SQL) to compare distinct `cid_hex` in FACT vs `vw_resolutions_all`. Target ≥95 %. 

With this stack in place, once the API backfill finishes we will have: 
- 100 % of Polymarket trades (`vw_trades_canonical`). 
- ~100 % market resolutions + metadata (`vw_resolutions_all`, `gamma_markets`). 
- Wallet/system-wallet remap so infrastructure accounts are attributed to real users. 
- Ready-made views for PnL by wallet/event/category. 
