# ClickHouse Table Inventory - Complete Database Map
**Generated:** 2025-11-14 PST
**Terminal:** Schema Navigator Agent (C1)
**Databases Analyzed:** 4
**Total Tables:** 237
**Total Rows:** 1,419,736,327
**Total Storage:** 72.14 GB

## Executive Summary

Comprehensive inventory of all ClickHouse tables across 4 databases.

- **1.42 billion rows** across 237 tables
- **72 GB** compressed storage
- **105** physical tables
- **132** views
- **142** empty tables
- **25** backup/old tables

**cascadian_clean:** 58 tables, 214,472,793 rows, 13.45 GB  
**default:** 165 tables, 1,204,755,246 rows, 58.66 GB  
**sandbox:** 9 tables, 310,476 rows, 0.02 GB  
**staging:** 5 tables, 197,812 rows, 0.01 GB  

---

## Key Statistics

### Top 20 Largest Tables by Row Count

| Rank | Table | Database | Rows | Size |
|------|-------|----------|------|------|
| 1 | erc20_transfers_staging | default | 387,728,806 | 18.00 GiB |
| 2 | vw_trades_canonical | default | 157,541,131 | 11.84 GiB |
| 3 | trade_direction_assignments | default | 129,599,951 | 5.81 GiB |
| 4 | trades_with_direction | default | 95,354,665 | 6.60 GiB |
| 5 | trades_with_direction_backup | default | 82,138,586 | 5.25 GiB |
| 6 | fact_trades_BROKEN_CIDS | cascadian_clean | 63,541,482 | 4.36 GiB |
| 7 | fact_trades_clean | cascadian_clean | 63,541,461 | 4.37 GiB |
| 8 | fact_trades_backup | cascadian_clean | 63,380,210 | 2.80 GiB |
| 9 | fact_trades_clean | default | 63,380,204 | 2.93 GiB |
| 10 | erc1155_transfers | default | 61,379,951 | 1.30 GiB |
| 11 | trade_cashflows_v3_buggy | default | 58,400,345 | 394.33 MiB |
| 12 | clob_fills | default | 38,945,566 | 3.49 GiB |
| 13 | trade_cashflows_v3_corrupted | default | 35,874,799 | 419.90 MiB |
| 14 | system_wallet_map | cascadian_clean | 23,252,314 | 1.89 GiB |
| 15 | erc20_transfers_decoded | default | 21,103,660 | 591.04 MiB |
| 16 | realized_pnl_by_market_backup_20251111 | default | 13,516,535 | 432.40 MiB |
| 17 | .inner_id.e427ab42-eba2-4349-9104-9afd200f8417 | default | 13,047,868 | 219.11 MiB |
| 18 | wallet_metrics_daily | default | 13,047,868 | 219.11 MiB |
| 19 | market_candles_5m | default | 8,051,265 | 221.76 MiB |
| 20 | realized_pnl_by_market_backup | default | 6,857,733 | 249.11 MiB |

### Table Categories

**CLOB (Trading Data):** 4 tables, 38,945,566 rows
**Gamma (Market Metadata):** 2 tables, 273,153 rows
**ERC-1155 (Share Tokens):** 6 tables, 62,245,705 rows
**ERC-20 (USDC):** 3 tables, 409,121,147 rows
**Mapping/Bridge:** 48 tables, 27,745,610 rows
**P&L Analysis:** 42 tables, 20,374,268 rows

---

## Data Quality Issues

### Empty Tables: 142

Views with no materialized data (expected) and physical tables with 0 rows:

**12 physical empty tables:**
- `default.ctf_token_map_backup_1762932891550`
- `default.market_event_mapping`
- `default.ctf_token_map_broken_1762932985339`
- `default.api_trades_staging`
- `default.wallet_metrics`
- `default.ctf_token_map_broken_1762933496168`
- `default.ctf_token_map_new`
- `sandbox.dome_benchmark_pnl`
- `sandbox.fills_norm_fixed`
- `sandbox.realized_pnl_by_market_v2`
- `staging.clob_asset_map_dome`
- `staging.clob_asset_map_goldsky`

### Backup/Old Tables: 25

Consuming storage, may be safe to archive:

- `default.trades_with_direction_backup` (82,138,586 rows, 5.25 GiB)
- `cascadian_clean.fact_trades_BROKEN_CIDS` (63,541,482 rows, 4.36 GiB)
- `cascadian_clean.fact_trades_backup` (63,380,210 rows, 2.80 GiB)
- `default.realized_pnl_by_market_backup_20251111` (13,516,535 rows, 432.40 MiB)
- `default.trade_cashflows_v3_corrupted` (35,874,799 rows, 419.90 MiB)
- `default.trade_cashflows_v3_buggy` (58,400,345 rows, 394.33 MiB)
- `default.outcome_positions_v2_backup_20251112T061455` (6,023,856 rows, 334.19 MiB)
- `default.realized_pnl_by_market_backup` (6,857,733 rows, 249.11 MiB)
- `default.dim_markets_old` (318,535 rows, 32.89 MiB)
- `default.ctf_token_map_backup_20251112` (140,036 rows, 9.23 MiB)
- `default.erc1155_transfers_backup_20251111b` (206,112 rows, 6.98 MiB)
- `default.erc1155_transfers_backup_20251111a` (206,112 rows, 6.98 MiB)
- `default.erc1155_transfers_old` (206,112 rows, 6.98 MiB)
- `default.dim_current_prices_old` (39,761 rows, 2.80 MiB)
- `default.ctf_token_map_backup_20251111` (41,130 rows, 1.46 MiB)

---

## Recommendations

1. **Cleanup:** Drop empty physical tables and old backups (save ~15 GB)
2. **Consolidation:** Merge duplicate views and mapping tables
3. **Documentation:** Map view dependencies before any changes
4. **Optimization:** Review largest tables for partitioning/compression

---

**Complete JSON data:** `CLICKHOUSE_TABLE_INVENTORY.json`

**Signature:** Schema Navigator Agent (C1)
**Timestamp:** 2025-11-14 20:35 PST
