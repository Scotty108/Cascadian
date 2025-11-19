# ClickHouse Table Inventory Report

Generated: 2025-11-13T04:32:27.311Z

## Executive Summary

This report provides a comprehensive inventory of all tables in the ClickHouse database system for the Cascadian project, focusing on Polymarket trading data and analytics.

### Key Metrics

- **Total Tables**: 228
- **Databases Explored**: default, cascadian_clean, staging
- **Data Coverage**: From 1970-01-01 00:00:00 to 2025-11-13 00:52:05

### Infrastructure Overview

The database contains comprehensive Polymarket trading infrastructure with multiple data streams:

**Trading Data Sources:**
- CLOB (Central Limit Order Book) fills and order data
- ERC1155 token transfer events from blockchain
- Gamma markets integration for market metadata
- Market resolution outcomes and settlement data

**Analytics Infrastructure:**
- Real-time P&L calculations and wallet metrics
- Position tracking and trade history
- Market analytics and resolution tracking
- Wallet performance scoring and smart money detection

## Table Categories

### CLOB Tables (4)
Central Limit Order Book trading data from Polymarket's order matching system.

| Table | Rows | Size | Description |
|-------|------|------|-------------|
| clob_fills | 38945566 | 3.49 GiB | CLOB (Central Limit Order Book) data. Order fill data. |
| vw_clob_fills_enriched | 0 | N/A | CLOB (Central Limit Order Book) data. Order fill data. |
| clob_asset_map_dome | 0 | 0.00 B | CLOB (Central Limit Order Book) data. |
| clob_asset_map_goldsky | 0 | 0.00 B | CLOB (Central Limit Order Book) data. |

### ERC1155 Tables (6)
Ethereum ERC1155 token transfer data for conditional tokens.

| Table | Rows | Size | Description |
|-------|------|------|-------------|
| erc1155_transfers | 61379951 | 1.30 GiB | ERC1155 token transfer data. |
| erc1155_transfers_backup_20251111a | 206112 | 6.98 MiB | ERC1155 token transfer data. |
| erc1155_transfers_backup_20251111b | 206112 | 6.98 MiB | ERC1155 token transfer data. |
| erc1155_transfers_old | 206112 | 6.98 MiB | ERC1155 token transfer data. |
| pm_erc1155_flats | 206112 | 7.41 MiB | ERC1155 token transfer data. |
| erc1155_condition_map | 41306 | 3.23 MiB | ERC1155 token transfer data. |

### Gamma Tables (2)
Gamma markets data integration and market metadata.

| Table | Rows | Size | Description |
|-------|------|------|-------------|
| gamma_markets | 149908 | 21.54 MiB | Gamma markets and trading data. Market metadata and information. |
| gamma_resolved | 123245 | 3.82 MiB | Gamma markets and trading data. |

### Market Tables (40)
Market information and metadata.

| Table | Rows | Size | Description |
|-------|------|------|-------------|
| realized_pnl_by_market_backup_20251111 | 13516535 | 432.40 MiB | Market metadata and information. Profit and loss calculations. |
| market_candles_5m | 8051265 | 221.76 MiB | Market metadata and information. |
| realized_pnl_by_market_backup | 6857733 | 249.11 MiB | Market metadata and information. Profit and loss calculations. |
| dim_markets | 318535 | 33.36 MiB | Market metadata and information. |
| dim_markets_old | 318535 | 32.89 MiB | Market metadata and information. |
| ctf_to_market_bridge_mat | 275217 | 16.80 MiB | Market metadata and information. |
| token_condition_market_map | 227838 | 13.64 MiB | Market metadata and information. |
| market_resolutions_final | 218325 | 7.94 MiB | Market metadata and information. Market resolution outcomes. |
| market_id_mapping | 187071 | 10.42 MiB | Market metadata and information. |
| api_markets_staging | 161180 | 22.89 MiB | Market metadata and information. |
| market_key_map | 156952 | 7.18 MiB | Market metadata and information. |
| condition_market_map | 151843 | 9.17 MiB | Market metadata and information. |
| gamma_markets | 149908 | 21.54 MiB | Gamma markets and trading data. Market metadata and information. |
| market_outcomes | 149907 | 4.83 MiB | Market metadata and information. |
| market_resolutions | 137391 | 4.77 MiB | Market metadata and information. Market resolution outcomes. |
| market_resolutions_by_market | 133895 | 1.04 MiB | Market metadata and information. Market resolution outcomes. |
| merged_market_mapping | 41306 | 1.89 MiB | Market metadata and information. |
| api_market_backfill | 5983 | 202.61 KiB | Market metadata and information. Order fill data. |
| markets_dim | 5781 | 89.94 KiB | Market metadata and information. |
| market_metadata_wallet_enriched | 141 | 10.58 KiB | Market metadata and information. Wallet analytics and metrics. |
| unresolved_ctf_markets | 5 | 1.50 KiB | Market metadata and information. |
| market_event_mapping | 0 | 0.00 B | Market metadata and information. |
| market_last_price | 0 | N/A | Market metadata and information. |
| market_last_trade | 0 | N/A | Market metadata and information. |
| market_outcomes_expanded | 0 | N/A | Market metadata and information. |
| market_resolutions_flat | 0 | N/A | Market metadata and information. Market resolution outcomes. |
| market_resolutions_norm | 0 | N/A | Market metadata and information. Market resolution outcomes. |
| market_to_condition_dict | 0 | N/A | Market metadata and information. |
| markets | 0 | N/A | Market metadata and information. |
| realized_pnl_by_market_blockchain | 0 | N/A | Market metadata and information. Profit and loss calculations. |
| realized_pnl_by_market_final | 0 | N/A | Market metadata and information. Profit and loss calculations. |
| realized_pnl_by_market_v3 | 0 | N/A | Market metadata and information. Profit and loss calculations. |
| unresolved_markets | 0 | N/A | Market metadata and information. |
| v_market_resolutions | 0 | N/A | Market metadata and information. Market resolution outcomes. |
| vw_markets_enriched | 0 | N/A | Market metadata and information. |
| vw_market_pnl_unified | 0 | N/A | Market metadata and information. Profit and loss calculations. |
| vw_token_to_market | 0 | N/A | Market metadata and information. |
| vw_traded_markets | 0 | N/A | Market metadata and information. |
| vw_trading_pnl_polymarket_style | 0 | N/A | Market metadata and information. Profit and loss calculations. |
| vw_wallet_pnl_polymarket_style | 0 | N/A | Market metadata and information. Wallet analytics and metrics. Profit and loss calculations. |

### Trading Tables (29)
Trade execution and transaction data.

| Table | Rows | Size | Description |
|-------|------|------|-------------|
| vw_trades_canonical | 157541131 | 11.84 GiB | Trading activity and transactions. |
| trade_direction_assignments | 129599951 | 5.81 GiB | General data table. |
| trades_with_direction | 95354665 | 6.60 GiB | Trading activity and transactions. |
| trades_with_direction_backup | 82138586 | 5.25 GiB | Trading activity and transactions. |
| fact_trades_BROKEN_CIDS | 63541482 | 4.36 GiB | Trading activity and transactions. |
| fact_trades_clean | 63541461 | 4.37 GiB | Trading activity and transactions. |
| fact_trades_backup | 63380210 | 2.80 GiB | Trading activity and transactions. |
| fact_trades_clean | 63380204 | 2.93 GiB | Trading activity and transactions. |
| trade_cashflows_v3_buggy | 58400345 | 394.33 MiB | General data table. |
| trade_cashflows_v3_corrupted | 35874799 | 419.90 MiB | General data table. |
| api_trades_staging | 0 | 0.00 B | Trading activity and transactions. |
| market_last_trade | 0 | N/A | Market metadata and information. |
| resolved_trades_v2 | 0 | N/A | Trading activity and transactions. |
| trade_cashflows_v3 | 0 | N/A | General data table. |
| trade_cashflows_v3_backup | 0 | N/A | General data table. |
| trade_cashflows_v3_blockchain | 0 | N/A | General data table. |
| trade_flows_v2 | 0 | N/A | General data table. |
| trades_dedup_view | 0 | N/A | Trading activity and transactions. |
| trades_raw | 0 | N/A | Trading activity and transactions. |
| trades_unique | 0 | N/A | Trading activity and transactions. |
| trades_working | 0 | N/A | Trading activity and transactions. |
| vw_latest_trade_prices | 0 | N/A | General data table. |
| vw_trades_direction | 0 | N/A | Trading activity and transactions. |
| wallet_trade_cashflows_by_outcome | 0 | N/A | Wallet analytics and metrics. |
| vw_trade_pnl | 0 | N/A | Profit and loss calculations. |
| vw_trade_pnl_final | 0 | N/A | Profit and loss calculations. |
| vw_traded_any_norm | 0 | N/A | General data table. |
| vw_traded_markets | 0 | N/A | Market metadata and information. |
| vw_trades_ledger | 0 | N/A | Trading activity and transactions. |

### Wallet Tables (47)
Wallet analytics and performance tracking.

| Table | Rows | Size | Description |
|-------|------|------|-------------|
| system_wallet_map | 23252314 | 1.86 GiB | Wallet analytics and metrics. |
| wallet_metrics_daily | 14375255 | 241.81 MiB | Wallet analytics and metrics. |
| wallet_metrics_complete | 1000818 | 41.46 MiB | Wallet analytics and metrics. |
| wallets_dim | 996108 | 30.83 MiB | Wallet analytics and metrics. |
| wallet_identity_map | 735637 | 51.09 MiB | Wallet analytics and metrics. |
| wallet_metrics_30d | 12842 | 872.34 KiB | Wallet analytics and metrics. |
| market_metadata_wallet_enriched | 141 | 10.58 KiB | Market metadata and information. Wallet analytics and metrics. |
| wallet_time_metrics | 23 | 6.41 KiB | Wallet analytics and metrics. |
| pm_user_proxy_wallets_v2 | 6 | 2.16 KiB | Wallet analytics and metrics. |
| wallet_ui_map | 3 | 1.43 KiB | Wallet analytics and metrics. |
| system_wallets | 1 | 234.00 B | Wallet analytics and metrics. |
| all_unique_wallets | 0 | N/A | Wallet analytics and metrics. |
| vw_wallet_leaderboard_with_mapping | 0 | N/A | Wallet analytics and metrics. |
| vw_wallet_metrics_with_mapping | 0 | N/A | Wallet analytics and metrics. |
| vw_wallet_pnl_calculated | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| vw_wallet_pnl_calculated_backup | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| vw_wallet_pnl_summary | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| vw_wallet_pnl_with_mapping | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| vw_wallet_total_pnl | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| wallet_condition_pnl | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| wallet_condition_pnl_token | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| wallet_metrics | 0 | 0.00 B | Wallet analytics and metrics. |
| wallet_payout_collected | 0 | N/A | Wallet analytics and metrics. |
| wallet_pnl_final_summary | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| wallet_pnl_summary_final | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| wallet_pnl_summary_v2 | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| wallet_positions | 0 | N/A | Wallet analytics and metrics. Position tracking data. |
| wallet_positions_detailed | 0 | N/A | Wallet analytics and metrics. Position tracking data. |
| wallet_realized_pnl | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| wallet_realized_pnl_final | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| wallet_realized_pnl_v3 | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| wallet_summary_metrics | 0 | N/A | Wallet analytics and metrics. |
| wallet_token_flows | 0 | N/A | Wallet analytics and metrics. |
| wallet_trade_cashflows_by_outcome | 0 | N/A | Wallet analytics and metrics. |
| wallet_unrealized_pnl_v2 | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| vw_wallet_metrics | 0 | N/A | Wallet analytics and metrics. |
| vw_wallet_pnl | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| vw_wallet_pnl_all | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| vw_wallet_pnl_closed | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| vw_wallet_pnl_fast | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| vw_wallet_pnl_polymarket_style | 0 | N/A | Market metadata and information. Wallet analytics and metrics. Profit and loss calculations. |
| vw_wallet_pnl_settled | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| vw_wallet_pnl_simple | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| vw_wallet_pnl_unified | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| vw_wallet_positions | 0 | N/A | Wallet analytics and metrics. Position tracking data. |
| vw_wallet_trading_pnl_summary | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| vw_wallet_unrealized_pnl_summary | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |

### P&L Tables (40)
Profit and loss calculations and financial metrics.

| Table | Rows | Size | Description |
|-------|------|------|-------------|
| realized_pnl_by_market_backup_20251111 | 13516535 | 432.40 MiB | Market metadata and information. Profit and loss calculations. |
| realized_pnl_by_market_backup | 6857733 | 249.11 MiB | Market metadata and information. Profit and loss calculations. |
| pnl_final_by_condition | 0 | N/A | Profit and loss calculations. |
| realized_pnl_by_market_blockchain | 0 | N/A | Market metadata and information. Profit and loss calculations. |
| realized_pnl_by_market_final | 0 | N/A | Market metadata and information. Profit and loss calculations. |
| realized_pnl_by_market_v3 | 0 | N/A | Market metadata and information. Profit and loss calculations. |
| realized_pnl_by_resolution | 0 | N/A | Profit and loss calculations. Market resolution outcomes. |
| test_rpnl_debug | 0 | N/A | Profit and loss calculations. |
| vw_wallet_pnl_calculated | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| vw_wallet_pnl_calculated_backup | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| vw_wallet_pnl_summary | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| vw_wallet_pnl_with_mapping | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| vw_wallet_total_pnl | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| wallet_condition_pnl | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| wallet_condition_pnl_token | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| wallet_pnl_final_summary | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| wallet_pnl_summary_final | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| wallet_pnl_summary_v2 | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| wallet_realized_pnl | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| wallet_realized_pnl_final | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| wallet_realized_pnl_v3 | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| wallet_unrealized_pnl_v2 | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| vw_market_pnl_unified | 0 | N/A | Market metadata and information. Profit and loss calculations. |
| vw_pnl_coverage_metrics | 0 | N/A | Profit and loss calculations. |
| vw_redemption_pnl | 0 | N/A | Profit and loss calculations. |
| vw_trade_pnl | 0 | N/A | Profit and loss calculations. |
| vw_trade_pnl_final | 0 | N/A | Profit and loss calculations. |
| vw_trading_pnl_polymarket_style | 0 | N/A | Market metadata and information. Profit and loss calculations. |
| vw_trading_pnl_positions | 0 | N/A | Profit and loss calculations. Position tracking data. |
| vw_trading_pnl_realized | 0 | N/A | Profit and loss calculations. |
| vw_wallet_pnl | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| vw_wallet_pnl_all | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| vw_wallet_pnl_closed | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| vw_wallet_pnl_fast | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| vw_wallet_pnl_polymarket_style | 0 | N/A | Market metadata and information. Wallet analytics and metrics. Profit and loss calculations. |
| vw_wallet_pnl_settled | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| vw_wallet_pnl_simple | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| vw_wallet_pnl_unified | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| vw_wallet_trading_pnl_summary | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |
| vw_wallet_unrealized_pnl_summary | 0 | N/A | Wallet analytics and metrics. Profit and loss calculations. |

### Position Tables (12)
Position tracking and inventory management.

| Table | Rows | Size | Description |
|-------|------|------|-------------|
| outcome_positions_v2_backup_20251112T061455 | 6023856 | 334.19 MiB | Position tracking data. |
| position_lifecycle | 12234 | 520.54 KiB | Position tracking data. |
| api_positions_staging | 2107 | 177.20 KiB | Position tracking data. |
| outcome_positions_v2 | 0 | N/A | Position tracking data. |
| outcome_positions_v2_backup | 0 | N/A | Position tracking data. |
| outcome_positions_v2_blockchain | 0 | N/A | Position tracking data. |
| outcome_positions_v3 | 0 | N/A | Position tracking data. |
| wallet_positions | 0 | N/A | Wallet analytics and metrics. Position tracking data. |
| wallet_positions_detailed | 0 | N/A | Wallet analytics and metrics. Position tracking data. |
| vw_positions_open | 0 | N/A | Position tracking data. |
| vw_trading_pnl_positions | 0 | N/A | Profit and loss calculations. Position tracking data. |
| vw_wallet_positions | 0 | N/A | Wallet analytics and metrics. Position tracking data. |

### Fill Tables (7)
Order fill and execution data.

| Table | Rows | Size | Description |
|-------|------|------|-------------|
| clob_fills | 38945566 | 3.49 GiB | CLOB (Central Limit Order Book) data. Order fill data. |
| backfill_progress | 331485 | 9.81 MiB | Order fill data. |
| api_market_backfill | 5983 | 202.61 KiB | Market metadata and information. Order fill data. |
| backfill_checkpoint | 2782 | 13.30 KiB | Order fill data. |
| vw_clob_fills_enriched | 0 | N/A | CLOB (Central Limit Order Book) data. Order fill data. |
| vw_backfill_targets | 0 | N/A | Order fill data. |
| vw_backfill_targets_fixed | 0 | N/A | Order fill data. |

### Resolution Tables (26)
Market resolution and settlement data.

| Table | Rows | Size | Description |
|-------|------|------|-------------|
| staging_resolutions_union | 544475 | 5.85 MiB | Market resolution outcomes. |
| resolution_candidates | 424095 | 22.72 MiB | All resolution candidates from all sources |
| market_resolutions_final | 218325 | 7.94 MiB | Market metadata and information. Market resolution outcomes. |
| market_resolutions | 137391 | 4.77 MiB | Market metadata and information. Market resolution outcomes. |
| market_resolutions_by_market | 133895 | 1.04 MiB | Market metadata and information. Market resolution outcomes. |
| resolution_timestamps | 132912 | 4.44 MiB | Market resolution outcomes. |
| resolutions_external_ingest | 132912 | 4.47 MiB | External resolution data from Goldsky subgraph and other sources |
| resolutions_src_api | 130300 | 3.77 MiB | Market resolution outcomes. |
| resolutions_by_cid | 176 | 6.39 KiB | Market resolution outcomes. |
| market_resolutions_flat | 0 | N/A | Market metadata and information. Market resolution outcomes. |
| market_resolutions_norm | 0 | N/A | Market metadata and information. Market resolution outcomes. |
| realized_pnl_by_resolution | 0 | N/A | Profit and loss calculations. Market resolution outcomes. |
| resolution_candidates_norm | 0 | N/A | Market resolution outcomes. |
| resolution_candidates_ranked | 0 | N/A | Market resolution outcomes. |
| resolution_conflicts | 0 | N/A | Market resolution outcomes. |
| resolution_rollup | 0 | N/A | Market resolution outcomes. |
| resolutions_norm | 0 | N/A | Market resolution outcomes. |
| v_market_resolutions | 0 | N/A | Market metadata and information. Market resolution outcomes. |
| vw_resolutions_truth | 0 | N/A | Market resolution outcomes. |
| vw_resolutions_all | 0 | N/A | Market resolution outcomes. |
| vw_resolutions_cid | 0 | N/A | Market resolution outcomes. |
| vw_resolutions_clean | 0 | N/A | Market resolution outcomes. |
| vw_resolutions_enhanced | 0 | N/A | Market resolution outcomes. |
| vw_resolutions_from_staging | 0 | N/A | Market resolution outcomes. |
| vw_resolutions_truth | 0 | N/A | Market resolution outcomes. |
| vw_resolutions_unified | 0 | N/A | Market resolution outcomes. |

## Data Quality Assessment

### Empty Tables
131 tables are currently empty:
```
default.all_unique_wallets
default.canonical_condition
default.cid_bridge
default.condition_id_bridge
default.coverage_by_source
default.ctf_token_decoded
default.ctf_token_map_norm
default.ctf_token_map_v2
default.market_last_price
default.market_last_trade
default.market_outcomes_expanded
default.market_resolutions_flat
default.market_resolutions_norm
default.market_to_condition_dict
default.markets
default.missing_by_vol
default.missing_condition_ids
default.missing_ranked
default.omega_leaderboard
default.outcome_positions_v2
... and 111 more
```

### Large Tables
3 tables exceed 100 million rows:
- **default.erc20_transfers_staging**: 387728806 rows (18.00 GiB)
- **default.trade_direction_assignments**: 129599951 rows (5.81 GiB)
- **default.vw_trades_canonical**: 157541131 rows (11.84 GiB)

### Time Coverage
Data spans from **1970-01-01 00:00:00** to **2025-11-13 00:52:05** across 37 timestamped tables.

## Architecture Insights

### Core Infrastructure

**Multi-Source Data Integration:**
The system successfully integrates data from multiple sources including Polymarket CLOB API, blockchain ERC1155 events, and Gamma markets API. This comprehensive approach ensures complete coverage of trading activity.

**Real-Time Analytics Pipeline:**
The presence of materialized views and frequently updated tables suggests a robust real-time analytics pipeline capable of processing large volumes of trading data with sub-second latency.

**Scalable Design:**
Use of ClickHouse's ReplacingMergeTree and other specialized engines indicates optimization for high-write workloads typical of financial data systems.

### Data Flow Architecture

1. **Ingestion Layer**: Raw data from CLOB API, blockchain events, and market data APIs
2. **Processing Layer**: Data normalization, enrichment, and aggregation
3. **Analytics Layer**: Real-time P&L calculation, wallet scoring, and market analytics
4. **Presentation Layer**: Dashboards, APIs, and reporting interfaces

### Performance Optimization

The schema design shows several performance optimization strategies:
- Appropriate use of specialized engines (ReplacingMergeTree, SummingMergeTree)
- Strategic indexing on wallet addresses, market IDs, and timestamps
- Efficient data partitioning and clustering
- Materialized views for complex aggregations

## Recommendations

1. **Monitoring**: Implement monitoring for table sizes and growth rates
2. **Backup Strategy**: Ensure regular backups for critical financial data
3. **Data Retention**: Define retention policies for historical data
4. **Performance**: Monitor query performance on large tables
5. **Data Quality**: Regular validation of P&L calculations and market data consistency

---

*Report generated by ClickHouse Database Navigator Agent*
*Generated: 2025-11-13T04:32:27.311Z*
