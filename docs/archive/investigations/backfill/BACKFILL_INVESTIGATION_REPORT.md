# Backfill Investigation Report

## Executive Summary

**Investigation Date:** 2025-11-10T00:21:50.191Z
**Target Wallet:** 0x4ce73141dbfce41e65db3723e31059a730f0abad
**Current Coverage:** 31 markets in default.vw_trades_canonical
**Polymarket Claims:** 2,816 predictions
**Gap:** 2785 markets missing

**Can we backfill from existing tables?** ✅ YES
**Backfill Potential:** 1 additional markets (0.0% of gap)

---

## Complete Table Inventory

### Databases
- cascadian_clean
- default

### Tables by Database


#### cascadian_clean.fact_trades_BROKEN_CIDS
- **Engine:** SharedReplacingMergeTree
- **Rows:** 63541482
- **Size:** 4.36 GiB
- **Columns:** 10
  - tx_hash (String), block_time (DateTime), cid_hex (String), outcome_index (Int16), wallet_address (String), direction (Enum8('BUY' = 1, 'SELL' = 2, 'UNKNOWN' = 3)), shares (Decimal(18, 8)), price (Decimal(18, 8)), usdc_amount (Decimal(18, 2)), source (String)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ✅


#### cascadian_clean.fact_trades_clean
- **Engine:** SharedReplacingMergeTree
- **Rows:** 63541461
- **Size:** 4.37 GiB
- **Columns:** 10
  - tx_hash (String), block_time (DateTime), cid_hex (String), outcome_index (Int16), wallet_address (String), direction (Enum8('BUY' = 1, 'SELL' = 2, 'UNKNOWN' = 3)), shares (Decimal(18, 8)), price (Decimal(18, 8)), usdc_amount (Decimal(18, 2)), source (String)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ✅


#### cascadian_clean.fact_trades_backup
- **Engine:** SharedReplacingMergeTree
- **Rows:** 63380210
- **Size:** 2.80 GiB
- **Columns:** 9
  - tx_hash (String), block_time (DateTime), cid_hex (String), outcome_index (Int16), wallet_address (String), direction (Enum8('BUY' = 1, 'SELL' = 2, 'UNKNOWN' = 3)), shares (Decimal(18, 8)), price (Decimal(18, 8)), usdc_amount (Decimal(18, 2))
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ✅


#### cascadian_clean.system_wallet_map
- **Engine:** SharedReplacingMergeTree
- **Rows:** 23252547
- **Size:** 1.77 GiB
- **Columns:** 10
  - tx_hash (String), system_wallet (String), user_wallet (String), cid_hex (String), direction (Enum8('BUY' = 1, 'SELL' = 2, 'UNKNOWN' = 3)), shares (Decimal(18, 8)), price (Decimal(18, 8)), usdc_amount (Decimal(18, 2)), confidence (Enum8('HIGH' = 1, 'MEDIUM' = 2, 'LOW' = 3)), mapping_method (String)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### cascadian_clean.backfill_progress
- **Engine:** SharedReplacingMergeTree
- **Rows:** 331485
- **Size:** 9.81 MiB
- **Columns:** 5
  - cid_hex (String), status (Enum8('pending' = 0, 'ok' = 1, 'error' = 2)), attempts (UInt16), last_error (String), updated_at (DateTime)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ✅


#### cascadian_clean.token_condition_market_map
- **Engine:** SharedReplacingMergeTree
- **Rows:** 227838
- **Size:** 13.64 MiB
- **Columns:** 4
  - token_id_erc1155 (String), condition_id_32b (String), market_id_cid (String), created_at (DateTime)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ✅
- **Has Market ID:** ✅
- **Has Token ID:** ✅
- **Has Timestamp:** ❌


#### cascadian_clean.resolutions_src_api
- **Engine:** SharedMergeTree
- **Rows:** 130300
- **Size:** 3.77 MiB
- **Columns:** 12
  - cid_hex (String), resolved (UInt8), winning_index (Int32), payout_numerators (Array(Decimal(18, 8))), payout_denominator (Nullable(Decimal(18, 8))), outcomes (Array(String)), title (String), category (String), tags (Array(String)), resolution_time (Nullable(DateTime64(3, 'UTC'))), source (String), inserted_at (DateTime)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ✅


#### cascadian_clean.midprices_latest
- **Engine:** SharedReplacingMergeTree
- **Rows:** 37929
- **Size:** 1.01 MiB
- **Columns:** 6
  - market_cid (String), outcome (Int32), midprice (Float64), best_bid (Float64), best_ask (Float64), updated_at (DateTime)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ✅


#### cascadian_clean.token_to_cid_bridge
- **Engine:** SharedAggregatingMergeTree
- **Rows:** 17340
- **Size:** 1.09 MiB
- **Columns:** 3
  - token_hex (String), cid_hex (String), outcome_index (UInt16)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### cascadian_clean.position_lifecycle
- **Engine:** SharedReplacingMergeTree
- **Rows:** 12234
- **Size:** 520.54 KiB
- **Columns:** 16
  - wallet (LowCardinality(String)), market_cid (String), outcome (Int32), lot_id (UInt64), opened_at (DateTime64(3)), closed_at (Nullable(DateTime64(3))), hold_seconds (UInt64), hold_days (Float64), entry_qty (Float64), entry_avg_price (Float64), exit_qty (Float64), exit_avg_price (Nullable(Float64)), realized_pnl (Float64), duration_category (LowCardinality(String)), position_status (LowCardinality(String)), created_at (DateTime)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### cascadian_clean.resolutions_by_cid
- **Engine:** SharedReplacingMergeTree
- **Rows:** 176
- **Size:** 6.39 KiB
- **Columns:** 5
  - cid_hex (String), winning_index (UInt16), payout_numerators (Array(UInt8)), payout_denominator (UInt8), resolved_at (Nullable(DateTime))
- **Has Wallet Column:** ❌
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### cascadian_clean.wallet_time_metrics
- **Engine:** SharedReplacingMergeTree
- **Rows:** 23
- **Size:** 6.41 KiB
- **Columns:** 25
  - wallet (LowCardinality(String)), positions_total (UInt64), positions_closed (UInt64), positions_open (UInt64), avg_hold_hours (Float64), median_hold_hours (Float64), max_hold_hours (Float64), min_hold_hours (Float64), pct_held_lt_1d (Float64), pct_held_1_7d (Float64), pct_held_gt_7d (Float64), pct_held_gt_30d (Float64), count_intraday (UInt64), count_short_term (UInt64), count_medium_term (UInt64), count_long_term (UInt64), intraday_pnl (Float64), short_term_pnl (Float64), medium_term_pnl (Float64), long_term_pnl (Float64), intraday_volume_usd (Float64), short_term_volume_usd (Float64), medium_term_volume_usd (Float64), long_term_volume_usd (Float64), updated_at (DateTime)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ✅


#### cascadian_clean.system_wallets
- **Engine:** SharedMergeTree
- **Rows:** 1
- **Size:** 234.00 B
- **Columns:** 1
  - addr (LowCardinality(String))
- **Has Wallet Column:** ❌
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### cascadian_clean.vw_backfill_targets
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 1
  - cid_hex (String)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### cascadian_clean.vw_wallet_pnl_closed
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 5
  - wallet (String), realized_pnl (Float64), total_volume (Float64), trade_count (UInt64), markets_traded (UInt64)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### cascadian_clean.vw_pnl_coverage_metrics
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 9
  - resolved_markets (Nullable(UInt64)), traded_markets (Nullable(UInt64)), prices_available (Nullable(UInt64)), open_positions_needing_prices (Nullable(UInt64)), total_realized_pnl (Nullable(Float64)), total_unrealized_pnl (Nullable(Float64)), total_all_pnl (Nullable(Float64)), realized_pct (Nullable(Float64)), unrealized_pct (Nullable(Float64))
- **Has Wallet Column:** ❌
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### cascadian_clean.vw_positions_open
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 10
  - wallet (String), market_cid (String), outcome (Int32), qty (Float64), avg_cost (Nullable(Float64)), midprice (Float64), best_bid (Float64), best_ask (Float64), price_updated_at (DateTime), unrealized_pnl_usd (Nullable(Float64))
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ✅


#### cascadian_clean.vw_redemption_pnl
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 8
  - wallet (String), market_cid (String), outcome (Int32), net_shares (Float64), net_cash (Float64), winning_index (String), payout_value (Nullable(Float64)), redemption_pnl_usd (Nullable(Float64))
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### cascadian_clean.vw_repair_pairs_vwc
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 2
  - tx_hash (String), cid_hex (String)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### cascadian_clean.vw_resolutions_all
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 7
  - cid_hex (String), winning_index (UInt16), payout_numerators (Array(UInt8)), payout_denominator (UInt8), resolved_at (Nullable(DateTime)), winning_outcome (LowCardinality(String)), source (LowCardinality(String))
- **Has Wallet Column:** ❌
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### cascadian_clean.vw_resolutions_cid
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 1
  - cid_hex (String)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### cascadian_clean.vw_resolutions_clean
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 6
  - cid_hex (String), winning_index (UInt16), payout_numerators (Array(UInt8)), payout_denominator (UInt8), resolved_at (Nullable(DateTime)), source (String)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### cascadian_clean.vw_resolutions_enhanced
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 12
  - condition_id (String), cid_hex (String), resolved (UInt8), winning_index (Int64), payout_numerators (Array(UInt8)), payout_denominator (UInt8), outcomes (Array(String)), winning_outcome (Nullable(String)), resolved_at (Nullable(DateTime)), source (String), priority (UInt8), match_quality (String)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ✅
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### cascadian_clean.vw_resolutions_from_staging
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 11
  - condition_id (String), cid_hex (String), resolved (UInt8), winning_index (Int64), payout_numerators (Array(UInt8)), payout_denominator (UInt8), outcomes (Array(String)), winning_outcome (Nullable(String)), resolved_at (Nullable(DateTime)), source (String), priority (UInt8)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ✅
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### cascadian_clean.vw_market_pnl_unified
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 7
  - wallet (String), market_cid (String), outcome (Int32), trading_realized_pnl (Float64), unrealized_pnl (Float64), redemption_pnl (Float64), total_pnl (Float64)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### cascadian_clean.vw_resolutions_unified
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 8
  - cid_hex (String), winning_index (UInt16), payout_numerators (Array(UInt8)), payout_denominator (UInt8), resolved_at (Nullable(DateTime)), winning_outcome (String), source (String), priority (UInt8)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### cascadian_clean.vw_resolved_have
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 1
  - cid_hex (String)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### cascadian_clean.vw_token_cid_bridge_via_tx
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 2
  - tx_hash (String), cid_hex (String)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### cascadian_clean.vw_backfill_targets_fixed
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 1
  - market_cid (String)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### cascadian_clean.vw_token_to_market
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 2
  - token_cid (String), market_cid (String)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### cascadian_clean.vw_trade_pnl
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 15
  - trade_id (String), wallet_address_norm (String), condition_id_norm (String), timestamp (DateTime), outcome_index (Int16), trade_direction (Enum8('BUY' = 1, 'SELL' = 2, 'UNKNOWN' = 3)), shares (Decimal(18, 8)), cost_basis (Decimal(18, 2)), entry_price (Decimal(18, 8)), winning_index (UInt16), payout_numerators (Array(UInt8)), payout_denominator (UInt8), resolved_at (Nullable(DateTime)), trade_pnl (Nullable(Float64)), is_resolved (UInt8)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ✅
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ✅


#### cascadian_clean.vw_trade_pnl_final
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 15
  - trade_id (String), wallet (String), cid (String), timestamp (DateTime), outcome_index (Int16), direction (Enum8('BUY' = 1, 'SELL' = 2, 'UNKNOWN' = 3)), shares (Decimal(18, 8)), cost_basis (Decimal(18, 2)), entry_price (Decimal(18, 8)), winning_index (UInt16), payout_numerators (Array(UInt8)), payout_denominator (UInt8), resolved_at (Nullable(DateTime)), pnl (Nullable(Float64)), is_resolved (UInt8)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ✅


#### cascadian_clean.vw_traded_any_norm
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 1
  - cid_hex (String)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### cascadian_clean.vw_traded_markets
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 1
  - cid_hex (String)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### cascadian_clean.vw_trades_ledger
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 8
  - wallet (String), token_cid (String), market_cid (String), outcome (Int32), ts (DateTime), d_shares (Float64), d_cash (Float64), fee_usd (Float64)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### cascadian_clean.vw_trading_pnl_polymarket_style
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 7
  - wallet (String), market_cid (String), outcome (Int32), current_shares (Float64), realized_pnl_usd (Float64), avg_cost_per_share (Nullable(Float64)), status (String)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### cascadian_clean.vw_trading_pnl_positions
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 7
  - wallet (String), market_cid (String), outcome (Int32), position_shares (Float64), net_cash (Float64), total_fees_usd (Float64), status (String)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### cascadian_clean.vw_trading_pnl_realized
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 8
  - wallet (String), market_cid (String), outcome (Int32), status (String), position_shares (Float64), net_cash (Float64), total_fees_usd (Float64), realized_pnl_usd (Float64)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### cascadian_clean.vw_tref_norm
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 9
  - tx_hash (String), block_time (DateTime), cid_hex (String), outcome_index (Int16), wallet_address (String), direction (String), shares (Decimal(18, 8)), price (Decimal(18, 8)), usdc_amount (Decimal(18, 2))
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ✅


#### cascadian_clean.vw_vwc_hex
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 2
  - tx_hash (String), cid_hex (String)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### cascadian_clean.vw_vwc_norm
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 9
  - tx_hash (String), block_time (DateTime), cid_hex (String), outcome_index (Int16), wallet_address (String), direction (Enum8('BUY' = 1, 'SELL' = 2, 'UNKNOWN' = 3)), shares (Decimal(18, 8)), price (Decimal(18, 8)), usdc_amount (Decimal(18, 2))
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ✅


#### cascadian_clean.vw_vwc_token_decoded_fallback
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 2
  - tx_hash (String), cid_hex (String)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### cascadian_clean.vw_vwc_token_joined
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 2
  - tx_hash (String), cid_hex (String)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### cascadian_clean.vw_vwc_token_src
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 3
  - tx_hash (String), token_dec (UInt256), token_hex (String)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### cascadian_clean.vw_wallet_metrics
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 7
  - wallet (String), resolved_positions (UInt64), pnl_usd (Nullable(Float64)), avg_pnl_usd (Nullable(Float64)), wins (Nullable(UInt64)), losses (Nullable(UInt64)), win_rate_pct (Nullable(Float64))
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### cascadian_clean.vw_wallet_pnl
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 11
  - wallet (String), cid (String), trade_count (UInt64), total_shares (Decimal(38, 8)), total_cost (Decimal(38, 2)), avg_price (Float64), total_pnl (Nullable(Float64)), realized_profit (Nullable(Float64)), realized_loss (Nullable(Float64)), is_resolved (UInt8), resolved_at (Nullable(DateTime))
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### cascadian_clean.vw_wallet_pnl_all
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 9
  - wallet (String), realized_pnl (Float64), unrealized_pnl (Nullable(Float64)), total_pnl (Nullable(Float64)), total_volume (Float64), trade_count (UInt64), open_positions (UInt64), positions_with_prices (UInt64), coverage_quality (String)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### cascadian_clean.vw_token_cid_map
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 2
  - token_hex (String), cid_hex (String)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### cascadian_clean.vw_wallet_pnl_fast
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 9
  - wallet (String), condition_id_norm (String), trade_count (UInt64), total_shares (Decimal(38, 8)), total_cost_basis (Decimal(38, 2)), avg_entry_price (Float64), total_pnl (Nullable(Float64)), is_resolved (UInt8), resolved_at (Nullable(DateTime))
- **Has Wallet Column:** ✅
- **Has Condition ID:** ✅
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### cascadian_clean.vw_wallet_pnl_polymarket_style
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 8
  - wallet (String), trading_realized_pnl (Float64), redemption_pnl (Float64), total_realized_pnl (Float64), unrealized_pnl (Float64), total_pnl (Float64), closed_positions (UInt64), open_positions (UInt64)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### cascadian_clean.vw_wallet_pnl_settled
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 8
  - wallet (String), trading_pnl (Float64), redemption_pnl (Float64), total_pnl (Float64), total_volume (Float64), trade_count (UInt64), positions_settled (UInt64), settled_value (Float64)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### cascadian_clean.vw_wallet_pnl_simple
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 11
  - wallet (String), condition_id_norm (String), cid_hex (String), outcome_idx (Int16), net_shares (Float64), winning_index (UInt16), payout_numerators (Array(UInt8)), payout_denominator (UInt8), winning_outcome (LowCardinality(String)), payout_value (Nullable(Float64)), is_resolved (UInt8)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ✅
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### cascadian_clean.vw_wallet_pnl_unified
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 9
  - wallet (String), trading_realized_pnl (Float64), redemption_pnl (Float64), total_realized_pnl (Float64), unrealized_pnl (Float64), total_pnl (Float64), closed_positions (UInt64), open_positions (UInt64), redeemed_positions (UInt64)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### cascadian_clean.vw_wallet_positions
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 13
  - wallet_remapped (String), wallet_address (String), f.cid_hex (String), outcome_index (Int16), f.direction (Enum8('BUY' = 1, 'SELL' = 2, 'UNKNOWN' = 3)), total_shares (Decimal(38, 8)), avg_entry_price (Float64), total_cost_basis (Decimal(38, 2)), winning_index (UInt16), payout_numerators (Array(UInt8)), payout_denominator (UInt8), realized_pnl_usd (Nullable(Float64)), is_resolved (UInt8)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### cascadian_clean.vw_wallet_trading_pnl_summary
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 5
  - wallet (String), total_positions (UInt64), closed_positions (UInt64), open_positions (UInt64), total_realized_pnl_usd (Float64)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### cascadian_clean.vw_wallet_unrealized_pnl_summary
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 6
  - wallet (String), open_positions (UInt64), total_shares (Float64), total_unrealized_pnl_usd (Nullable(Float64)), positions_with_prices (UInt64), positions_without_prices (UInt64)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### cascadian_clean.vw_resolutions_truth
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 6
  - condition_id_32b (String), winning_index (UInt16), payout_numerators (Array(UInt8)), payout_denominator (UInt8), resolved_at (Nullable(DateTime)), source (String)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ✅
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.erc20_transfers_staging
- **Engine:** SharedReplacingMergeTree
- **Rows:** 387728806
- **Size:** 18.00 GiB
- **Columns:** 10
  - tx_hash (String), log_index (Int32), block_number (UInt32), block_hash (String), address (String), topics (Array(String)), data (String), removed (Bool), token_type (String), created_at (DateTime)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.vw_trades_canonical
- **Engine:** SharedMergeTree
- **Rows:** 157541131
- **Size:** 11.84 GiB
- **Columns:** 16
  - trade_key (String), trade_id (String), transaction_hash (String), wallet_address_norm (String), market_id_norm (String), condition_id_norm (String), timestamp (DateTime), outcome_token (Enum8('YES' = 1, 'NO' = 2)), outcome_index (Int16), trade_direction (Enum8('BUY' = 1, 'SELL' = 2, 'UNKNOWN' = 3)), direction_confidence (Enum8('HIGH' = 1, 'MEDIUM' = 2, 'LOW' = 3)), direction_method (String), shares (Decimal(18, 8)), usd_value (Decimal(18, 2)), entry_price (Decimal(18, 8)), created_at (DateTime)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ✅
- **Has Market ID:** ✅
- **Has Token ID:** ❌
- **Has Timestamp:** ✅


#### default.trade_direction_assignments
- **Engine:** SharedMergeTree
- **Rows:** 129599951
- **Size:** 5.81 GiB
- **Columns:** 12
  - tx_hash (String), wallet_address (String), condition_id_norm (String), direction (Enum8('BUY' = 1, 'SELL' = 2, 'UNKNOWN' = 3)), confidence (Enum8('HIGH' = 1, 'MEDIUM' = 2, 'LOW' = 3)), usdc_out (Float64), usdc_in (Float64), tokens_out (UInt256), tokens_in (UInt256), has_both_legs (Bool), reason (String), created_at (DateTime)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ✅
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.trades_with_direction
- **Engine:** SharedMergeTree
- **Rows:** 82138586
- **Size:** 5.25 GiB
- **Columns:** 17
  - tx_hash (String), wallet_address (String), condition_id_norm (String), market_id (String), outcome_index (Int16), side_token (String), direction_from_transfers (String), shares (Decimal(18, 8)), price (Decimal(18, 8)), usd_value (Decimal(18, 2)), usdc_delta (UInt8), token_delta (UInt8), confidence (String), reason (String), recovery_status (String), data_source (String), computed_at (DateTime)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ✅
- **Has Market ID:** ✅
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.fact_trades_clean
- **Engine:** SharedReplacingMergeTree
- **Rows:** 63380204
- **Size:** 2.93 GiB
- **Columns:** 9
  - tx_hash (String), block_time (DateTime64(3)), cid (String), outcome_index (UInt8), wallet_address (String), direction (LowCardinality(String)), shares (Decimal(38, 18)), price (Decimal(18, 6)), usdc_amount (Decimal(18, 6))
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ✅


#### default.trade_cashflows_v3
- **Engine:** SharedMergeTree
- **Rows:** 35874799
- **Size:** 419.90 MiB
- **Columns:** 4
  - wallet (String), condition_id_norm (String), outcome_idx (Int16), cashflow_usdc (Float64)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ✅
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.erc20_transfers_decoded
- **Engine:** SharedMergeTree
- **Rows:** 21103660
- **Size:** 591.04 MiB
- **Columns:** 9
  - block_time (DateTime), tx_hash (FixedString(66)), log_index (UInt32), from_address (LowCardinality(String)), to_address (LowCardinality(String)), amount_raw (UInt256), amount_usdc (Float64), fee_usd (Float64), created_at (DateTime)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ✅


#### default.wallet_metrics_daily
- **Engine:** MaterializedView
- **Rows:** 14377331
- **Size:** 241.99 MiB
- **Columns:** 12
  - wallet_address (String), date (Date), total_trades (UInt64), wins (UInt64), losses (UInt64), total_pnl (Nullable(Decimal(38, 2))), avg_win (Nullable(Float64)), avg_loss (Nullable(Float64)), pnl_stddev (Nullable(Float64)), total_volume (Decimal(38, 2)), first_trade_time (DateTime), last_trade_time (DateTime)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ✅


#### default.realized_pnl_by_market_final
- **Engine:** SharedMergeTree
- **Rows:** 13703347
- **Size:** 881.87 MiB
- **Columns:** 5
  - wallet (String), market_id (String), condition_id_norm (String), resolved_at (Nullable(DateTime64(3))), realized_pnl_usd (Float64)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ✅
- **Has Market ID:** ✅
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.outcome_positions_v2
- **Engine:** SharedMergeTree
- **Rows:** 8374571
- **Size:** 304.81 MiB
- **Columns:** 4
  - wallet (String), condition_id_norm (String), outcome_idx (Int16), net_shares (Float64)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ✅
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.market_candles_5m
- **Engine:** SharedReplacingMergeTree
- **Rows:** 8051265
- **Size:** 221.76 MiB
- **Columns:** 9
  - market_id (String), bucket (DateTime), open (String), high (String), low (String), close (String), volume (String), notional (String), vwap (String)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ❌
- **Has Market ID:** ✅
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.wallet_metrics_complete
- **Engine:** SharedMergeTree
- **Rows:** 1000818
- **Size:** 41.46 MiB
- **Columns:** 22
  - wallet_address (String), window (Enum8('30d' = 1, '90d' = 2, '180d' = 3, 'lifetime' = 4)), category (String), calculated_at (DateTime), trades_analyzed (UInt32), resolved_trades (UInt32), track_record_days (UInt16), raw_data_hash (String), metric_2_omega_net (Decimal(12, 4)), metric_9_net_pnl_usd (Decimal(18, 2)), metric_12_hit_rate (Decimal(5, 4)), metric_13_avg_win_usd (Decimal(18, 2)), metric_14_avg_loss_usd (Decimal(18, 2)), metric_22_resolved_bets (UInt32), metric_23_track_record_days (UInt16), metric_24_bets_per_week (Decimal(10, 2)), total_volume (Float64), total_trades (UInt32), wins (UInt32), losses (UInt32), first_trade_date (DateTime), last_trade_date (DateTime)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ✅


#### default.wallet_metrics
- **Engine:** SharedReplacingMergeTree
- **Rows:** 996108
- **Size:** 43.61 MiB
- **Columns:** 16
  - wallet_address (String), total_trades (UInt32), total_volume (Decimal(18, 2)), unique_markets (UInt32), unique_categories (UInt32), first_trade_date (DateTime), last_trade_date (DateTime), active_days (UInt32), avg_trade_size (Decimal(18, 2)), max_trade_size (Decimal(18, 2)), avg_trades_per_day (Float32), total_realized_pnl (Decimal(18, 2)), total_unrealized_pnl (Decimal(18, 2)), total_pnl (Decimal(18, 2)), favorite_category (String), calculated_at (DateTime)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ✅


#### default.wallets_dim
- **Engine:** SharedReplacingMergeTree
- **Rows:** 996108
- **Size:** 30.83 MiB
- **Columns:** 10
  - wallet_address (String), first_seen (DateTime), last_seen (DateTime), total_volume_usd (Decimal(18, 2)), total_trades (UInt32), unique_markets (UInt32), unique_categories (UInt32), is_active (Bool), created_at (DateTime), updated_at (DateTime)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ✅


#### default.wallet_pnl_summary_final
- **Engine:** SharedMergeTree
- **Rows:** 934996
- **Size:** 24.12 MiB
- **Columns:** 4
  - wallet (String), realized_pnl_usd (Float64), unrealized_pnl_usd (Float64), total_pnl_usd (Float64)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.staging_resolutions_union
- **Engine:** SharedMergeTree
- **Rows:** 544475
- **Size:** 5.85 MiB
- **Columns:** 5
  - cid (String), source (String), priority (UInt8), winning_outcome (Nullable(String)), updated_at (Nullable(DateTime))
- **Has Wallet Column:** ❌
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ✅


#### default.resolution_candidates
- **Engine:** SharedReplacingMergeTree
- **Rows:** 424095
- **Size:** 22.72 MiB
- **Columns:** 8
  - condition_id_norm (String), outcome (String), resolved_at (DateTime), source (String), confidence (Float32), evidence (String), fetched_at (DateTime), checksum (String)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ✅
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.erc1155_transfers
- **Engine:** SharedMergeTree
- **Rows:** 291113
- **Size:** 14.80 MiB
- **Columns:** 12
  - tx_hash (String), log_index (UInt32), block_number (UInt64), block_timestamp (DateTime), contract (String), token_id (String), from_address (String), to_address (String), value (UInt256), operator (String), decoded_data (String), raw_json (String)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ✅
- **Has Timestamp:** ✅


#### default.erc20_transfers
- **Engine:** SharedMergeTree
- **Rows:** 288681
- **Size:** 6.99 MiB
- **Columns:** 10
  - tx_hash (String), log_index (UInt32), block_number (UInt64), block_timestamp (DateTime), contract (String), from_address (String), to_address (String), value (UInt256), decoded_data (String), raw_json (String)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ✅


#### default.market_resolutions_final
- **Engine:** SharedReplacingMergeTree
- **Rows:** 218325
- **Size:** 7.94 MiB
- **Columns:** 10
  - condition_id_norm (FixedString(64)), payout_numerators (Array(UInt8)), payout_denominator (UInt8), outcome_count (UInt8), winning_outcome (LowCardinality(String)), source (LowCardinality(String)), version (UInt8), resolved_at (Nullable(DateTime)), updated_at (DateTime), winning_index (UInt16)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ✅
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ✅


#### default.pm_erc1155_flats
- **Engine:** SharedMergeTree
- **Rows:** 206112
- **Size:** 7.41 MiB
- **Columns:** 11
  - tx_hash (String), log_index (UInt32), block_number (UInt32), block_time (DateTime), address (String), operator (String), from_address (String), to_address (String), token_id (String), amount (String), event_type (String)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ✅
- **Has Timestamp:** ✅


#### default.market_id_mapping
- **Engine:** SharedMergeTree
- **Rows:** 187071
- **Size:** 10.42 MiB
- **Columns:** 3
  - market_id (String), condition_id (String), trade_count (UInt64)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ✅
- **Has Market ID:** ✅
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.condition_ids_missing_api
- **Engine:** SharedMergeTree
- **Rows:** 170449
- **Size:** 5.23 MiB
- **Columns:** 1
  - condition_id (String)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ✅
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.api_ctf_bridge
- **Engine:** SharedReplacingMergeTree
- **Rows:** 156952
- **Size:** 7.81 MiB
- **Columns:** 5
  - condition_id (String), api_market_id (String), resolved_outcome (Nullable(String)), resolved_at (Nullable(DateTime)), source (String)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ✅
- **Has Market ID:** ✅
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.market_key_map
- **Engine:** SharedReplacingMergeTree
- **Rows:** 156952
- **Size:** 7.18 MiB
- **Columns:** 4
  - market_id (String), condition_id (String), question (Nullable(String)), resolved_at (Nullable(DateTime))
- **Has Wallet Column:** ❌
- **Has Condition ID:** ✅
- **Has Market ID:** ✅
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.condition_market_map
- **Engine:** SharedReplacingMergeTree
- **Rows:** 151843
- **Size:** 9.17 MiB
- **Columns:** 6
  - condition_id (String), market_id (String), event_id (String), canonical_category (String), raw_tags (Array(String)), ver (UInt64)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ✅
- **Has Market ID:** ✅
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.gamma_markets
- **Engine:** SharedMergeTree
- **Rows:** 149907
- **Size:** 21.54 MiB
- **Columns:** 12
  - condition_id (String), token_id (String), question (String), description (String), outcome (String), outcomes_json (String), end_date (String), category (String), tags_json (String), closed (UInt8), archived (UInt8), fetched_at (DateTime)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ✅
- **Has Market ID:** ❌
- **Has Token ID:** ✅
- **Has Timestamp:** ✅


#### default.market_resolutions
- **Engine:** SharedReplacingMergeTree
- **Rows:** 137391
- **Size:** 4.77 MiB
- **Columns:** 3
  - condition_id (String), winning_outcome (LowCardinality(String)), resolved_at (Nullable(DateTime64(3)))
- **Has Wallet Column:** ❌
- **Has Condition ID:** ✅
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.market_resolutions_by_market
- **Engine:** SharedReplacingMergeTree
- **Rows:** 133895
- **Size:** 1.04 MiB
- **Columns:** 3
  - market_id (String), winning_outcome (LowCardinality(String)), resolved_at (Nullable(DateTime64(3)))
- **Has Wallet Column:** ❌
- **Has Condition ID:** ❌
- **Has Market ID:** ✅
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.gamma_resolved
- **Engine:** SharedMergeTree
- **Rows:** 123245
- **Size:** 3.82 MiB
- **Columns:** 4
  - cid (String), winning_outcome (String), closed (UInt8), fetched_at (DateTime)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.events_dim
- **Engine:** SharedReplacingMergeTree
- **Rows:** 50201
- **Size:** 948.70 KiB
- **Columns:** 5
  - event_id (String), canonical_category (String), raw_tags (Array(String)), title (String), ingested_at (DateTime)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.merged_market_mapping
- **Engine:** SharedMergeTree
- **Rows:** 41306
- **Size:** 1.89 MiB
- **Columns:** 4
  - market_id (String), condition_id (String), question (String), source (String)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ✅
- **Has Market ID:** ✅
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.erc1155_condition_map
- **Engine:** SharedMergeTree
- **Rows:** 41306
- **Size:** 3.23 MiB
- **Columns:** 4
  - condition_id (String), market_address (String), token_id (String), source_timestamp (DateTime)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ✅
- **Has Market ID:** ❌
- **Has Token ID:** ✅
- **Has Timestamp:** ✅


#### default.ctf_token_map
- **Engine:** SharedReplacingMergeTree
- **Rows:** 41130
- **Size:** 1.46 MiB
- **Columns:** 8
  - token_id (String), condition_id_norm (String), outcome_index (UInt8), vote_count (UInt32), source (String), created_at (DateTime), version (UInt32), market_id (String)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ✅
- **Has Market ID:** ✅
- **Has Token ID:** ✅
- **Has Timestamp:** ❌


#### default.wallet_metrics_30d
- **Engine:** MaterializedView
- **Rows:** 12842
- **Size:** 872.34 KiB
- **Columns:** 30
  - wallet_address (String), window_date (Date), trades_count (UInt64), yes_count (UInt64), no_count (UInt64), resolved_count (UInt64), total_volume (Decimal(38, 2)), avg_trade_size (Float64), max_trade_size (Decimal(18, 2)), total_pnl_gross (Decimal(38, 6)), total_pnl_net (Decimal(38, 6)), total_gains (Decimal(38, 6)), total_losses (Decimal(38, 6)), wins (UInt64), losses (UInt64), avg_gain (Float64), avg_loss (Float64), avg_entry_price (Float64), avg_close_price (Float64), avg_fee (Float64), avg_slippage (Float64), avg_hours_held (Float64), max_hours_held (Decimal(10, 2)), min_hours_held (Decimal(10, 2)), avg_return_pct (Float64), stddev_return_pct (Float64), omega_gains_gross (Decimal(38, 6)), omega_losses_gross (Decimal(38, 6)), omega_gains_net (Decimal(38, 6)), omega_losses_net (Decimal(38, 6))
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ✅


#### default.id_bridge
- **Engine:** SharedReplacingMergeTree
- **Rows:** 10000
- **Size:** 7.86 MiB
- **Columns:** 10
  - condition_id_norm (String), token_id_norm (String), question_id (String), market_id (String), negrisk_market_id (String), market_slug (String), source (String), first_seen (DateTime), last_seen (DateTime), metadata (String)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ✅
- **Has Market ID:** ✅
- **Has Token ID:** ✅
- **Has Timestamp:** ❌


#### default.resolutions_external_ingest
- **Engine:** SharedReplacingMergeTree
- **Rows:** 8685
- **Size:** 298.57 KiB
- **Columns:** 7
  - condition_id (String), payout_numerators (Array(Float64)), payout_denominator (Float64), winning_index (Int32), resolved_at (DateTime), source (LowCardinality(String)), fetched_at (DateTime)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ✅
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.api_market_backfill
- **Engine:** SharedReplacingMergeTree
- **Rows:** 5983
- **Size:** 202.61 KiB
- **Columns:** 12
  - condition_id (String), question (String), description (String), outcomes_json (String), winning_outcome (String), closed (UInt8), resolved (UInt8), category (String), tags_json (String), end_date (String), payout_numerators_json (String), fetched_at (DateTime)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ✅
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ✅


#### default.markets_dim
- **Engine:** SharedReplacingMergeTree
- **Rows:** 5781
- **Size:** 89.94 KiB
- **Columns:** 4
  - market_id (String), question (String), event_id (String), ingested_at (DateTime)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ❌
- **Has Market ID:** ✅
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.backfill_checkpoint
- **Engine:** SharedMergeTree
- **Rows:** 2782
- **Size:** 13.30 KiB
- **Columns:** 10
  - batch_date (DateTime), batch_number (UInt32), day_idx (UInt16), shard_id (UInt8), from_block (UInt32), to_block (UInt32), erc20_count (UInt32), erc1155_count (UInt32), status (String), created_at (DateTime)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ✅


#### default.schema_migrations
- **Engine:** SharedMergeTree
- **Rows:** 13
- **Size:** 1010.00 B
- **Columns:** 3
  - version (String), name (String), applied_at (DateTime)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.market_event_mapping
- **Engine:** SharedReplacingMergeTree
- **Rows:** 0
- **Size:** 0.00 B
- **Columns:** 9
  - condition_id (String), market_id (String), event_id (String), canonical_category (String), raw_tags (Array(String)), market_title (String), mapping_source (Enum8('exact_match' = 1, 'fuzzy_match' = 2, 'synthetic' = 3)), confidence (Float32), created_at (DateTime)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ✅
- **Has Market ID:** ✅
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.winning_index
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 3
  - condition_id_norm (String), win_idx (Int64), resolved_at (Nullable(DateTime64(3)))
- **Has Wallet Column:** ❌
- **Has Condition ID:** ✅
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.portfolio_category_summary
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 11
  - wallet (String), category (String), markets_in_category (UInt64), total_trades (UInt64), unrealized_pnl_usd (Float64), notional_usd (Float64), winning_positions (UInt64), losing_positions (UInt64), win_rate_pct (Float64), largest_win (Float64), largest_loss (Float64)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.realized_pnl_by_market_v3
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 8
  - wallet (String), market_id (String), condition_id_norm (String), winning_longs (Float64), loser_shorts (Float64), settlement_usd (Float64), cashflow_total (Float64), realized_pnl_usd (Float64)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ✅
- **Has Market ID:** ✅
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.pnl_final_by_condition
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 4
  - p.wallet (String), p.condition_id_norm (String), winning_shares (Float64), total_cashflows (Float64)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ✅
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.outcome_positions_v3
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 7
  - wallet (String), market_id (String), condition_id_0x (String), condition_id_norm (String), idx (Nullable(Int32)), cashflow_usd (Float64), net_shares (Float64)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ✅
- **Has Market ID:** ✅
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.resolution_candidates_norm
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 4
  - cid (String), source (String), winning_outcome (String), inserted_at (DateTime64(3))
- **Has Wallet Column:** ❌
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.resolution_candidates_ranked
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 3
  - cid (String), winning_outcome (String), chosen_source (String)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.resolution_conflicts
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 3
  - condition_id_norm (String), unique_outcomes (UInt64), num_sources (UInt64)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ✅
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.resolution_rollup
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 13
  - condition_id_norm (String), onchain_outcome (String), api_outcome (String), negrisk_outcome (String), clob_outcome (String), existing_outcome (String), warehouse_outcome (String), ui_outcome (String), manual_outcome (String), unique_outcomes (UInt64), num_sources (UInt64), best_resolved_at (DateTime), has_conflict (UInt8)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ✅
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.missing_ranked
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 3
  - condition_id (String), vol (Decimal(38, 8)), last_trade (Date)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ✅
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.resolutions_norm
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 3
  - condition_id_norm (String), win_label (LowCardinality(String)), resolved_at (Nullable(DateTime64(3)))
- **Has Wallet Column:** ❌
- **Has Condition ID:** ✅
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.resolved_trades_v2
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 9
  - cid (String), wallet_address (String), ts (DateTime), side (Enum8('YES' = 1, 'NO' = 2)), entry_price (Decimal(18, 8)), shares (Decimal(18, 8)), usd_value (Decimal(18, 2)), realized_pnl_usd (Float64), winning_outcome (LowCardinality(String))
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.missing_condition_ids
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 1
  - cid (String)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.missing_by_vol
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 3
  - condition_id (String), vol (Decimal(38, 8)), trade_count (UInt64)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ✅
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.test_rpnl_debug
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 2
  - wallet (String), market_id (String)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ✅
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.token_dim
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 4
  - token_id (String), condition_id_norm (String), outcome_idx (Int16), market_id (String)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ✅
- **Has Market ID:** ✅
- **Has Token ID:** ✅
- **Has Timestamp:** ❌


#### default.markets
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 8
  - condition_id (String), token_id (String), question (String), category (String), outcome (String), closed (UInt8), winning_outcome (LowCardinality(String)), resolved_at (Nullable(DateTime))
- **Has Wallet Column:** ❌
- **Has Condition ID:** ✅
- **Has Market ID:** ❌
- **Has Token ID:** ✅
- **Has Timestamp:** ❌


#### default.market_to_condition_dict
- **Engine:** Dictionary
- **Rows:** N/A
- **Size:** N/A
- **Columns:** 2
  - market_id (String), condition_id (String)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ✅
- **Has Market ID:** ✅
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.trade_flows_v2
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 6
  - wallet (String), market_id (String), trade_idx (Int16), outcome_raw (Nullable(String)), cashflow_usdc (Float64), delta_shares (Float64)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ✅
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.trades_dedup_view
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 34
  - trade_id (String), wallet_address (String), market_id (String), timestamp (DateTime), side (Enum8('YES' = 1, 'NO' = 2)), entry_price (Decimal(18, 8)), exit_price (Nullable(Decimal(18, 8))), shares (Decimal(18, 8)), usd_value (Decimal(18, 2)), pnl (Nullable(Decimal(18, 2))), is_closed (Bool), transaction_hash (String), created_at (DateTime), close_price (Decimal(10, 6)), fee_usd (Decimal(18, 6)), slippage_usd (Decimal(18, 6)), hours_held (Decimal(10, 2)), bankroll_at_entry (Decimal(18, 2)), outcome (Nullable(Int8)), fair_price_at_entry (Decimal(10, 6)), pnl_gross (Decimal(18, 6)), pnl_net (Decimal(18, 6)), return_pct (Decimal(10, 6)), condition_id (String), was_win (Nullable(UInt8)), tx_timestamp (DateTime), canonical_category (String), raw_tags (Array(String)), realized_pnl_usd (Float64), is_resolved (UInt8), resolved_outcome (LowCardinality(String)), outcome_index (Int16), recovery_status (String), rn (UInt64)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ✅
- **Has Market ID:** ✅
- **Has Token ID:** ❌
- **Has Timestamp:** ✅


#### default.trades_unique
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 7
  - condition_id (String), amt (Decimal(18, 8)), ts (DateTime), tx_hash (String), entry_price (Decimal(18, 8)), side (Enum8('YES' = 1, 'NO' = 2)), wallet_address (String)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ✅
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.market_resolutions_flat
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 3
  - condition_id (String), winning_outcome (String), resolved_at (Nullable(DateTime64(3)))
- **Has Wallet Column:** ❌
- **Has Condition ID:** ✅
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.trades_working
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 31
  - trade_id (String), wallet_address (String), market_id (String), timestamp (DateTime), side (Enum8('YES' = 1, 'NO' = 2)), entry_price (Decimal(18, 8)), exit_price (Nullable(Decimal(18, 8))), shares (Decimal(18, 8)), usd_value (Decimal(18, 2)), pnl (Nullable(Decimal(18, 2))), is_closed (Bool), transaction_hash (String), created_at (DateTime), close_price (Decimal(10, 6)), fee_usd (Decimal(18, 6)), slippage_usd (Decimal(18, 6)), hours_held (Decimal(10, 2)), bankroll_at_entry (Decimal(18, 2)), outcome (Nullable(Int8)), fair_price_at_entry (Decimal(10, 6)), pnl_gross (Decimal(18, 6)), pnl_net (Decimal(18, 6)), return_pct (Decimal(10, 6)), condition_id (String), was_win (Nullable(UInt8)), tx_timestamp (DateTime), canonical_category (String), raw_tags (Array(String)), realized_pnl_usd (Float64), is_resolved (UInt8), resolved_outcome (Nullable(String))
- **Has Wallet Column:** ✅
- **Has Condition ID:** ✅
- **Has Market ID:** ✅
- **Has Token ID:** ❌
- **Has Timestamp:** ✅


#### default.unresolved_markets
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 5
  - condition_id_norm (String), trade_count (UInt64), total_volume (Decimal(38, 2)), first_trade (DateTime), last_trade (DateTime)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ✅
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.v_market_resolutions
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 6
  - condition_id_norm (FixedString(64)), outcome_count (UInt8), payout_numerators (Array(UInt8)), payout_denominator (UInt8), winning_index (Int64), winning_outcome (LowCardinality(String))
- **Has Wallet Column:** ❌
- **Has Condition ID:** ✅
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.vol_rank_by_condition
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 4
  - condition_id (String), vol (Decimal(38, 8)), trade_count (UInt64), last_trade (DateTime)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ✅
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.vol_rank_dedup
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 4
  - condition_id (String), vol (Decimal(38, 8)), trade_count (UInt64), last_trade (DateTime)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ✅
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.vw_condition_categories
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 5
  - condition_id (String), canonical_category (String), raw_tags (Array(String)), event_id (String), source (String)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ✅
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.vw_conditions_enriched
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 9
  - condition_id (String), cm.market_id (String), cm.event_id (String), e.canonical_category (String), e.raw_tags (Array(String)), event_title (String), market_question (String), category_final (String), tags_final (Array(String))
- **Has Wallet Column:** ❌
- **Has Condition ID:** ✅
- **Has Market ID:** ✅
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.vw_events_enriched
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 9
  - event_id (String), canonical_category (String), raw_tags (Array(String)), title (String), ingested_at (DateTime), condition_ids (Array(String)), market_ids (Array(String)), num_conditions (UInt64), num_markets (UInt64)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ✅
- **Has Market ID:** ✅
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.vw_markets_enriched
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 9
  - m.market_id (String), question (String), m.event_id (String), m.ingested_at (DateTime), condition_ids (Array(String)), canonical_category (String), raw_tags (Array(String)), event_title (String), num_conditions (UInt64)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ✅
- **Has Market ID:** ✅
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.vw_resolutions_truth
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 7
  - condition_id_norm (String), payout_numerators (Array(Float64)), payout_denominator (Float64), winning_index (Int32), resolved_at (Nullable(DateTime)), source (LowCardinality(String)), fetched_at (DateTime)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ✅
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.market_outcomes_expanded
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 3
  - condition_id_norm (FixedString(64)), outcome_idx (Int64), outcome_label (String)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ✅
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.vw_trades_direction
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 18
  - trade_id (UInt64), tx_hash (String), wallet_address (String), condition_id_norm (String), market_id (String), outcome_index (Int16), side_token (String), direction (String), shares (Decimal(18, 8)), price (Decimal(18, 8)), usd_value (Decimal(18, 2)), usdc_delta (UInt8), token_delta (UInt8), confidence (String), reason (String), recovery_status (String), data_source (String), computed_at (DateTime)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ✅
- **Has Market ID:** ✅
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.market_last_trade
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 2
  - condition_id (String), last_trade (DateTime)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ✅
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.market_last_price
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 2
  - market_id (String), last_price (String)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ❌
- **Has Market ID:** ✅
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.realized_pnl_by_resolution
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 11
  - wallet (String), w.market_id (String), w.condition_id (String), outcome_index (Int16), trade_count (UInt64), net_shares (Float64), winning_outcome (LowCardinality(String)), trade_outcome (String), is_winning (Float64), realized_pnl_usd (Nullable(Float64)), resolved_at (Nullable(DateTime64(3)))
- **Has Wallet Column:** ✅
- **Has Condition ID:** ✅
- **Has Market ID:** ✅
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.coverage_by_source
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 5
  - source (String), markets_covered (UInt64), avg_confidence (Float64), first_fetch (DateTime), last_fetch (DateTime)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.wallet_pnl_final_summary
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 11
  - wallet (String), resolved_markets (UInt64), total_positions (UInt64), winning_positions (UInt64), losing_positions (UInt64), win_rate_pct (Float64), total_realized_pnl (Nullable(Float64)), largest_win (Nullable(Float64)), largest_loss (Nullable(Float64)), first_resolved (Nullable(DateTime64(3))), last_resolved (Nullable(DateTime64(3)))
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.condition_id_bridge
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 2
  - market_id (String), condition_id_norm (String)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ✅
- **Has Market ID:** ✅
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.wallet_pnl_summary_v2
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 4
  - wallet (String), realized_pnl_usd (Float64), unrealized_pnl_usd (Float64), total_pnl_usd (Float64)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.wallet_positions
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 6
  - wallet (String), market_id (String), outcome (Nullable(Int8)), net_shares (Decimal(38, 8)), trade_count (UInt64), avg_entry_price (Nullable(String))
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ✅
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.wallet_positions_detailed
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 13
  - wallet (String), market_id (String), outcome (Nullable(Int8)), outcome_index (Int16), trade_count (UInt64), yes_shares (Float64), no_shares (Float64), net_shares (Float64), avg_entry_yes (Nullable(Float64)), avg_entry_no (Nullable(Float64)), first_buy (DateTime), last_sell (DateTime), total_notional_usd (Float64)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ✅
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.wallet_realized_pnl_v3
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 2
  - wallet (String), realized_pnl_usd (Float64)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.wallet_summary_metrics
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 14
  - wallet (String), markets_traded (UInt64), total_trades (UInt64), long_positions (UInt64), short_positions (UInt64), total_unrealized_pnl (Float64), total_notional_usd (Float64), winning_positions (UInt64), losing_positions (UInt64), win_rate_pct (Float64), largest_win (Float64), largest_loss (Float64), first_trade_date (DateTime), last_trade_date (DateTime)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ✅


#### default.wallet_trade_cashflows_by_outcome
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 13
  - wallet (String), market_id (String), condition_id (String), side (String), yes_count (UInt64), no_count (UInt64), yes_shares (Float64), no_shares (Float64), net_shares (Float64), avg_entry_yes (Nullable(Float64)), avg_entry_no (Nullable(Float64)), first_trade (DateTime), last_trade (DateTime)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ✅
- **Has Market ID:** ✅
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.wallet_unrealized_pnl_v2
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 2
  - wallet (String), unrealized_pnl_usd (Float64)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ❌
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.canonical_condition
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 2
  - market_id (String), condition_id_norm (String)
- **Has Wallet Column:** ❌
- **Has Condition ID:** ✅
- **Has Market ID:** ✅
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


#### default.portfolio_mtm_detailed
- **Engine:** View
- **Rows:** N/A (View)
- **Size:** N/A (View)
- **Columns:** 12
  - wallet (String), market_id (String), outcome (Nullable(Int8)), outcome_index (Int16), trade_count (UInt64), net_shares (Float64), avg_entry_price (Nullable(Float64)), last_price (String), unrealized_pnl_usd (Float64), total_notional_usd (Float64), first_buy (DateTime), last_sell (DateTime)
- **Has Wallet Column:** ✅
- **Has Condition ID:** ❌
- **Has Market ID:** ✅
- **Has Token ID:** ❌
- **Has Timestamp:** ❌


---

## Wallet Coverage Analysis

### Tables Containing Wallet 0x4ce73141dbfce41e65db3723e31059a730f0abad


#### default.trade_direction_assignments
- **Total Rows:** 75
- **Unique Condition IDs:** 32
- **Unique Market IDs:** 0
- **Unique Token IDs:** 0
- **Date Range:** null to null
- **Has Condition ID Column:** ✅
- **Has Market ID Column:** ❌
- **Has Token ID Column:** ❌


#### default.vw_trades_canonical
- **Total Rows:** 93
- **Unique Condition IDs:** 31
- **Unique Market IDs:** 31
- **Unique Token IDs:** 0
- **Date Range:** 2024-06-02 17:52:34 to 2024-11-06 02:38:57
- **Has Condition ID Column:** ✅
- **Has Market ID Column:** ✅
- **Has Token ID Column:** ❌


#### default.trades_with_direction
- **Total Rows:** 39
- **Unique Condition IDs:** 31
- **Unique Market IDs:** 31
- **Unique Token IDs:** 0
- **Date Range:** null to null
- **Has Condition ID Column:** ✅
- **Has Market ID Column:** ✅
- **Has Token ID Column:** ❌


#### default.realized_pnl_by_market_final
- **Total Rows:** 31
- **Unique Condition IDs:** 31
- **Unique Market IDs:** 31
- **Unique Token IDs:** 0
- **Date Range:** null to null
- **Has Condition ID Column:** ✅
- **Has Market ID Column:** ✅
- **Has Token ID Column:** ❌


#### default.trade_cashflows_v3
- **Total Rows:** 32
- **Unique Condition IDs:** 30
- **Unique Market IDs:** 0
- **Unique Token IDs:** 0
- **Date Range:** null to null
- **Has Condition ID Column:** ✅
- **Has Market ID Column:** ❌
- **Has Token ID Column:** ❌


#### default.outcome_positions_v2
- **Total Rows:** 30
- **Unique Condition IDs:** 30
- **Unique Market IDs:** 0
- **Unique Token IDs:** 0
- **Date Range:** null to null
- **Has Condition ID Column:** ✅
- **Has Market ID Column:** ❌
- **Has Token ID Column:** ❌


#### cascadian_clean.fact_trades_BROKEN_CIDS
- **Total Rows:** 31
- **Unique Condition IDs:** 0
- **Unique Market IDs:** 0
- **Unique Token IDs:** 0
- **Date Range:** 2024-06-02 17:52:34 to 2024-09-11 20:58:45
- **Has Condition ID Column:** ❌
- **Has Market ID Column:** ❌
- **Has Token ID Column:** ❌


#### cascadian_clean.fact_trades_clean
- **Total Rows:** 31
- **Unique Condition IDs:** 0
- **Unique Market IDs:** 0
- **Unique Token IDs:** 0
- **Date Range:** 2024-06-02 17:52:34 to 2024-09-11 20:58:45
- **Has Condition ID Column:** ❌
- **Has Market ID Column:** ❌
- **Has Token ID Column:** ❌


#### cascadian_clean.fact_trades_backup
- **Total Rows:** 31
- **Unique Condition IDs:** 0
- **Unique Market IDs:** 0
- **Unique Token IDs:** 0
- **Date Range:** 2024-06-02 17:52:34 to 2024-09-11 20:58:45
- **Has Condition ID Column:** ❌
- **Has Market ID Column:** ❌
- **Has Token ID Column:** ❌


#### cascadian_clean.position_lifecycle
- **Total Rows:** 14
- **Unique Condition IDs:** 0
- **Unique Market IDs:** 0
- **Unique Token IDs:** 0
- **Date Range:** null to null
- **Has Condition ID Column:** ❌
- **Has Market ID Column:** ❌
- **Has Token ID Column:** ❌


#### cascadian_clean.wallet_time_metrics
- **Total Rows:** 1
- **Unique Condition IDs:** 0
- **Unique Market IDs:** 0
- **Unique Token IDs:** 0
- **Date Range:** null to null
- **Has Condition ID Column:** ❌
- **Has Market ID Column:** ❌
- **Has Token ID Column:** ❌


#### default.erc20_transfers_staging
- **Total Rows:** 0
- **Unique Condition IDs:** 0
- **Unique Market IDs:** 0
- **Unique Token IDs:** 0
- **Date Range:** null to null
- **Has Condition ID Column:** ❌
- **Has Market ID Column:** ❌
- **Has Token ID Column:** ❌


#### default.fact_trades_clean
- **Total Rows:** 31
- **Unique Condition IDs:** 0
- **Unique Market IDs:** 0
- **Unique Token IDs:** 0
- **Date Range:** 2024-06-02 17:52:34.000 to 2024-09-11 20:58:45.000
- **Has Condition ID Column:** ❌
- **Has Market ID Column:** ❌
- **Has Token ID Column:** ❌


#### default.wallet_metrics_daily
- **Total Rows:** 17
- **Unique Condition IDs:** 0
- **Unique Market IDs:** 0
- **Unique Token IDs:** 0
- **Date Range:** 2024-06-02 17:52:34 to 2024-11-06 02:38:57
- **Has Condition ID Column:** ❌
- **Has Market ID Column:** ❌
- **Has Token ID Column:** ❌


#### default.wallet_metrics_complete
- **Total Rows:** 1
- **Unique Condition IDs:** 0
- **Unique Market IDs:** 0
- **Unique Token IDs:** 0
- **Date Range:** null to null
- **Has Condition ID Column:** ❌
- **Has Market ID Column:** ❌
- **Has Token ID Column:** ❌


#### default.wallet_metrics
- **Total Rows:** 1
- **Unique Condition IDs:** 0
- **Unique Market IDs:** 0
- **Unique Token IDs:** 0
- **Date Range:** null to null
- **Has Condition ID Column:** ❌
- **Has Market ID Column:** ❌
- **Has Token ID Column:** ❌


#### default.wallets_dim
- **Total Rows:** 1
- **Unique Condition IDs:** 0
- **Unique Market IDs:** 0
- **Unique Token IDs:** 0
- **Date Range:** null to null
- **Has Condition ID Column:** ❌
- **Has Market ID Column:** ❌
- **Has Token ID Column:** ❌


#### default.wallet_pnl_summary_final
- **Total Rows:** 1
- **Unique Condition IDs:** 0
- **Unique Market IDs:** 0
- **Unique Token IDs:** 0
- **Date Range:** null to null
- **Has Condition ID Column:** ❌
- **Has Market ID Column:** ❌
- **Has Token ID Column:** ❌


#### default.pm_erc1155_flats
- **Total Rows:** 0
- **Unique Condition IDs:** 0
- **Unique Market IDs:** 0
- **Unique Token IDs:** 0
- **Date Range:** 1970-01-01 00:00:00 to 1970-01-01 00:00:00
- **Has Condition ID Column:** ❌
- **Has Market ID Column:** ❌
- **Has Token ID Column:** ✅


#### default.wallet_metrics_30d
- **Total Rows:** 0
- **Unique Condition IDs:** 0
- **Unique Market IDs:** 0
- **Unique Token IDs:** 0
- **Date Range:** null to null
- **Has Condition ID Column:** ❌
- **Has Market ID Column:** ❌
- **Has Token ID Column:** ❌


---

## Gap Analysis

**Canonical View:** 31 markets
**Best Alternative:** 32 markets (default.trade_direction_assignments)
**Gap:** 1 additional markets

**Polymarket Target:** 2,816 markets
**Remaining Gap:** 2784 markets (98.9%)

---

## Backfill Feasibility


### ✅ BACKFILL POSSIBLE

**Source Table:** default.trade_direction_assignments
**Additional Markets:** 1
**Coverage Improvement:** 0.0%

#### Sample Data from Source Table

```json
[
  {
    "tx_hash": "0x904fafbf4ec5e6ecc166491b3856e13d6af83d4088ae1669446efbde674a6475",
    "wallet_address": "0x4ce73141dbfce41e65db3723e31059a730f0abad",
    "condition_id_norm": "",
    "direction": "UNKNOWN",
    "confidence": "LOW",
    "usdc_out": 0,
    "usdc_in": 0,
    "tokens_out": "0",
    "tokens_in": "0",
    "has_both_legs": false,
    "reason": "net_flow_logic",
    "created_at": "2025-11-05 22:57:25"
  },
  {
    "tx_hash": "0x129e13c1324a2d4641a1caf00b7daf3fb6cb464ede20163f9fd65316a4f581f7",
    "wallet_address": "0x4ce73141dbfce41e65db3723e31059a730f0abad",
    "condition_id_norm": "",
    "direction": "UNKNOWN",
    "confidence": "LOW",
    "usdc_out": 0,
    "usdc_in": 0,
    "tokens_out": "0",
    "tokens_in": "0",
    "has_both_legs": false,
    "reason": "net_flow_logic",
    "created_at": "2025-11-05 22:57:25"
  },
  {
    "tx_hash": "0x1b8a61974af7868102ef486d23a9fa2cd694767a078394096fb68cd3c19049ea",
    "wallet_address": "0x4ce73141dbfce41e65db3723e31059a730f0abad",
    "condition_id_norm": "dd5853b165c51d37acf3fa183029498eaaa89cc9bc6329183d0aa8f80c9e76f4",
    "direction": "UNKNOWN",
    "confidence": "LOW",
    "usdc_out": 0,
    "usdc_in": 0,
    "tokens_out": "0",
    "tokens_in": "0",
    "has_both_legs": false,
    "reason": "net_flow_logic",
    "created_at": "2025-11-05 22:57:25"
  }
]
```

#### Recommended Backfill Strategy

1. **Data Quality Check**
   - Verify condition_ids are valid (not 0x000...)
   - Check for duplicates
   - Validate timestamps

2. **JOIN Strategy**
   - Normalize condition_id in both tables
   - Use LEFT JOIN to find missing markets
   - Preserve canonical data, add new records

3. **SQL Pattern**
```sql
CREATE OR REPLACE VIEW default.vw_trades_canonical_EXPANDED AS
SELECT * FROM default.vw_trades_canonical
UNION ALL
SELECT
  -- Map columns from default.trade_direction_assignments
  tx_hash,
  block_timestamp,
  lower(replaceAll(condition_id, '0x', '')) as condition_id_norm,
  ...
FROM default.trade_direction_assignments source
LEFT JOIN default.vw_trades_canonical canonical
  ON lower(replaceAll(source.condition_id, '0x', '')) = canonical.condition_id_norm
  AND lower(source.wallet) = canonical.wallet_address_norm
WHERE canonical.condition_id_norm IS NULL
  AND source.condition_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
  AND source.wallet = '0x4ce73141dbfce41e65db3723e31059a730f0abad'
```

4. **Validation**
   - Test on 10 markets
   - Verify no duplicates
   - Check PnL calculations

5. **Execution**
   - Run full backfill
   - Monitor row counts
   - Validate final coverage



---

## Recommended Next Steps


1. ✅ **Backfill from default.trade_direction_assignments**
   - Gain 1 markets immediately
   - Reduces gap from 2785 to 2784 markets

2. 🔄 **API Backfill for Remaining 2784 Markets**
   - Query Polymarket API
   - Fill final gap

3. ✅ **Validate & Deploy**
   - Run comprehensive tests
   - Deploy to production


---

## Data Quality Issues

- **0x000... Condition IDs:** Present in some tables (filter these out)
- **Blank Fields:** Some tables have NULL/empty condition_ids
- **Duplicate Rows:** May exist across multiple tables
- **ID Format Inconsistency:** Mix of 0x-prefixed and raw hex

---

## Confidence Assessment

- **Coverage Confidence:** LOW
- **Data Quality:** MEDIUM
- **Backfill Feasibility:** MEDIUM

---

**Generated:** 2025-11-10T00:21:50.194Z
**Script:** COMPREHENSIVE_BACKFILL_INVESTIGATION.ts
