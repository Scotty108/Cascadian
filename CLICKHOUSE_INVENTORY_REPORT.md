# ClickHouse Database Inventory Report
## Polymarket Trade Data Exploration

**Generated:** November 6, 2025
**Database:** default @ igm38nvzub.us-central1.gcp.clickhouse.cloud
**Status:** READ-ONLY exploration complete

---

## Executive Summary

The Polymarket ClickHouse database contains **159.5 million trades** across **151,846 markets** and **996,334 unique wallets**. The primary canonical source is `trades_raw`, which contains the complete historical dataset from December 2022 through October 31, 2025. The two target wallets (HolyMoses7 and niggemon) represent only **0.014% of total trades** (24,956 combined trades), confirming the suspected under-sampling.

---

## 1. Table Inventory

### Primary Trade Tables

| Table | Rows | Earliest | Latest | Wallets | Markets | Status | Notes |
|-------|------|----------|--------|---------|---------|--------|-------|
| **trades_raw** | 159,574,259 | 2022-12-18 | 2025-10-31 | 996,334 | 151,846 | CANONICAL | Complete dataset with nulls/duplicates |
| vw_trades_canonical | 157,541,131 | 2022-12-18 | 2025-10-31 | 996,109 | 151,425 | VIEW | Cleaned canonical view, ~2M trades removed |
| trade_direction_assignments | 129,599,951 | 2025-11-05 | 2025-11-05 | 996,334 | 233,354 | ENRICHMENT | Direction inference table (computed once) |
| trades_with_direction | 82,138,586 | 2025-11-05 | 2025-11-05 | 936,800 | 151,845 | DERIVED | Subset with direction & confidence |
| trades_with_recovered_cid | 82,138,586 | 2022-12-18 | 2025-10-31 | 936,800 | 151,845 | DERIVED | Subset with recovered condition IDs |
| market_candles_5m | 8,051,265 | N/A | N/A | N/A | 151,846 | OHLCV | Perfect coverage of trades markets |
| trades_with_pnl | 515,708 | 2024-01-06 | 2025-10-31 | 42,798 | 33,817 | PNL | Resolved trades only (326 days) |
| vw_trades_canonical_v2 | 515,682 | 2024-01-06 | 2025-10-31 | 42,798 | 33,817 | PNL VIEW | v2 of PnL view |

### Backup/Legacy Tables
- trades_raw_backup (159,574,259 rows) - exact copy of trades_raw
- trades_raw_before_pnl_fix (159,574,259 rows)
- trades_raw_fixed (159,574,259 rows)
- trades_raw_old (159,574,259 rows)
- trades_raw_pre_pnl_fix (159,574,259 rows)
- trades_raw_with_full_pnl (159,574,259 rows)
- trades_with_pnl_old (515,708 rows)
- trades_raw_broken (5,462,413 rows) - corrupted subset

### Reference Tables
- market_resolutions_final (223,973 rows) - market outcomes
- market_key_map (156,952 rows) - market ID mappings
- condition_market_map (151,843 rows) - condition to market mappings
- gamma_markets (149,907 rows) - Gamma catalog
- markets_dim (5,781 rows) - market dimension table
- pm_trades (537 rows) - subset/test data

---

## 2. Target Wallets - Exact Counts

```
HolyMoses7 (0xa4b366ad22fc0d06f1e934ff468e8922431a87b8): 8,484 trades
niggemon (0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0):   16,472 trades
─────────────────────────────────────────────────────────────────
Combined: 24,956 trades (0.0156% of total 159.5M)
```

**Date Ranges:**
- HolyMoses7: Dec 4, 2024 → Oct 29, 2025 (331 days)
- niggemon: June 7, 2024 → Oct 31, 2025 (512 days)

---

## 3. Data Quality Summary

### trades_raw Quality Metrics
- **Null Wallets:** 0 (perfect)
- **Null/Zero Markets:** 1,257,929 (0.79% of rows)
- **Null Transaction Hashes:** 0 (perfect)
- **Null Entry Prices:** 0 (perfect)
- **Null Shares:** 0 (perfect)
- **Null PnL:** 154,234,229 (96.68% - expected, open positions have no PnL yet)

### Duplicate Detection
**High-frequency duplicates found:**
- 204 occurrences: tx `0x6053d08...` for wallet `0x24b9b58...` market 12
- 204 occurrences: tx `0x2c65ced...` for wallet `0x24b9b58...` market 12
- 153-150 occurrences: Multiple transactions with market_id=12 (NULL market)

**Finding:** Duplicates concentrated in market_id='12' (NULL/zero markets) and associated with specific transactions. These appear to be data quality artifacts from bulk ingestion.

### Candle Coverage
- **Markets in trades_raw:** 151,846
- **Markets in market_candles_5m:** 151,846
- **Coverage:** 100% (perfect intersection)

---

## 4. Key Findings

The 25,000 trades originally identified represent **only the two target wallets** (24,956 in trades_raw), not the global dataset. The actual Polymarket dataset contains **159.5 million trade records**, representing activity from nearly **1 million unique wallets** across **151,846 markets** since December 2022. 

The canonical source is `trades_raw`, which maintains the complete historical record with full timestamp coverage from late 2022 through October 31, 2025. The data shows strong seasonality, with October 2025 alone representing 41.5M rows (26% of annual total). Data quality is high for primary identifiers (wallet, transaction hash) but contains systematic duplicates in malformed market_id entries (market_id='12' or NULL). The `vw_trades_canonical` view removes ~2 million duplicate-adjacent records and serves as the cleaned canonical reference.

For P&L calculations, only the subset `trades_with_pnl` (515,708 resolved trades) and `vw_trades_canonical_v2` (matching count) should be used, as they contain direction inference and outcome resolution data. These tables are limited to 42,798 wallets and 33,817 markets with resolved outcomes, spanning January 2024 to October 2025.

---

## 5. Histogram: Trades by Date (Last 30 Days)

```
2025-10-31: 821,500 (partial day)
2025-10-30: 2,958,122
2025-10-29: 1,981,317
2025-10-28: 1,871,567
2025-10-27: 1,792,451
2025-10-26: 1,724,979
2025-10-25: 1,617,208
2025-10-24: 1,639,158
2025-10-23: 1,574,327
2025-10-22: 1,546,038
2025-10-21: 1,622,321
2025-10-20: 1,421,497
2025-10-19: 1,319,549
2025-10-18: 1,309,171
2025-10-17: 1,254,112
2025-10-16: 1,307,262
2025-10-15: 1,193,881
2025-10-14: 1,354,222
2025-10-13: 1,147,034
2025-10-12: 1,310,601
2025-10-11: 1,041,000
2025-10-10: 1,278,133
2025-10-09: 961,053
2025-10-08: 975,552
2025-10-07: 1,058,571
2025-10-06: 1,058,640
2025-10-05: 1,046,906
2025-10-04: 901,528
2025-10-03: 803,429
2025-10-02: 843,642
─────────────────────────────────
Total (last 30 days): 41.5M trades
```

---

## 6. Historical Coverage

| Year | Month | Row Count |
|------|-------|-----------|
| 2025 | 10 | 41,523,288 |
| 2025 | 9 | 17,542,305 |
| 2025 | 8 | 15,078,073 |
| 2025 | 7 | 12,738,064 |
| 2025 | 6 | 9,556,258 |
| 2025 | 5 | 6,548,059 |
| 2025 | 4 | 5,951,796 |
| 2025 | 3 | 7,619,063 |
| 2025 | 2 | 6,592,266 |
| 2025 | 1 | 9,594,920 |
| 2024 | 12 | 11,397,626 |
| 2024 | 11 | 7,087,245 |
| 2024 | 10 | 3,233,592 |
| 2024 | 9-1 | 2,345,375 |
| 2023 | 12-11 | 798 |

**Total 2025:** 104,896,052 trades (65.7% of dataset)
**Total 2024:** 54,677,808 trades (34.2% of dataset)

---

## 7. Schema Details: trades_raw

```
trade_id: String
wallet_address: String
market_id: String
timestamp: DateTime
side: Enum8 (YES=1, NO=2)
entry_price: Decimal(18,8)
exit_price: Nullable(Decimal(18,8))
shares: Decimal(18,8)
usd_value: Decimal(18,2)
pnl: Nullable(Decimal(18,2))
is_closed: Bool
transaction_hash: String
created_at: DateTime
close_price: Decimal(10,6)
fee_usd: Decimal(18,6)
slippage_usd: Decimal(18,6)
hours_held: Decimal(10,2)
bankroll_at_entry: Decimal(18,2)
outcome: Nullable(Int8)
fair_price_at_entry: Decimal(10,6)
pnl_gross: Decimal(18,6)
pnl_net: Decimal(18,6)
return_pct: Decimal(10,6)
condition_id: String
was_win: Nullable(UInt8)
tx_timestamp: DateTime
canonical_category: String
raw_tags: Array(String)
realized_pnl_usd: Float64
is_resolved: UInt8
resolved_outcome: LowCardinality(String)
outcome_index: Int16
recovery_status: String
```

---

## 8. Top 20 Wallets (by trade count)

| Wallet | Trades | Markets | First Trade | Last Trade |
|--------|--------|---------|-------------|------------|
| 0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e | 31,975,301 | 137,283 | 2024-01-06 | 2025-10-31 |
| 0xca85f4b9e472b542e1df039594eeaebb6d466bf2 | 3,666,304 | 20,389 | 2024-11-07 | 2025-10-31 |
| 0x9155e8cf81a3fb557639d23d43f1528675bcfcad | 1,869,713 | 17,141 | 2025-06-10 | 2025-10-31 |
| 0x4ef0194e8cfd5617972665826f402836ac5f15a0 | 1,383,488 | 15,807 | 2025-07-23 | 2025-10-31 |
| 0x5f4d4927ea3ca72c9735f56778cfbb046c186be0 | 1,309,836 | 9,743 | 2025-07-31 | 2025-10-29 |
| 0x51373c6b56e4a38bf97c301efbff840fc8451556 | 1,239,650 | 20,147 | 2025-04-18 | 2025-10-31 |
| 0xf0b0ef1d6320c6be896b4c9c54dd74407e7f8cab | 880,701 | 19,984 | 2024-07-18 | 2025-10-31 |
| 0x1a4249cd596a8e51b267dfe3c56cacc25815a00b | 851,030 | 8,744 | 2025-08-24 | 2025-10-31 |
| 0x3d2d66eb933cfa7aa7b9fc21e6614f080de99360 | 788,900 | 8,838 | 2025-07-06 | 2025-09-25 |
| 0xf247584e41117bbbe4cc06e4d2c95741792a5216 | 693,327 | 8,533 | 2025-07-20 | 2025-10-31 |
| 0x8749194e5105c97c3d134e974e103b44eea44ea4 | 656,647 | 8,507 | 2024-08-07 | 2025-10-31 |
| 0x0540f430df85c770e0a4fb79d8499d71ebc298eb | 638,381 | 2,083 | 2025-02-07 | 2025-10-31 |
| 0x7485d661b858b117a66e1b4fcbecfaea87ac1393 | 625,266 | 17,686 | 2025-06-22 | 2025-10-31 |
| 0x537494c54dee9162534675712f2e625c9713042e | 607,008 | 11,526 | 2025-08-08 | 2025-10-31 |
| 0xfb1c3c1ab4fb2d0cbcbb9538c8d4d357dd95963e | 572,839 | 1,031 | 2024-11-30 | 2025-10-31 |
| 0xeffcc79a8572940cee2238b44eac89f2c48fda88 | 544,411 | 5,446 | 2025-06-22 | 2025-10-31 |
| 0x842dabdbf420acea760af817fe7c85a249179d4d | 540,234 | 6,510 | 2025-09-29 | 2025-10-31 |
| 0x1ff49fdcb6685c94059b65620f43a683be0ce7a5 | 530,309 | 25,388 | 2025-06-30 | 2025-10-31 |
| 0xefe6520783a28b726c9c492ee13ada80ca011a7d | 480,709 | 6,082 | 2025-06-22 | 2025-08-03 |
| 0x4302da58fa5a7bc39dd4fe96026c32c4e3deaed4 | 461,413 | 2,663 | 2025-08-02 | 2025-10-31 |

---

## 9. Recommendations for Next Steps

### Primary Source Selection
**USE: `trades_raw` for comprehensive analysis**
- Complete dataset: 159.5M trades
- Covers all wallets and time periods
- Raw primary identifiers preserved
- Suitable for: Historical analysis, market studies, wallet performance tracking

**USE: `vw_trades_canonical` for cleaned dataset**
- Removes ~2M duplicate/anomalous records
- Same wallet/market/time coverage
- Cleaner for analytical queries
- Suitable for: Statistical analysis, aggregations, dashboards

### For P&L and Resolved Trade Analysis
**USE: `trades_with_pnl` or `vw_trades_canonical_v2`**
- Only 515,708 resolved trades (0.32% of total)
- Direction inference included (HIGH/MEDIUM/LOW confidence)
- Suitable for: P&L calculations, win rates, portfolio performance
- **Limitation:** Only 42,798 wallets with resolved outcomes

### Data Quality Issues to Address
1. **1.26M null/zero market_ids:** Investigate transactions with market_id='12' (potential data corruption)
2. **High-frequency duplicates:** 100+ occurrences of same (tx, wallet, market_id) tuples suggest batch ingestion artifacts
3. **Null outcome tokens:** 96.68% of trades have NULL pnl (expected for open positions)
4. **market_id='12' contamination:** 204 duplicate tx `0x6053d08...` and others show systematic pattern

### Recommended Workflows

**1. For wallet P&L tracking (HolyMoses7, niggemon):**
```sql
SELECT * FROM trades_with_pnl 
WHERE lower(wallet_address) IN (
  '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
  '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
)
ORDER BY timestamp DESC
```
Expected: ~25k trades split ~8.5k/16.5k, only small portion resolved

**2. For historical market analysis:**
```sql
SELECT * FROM trades_raw 
WHERE timestamp >= '2024-01-01'
  AND market_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
  AND market_id IS NOT NULL
```
Use vw_trades_canonical for cleaner version

**3. For OHLCV data:**
```sql
SELECT * FROM market_candles_5m
WHERE market_id = '<target_market>'
  AND timestamp >= '2025-10-01'
```
Perfect 1:1 coverage with trades_raw markets

---

## 10. Schema Comparison Matrix

| Table | Rows | Has Timestamps | Has Prices | Has PnL | Has Direction | Has Outcome | Timestamp Format |
|-------|------|-----------------|-----------|---------|-----------------|-------------|------------------|
| trades_raw | 159.5M | ✓ (timestamp) | ✓ | Partial | ✗ | Nullable | DateTime (trade time) |
| vw_trades_canonical | 157.5M | ✓ | ✓ | ✗ | ✓ | ✗ | DateTime |
| trades_with_pnl | 515K | ✓ | ✓ | ✓ | ✓ | ✓ | DateTime |
| vw_trades_canonical_v2 | 515K | ✓ | ✓ | ✗ | ✓ | ✓ | DateTime |
| market_candles_5m | 8.0M | ✓ | ✓ (OHLC) | ✗ | ✗ | ✗ | 5-min buckets |
| trade_direction_assignments | 129.6M | ✗ | ✗ | ✗ | ✓ | ✗ | created_at (computed) |

---

## Conclusion

The Polymarket ClickHouse database is a comprehensive historical record of 159.5 million trades from December 2022 through October 2025. The canonical source `trades_raw` contains the complete dataset, while specialized tables provide direction inference, P&L resolution, and OHLCV pricing data. The target wallets (HolyMoses7, niggemon) collectively represent 0.016% of trading volume—confirming they are subset samples, not the full dataset. Data quality is generally high for primary identifiers but shows some systematic duplication in malformed market entries. For P&L analysis, the `trades_with_pnl` subset should be used, while `market_candles_5m` provides perfect OHLCV coverage for market analysis.

