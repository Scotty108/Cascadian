# ClickHouse Database Documentation Index

Complete exploration and inventory of the Polymarket ClickHouse database.
Generated: November 6, 2025 | Status: READ-ONLY | Database: default @ igm38nvzub.us-central1.gcp.clickhouse.cloud

---

## Quick Facts
- **Total Trades:** 159,574,259 (complete dataset)
- **Unique Wallets:** 996,334
- **Unique Markets:** 151,846
- **Date Coverage:** December 18, 2022 → October 31, 2025
- **Target Wallets Trades:** 24,956 (0.0156% of total)

---

## Documentation Files

### 1. CLICKHOUSE_SUMMARY.md (Quick Reference)
**Start here for overview**
- Key numbers and tables at a glance
- Target wallet counts
- Data quality metrics
- Recommended SQL queries
- Quick lookup table

### 2. CLICKHOUSE_INVENTORY_REPORT.md (Full Report)
**Comprehensive deep-dive**
- Table inventory with stats
- Target wallet exact counts
- Data quality analysis
- Key findings and insights
- Histogram and coverage data
- Top 20 wallets by trade count
- Recommendations for next steps
- Schema comparison matrix
- Conclusion and next steps

### 3. CLICKHOUSE_SCHEMA_REFERENCE.md (Technical Spec)
**Column-level documentation**
- Complete field listings for each table
- Data types and descriptions
- Special columns and their meanings
- Reference table documentation
- Known data quality issues
- Query optimization tips
- Primary key candidates

---

## Key Findings Summary

### The Dataset
The Polymarket ClickHouse database contains a complete historical record of:
- **159.5M trades** across 996K+ wallets and 151K+ markets
- Data spans from Dec 2022 to Oct 31, 2025
- October 2025 alone has 41.5M trades (26% of annual volume)
- Strong growth trajectory through 2025 (65.7% of all trades)

### Target Wallets
```
HolyMoses7 (0xa4b3...):    8,484 trades   (Dec 4, 2024 - Oct 29, 2025)
niggemon (0xeb6f...):      16,472 trades  (Jun 7, 2024 - Oct 31, 2025)
────────────────────────────────────────────────────────────────────
Combined:                   24,956 trades  (0.0156% of 159.5M)
```

These two wallets represent a tiny subset of the global dataset, NOT the complete dataset.

### Data Quality
**Strengths:**
- Zero null wallet addresses
- Zero null transaction hashes
- 100% candle coverage (market_candles_5m)
- Complete timestamp coverage from 2022

**Issues:**
- 1.26M null/zero market_ids (0.79%)
- High-frequency duplicates in market_id='12'
- 96.68% trades have NULL pnl (expected - open positions)
- Only 515K trades have resolved outcomes (0.32%)

### Canonical Sources
| Purpose | Table | Rows | Recommendation |
|---------|-------|------|-----------------|
| Complete dataset | trades_raw | 159.5M | Use for historical analysis |
| Cleaned dataset | vw_trades_canonical | 157.5M | Use for stats/dashboards |
| P&L analysis | trades_with_pnl | 515.7K | Use for resolved trades only |
| OHLCV pricing | market_candles_5m | 8.0M | Use with trades_raw markets |

---

## Table Catalog

### Primary Trade Tables (8 main tables)
1. **trades_raw** - Complete dataset (159.5M rows)
2. **vw_trades_canonical** - Cleaned canonical (157.5M rows)
3. **trade_direction_assignments** - Direction inference (129.6M rows)
4. **trades_with_direction** - Trades + direction (82.1M rows)
5. **trades_with_recovered_cid** - Recovered IDs (82.1M rows)
6. **market_candles_5m** - OHLCV pricing (8.0M rows)
7. **trades_with_pnl** - Resolved trades (515.7K rows)
8. **vw_trades_canonical_v2** - PnL view v2 (515.7K rows)

### Backup Tables (7 tables)
- trades_raw_backup, trades_raw_before_pnl_fix, trades_raw_fixed, trades_raw_old, trades_raw_pre_pnl_fix, trades_raw_with_full_pnl, trades_with_pnl_old

### Reference Tables (6 tables)
- market_resolutions_final, market_key_map, condition_market_map, gamma_markets, markets_dim, pm_trades

### Legacy/Broken Tables
- trades_raw_broken (5.4M rows) - corrupted subset

---

## How to Use These Docs

### Scenario 1: "I need a quick overview"
→ Read **CLICKHOUSE_SUMMARY.md** (2 minutes)

### Scenario 2: "I need complete statistics and findings"
→ Read **CLICKHOUSE_INVENTORY_REPORT.md** (10 minutes)

### Scenario 3: "I need to query specific columns"
→ Reference **CLICKHOUSE_SCHEMA_REFERENCE.md**

### Scenario 4: "I need to understand wallet-level performance"
→ Use trades_raw filtered by wallet_address
→ Recommended query in CLICKHOUSE_SUMMARY.md

### Scenario 5: "I need to calculate P&L metrics"
→ Use trades_with_pnl table
→ See schema details in CLICKHOUSE_SCHEMA_REFERENCE.md

### Scenario 6: "I need market candle data"
→ Use market_candles_5m with 100% coverage
→ 151,846 markets have 5-minute OHLCV data

---

## Database Connection

```
Host:     igm38nvzub.us-central1.gcp.clickhouse.cloud:8443
Port:     8443
User:     default
Password: 8miOkWI~OhsDb
Database: default
Protocol: HTTPS/SSL required
```

### Sample Query (trades_raw)
```sql
SELECT 
  wallet_address,
  count() as trade_count,
  count(DISTINCT market_id) as markets,
  min(timestamp) as first_trade,
  max(timestamp) as last_trade,
  sum(usd_value) as total_volume
FROM trades_raw
WHERE timestamp >= '2025-01-01'
  AND market_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
  AND market_id IS NOT NULL
GROUP BY wallet_address
ORDER BY total_volume DESC
LIMIT 20
```

---

## Key Statistics

### Dataset Coverage
- **2025:** 104.9M trades (65.7%)
- **2024:** 54.7M trades (34.2%)
- **2023:** 798 trades (0.0%)

### Market Distribution
- **Markets with trades:** 151,846
- **Markets in candles:** 151,846
- **Coverage ratio:** 100%

### Wallet Distribution
- **Total wallets:** 996,334
- **Active wallets (2025):** ~936K
- **Wallets with resolved trades:** 42,798

### Top Wallet Activity
- **#1 wallet:** 31.9M trades (0x4bfb...)
- **#2 wallet:** 3.7M trades (0xca85...)
- **#3 wallet:** 1.9M trades (0x9155...)
- **Top 20 represent:** ~70% of all trades

---

## Data Freshness

- **Latest trades:** 2025-10-31 10:00:38
- **Data lag:** ~1 day (as of exploration date)
- **Update frequency:** Continuous (real-time ingestion)
- **Direction computed:** 2025-11-05 22:57:25 (batch inference)

---

## Known Limitations

1. **Null Market IDs:** 1.26M rows lack valid market IDs (0.79%)
   - These trades cannot be matched to markets
   - Mostly in early data or manual trades
   
2. **PnL Data:** Only 0.32% of trades have complete P&L data
   - 96.68% are open positions (NULL pnl)
   - Use trades_with_pnl for resolved subset only
   
3. **Direction Inference:** 82.1M rows have inferred direction
   - Confidence levels vary (HIGH/MEDIUM/LOW)
   - Based on transfer analysis
   
4. **Duplicates:** High-frequency duplicates found in market_id='12'
   - Systematic pattern suggests batch ingestion artifacts
   - Up to 204 occurrences of same (tx, wallet, market)

---

## Recommendations

### For Analysis Work
1. Use **trades_raw** for comprehensive historical analysis
2. Use **vw_trades_canonical** for cleaner statistical work
3. Filter out null/zero market_ids for reliable market matching
4. Use **market_candles_5m** for OHLCV pricing (perfect coverage)

### For P&L Calculations
1. Use **trades_with_pnl** for resolved outcomes only
2. Check direction_confidence before using inferred direction
3. Expect only 515K resolved trades (small subset)
4. Consider using trades_raw for open position P&L estimation

### For Production Queries
1. Always filter: `market_id IS NOT NULL AND market_id != '0x00...'`
2. Use timestamp ranges to limit data scans
3. Partition by wallet_address or market_id for large queries
4. Consider materialized views for frequent aggregations

---

## Next Steps

1. **For Wallet Analysis:** Query trades_raw filtered by wallet_address
2. **For Market Analysis:** Join trades_raw with market_candles_5m
3. **For Performance:** Use trades_with_pnl for resolved metrics
4. **For Real-time:** Query trades_raw with recent timestamp filters
5. **For Validation:** Cross-check against vw_trades_canonical

---

## Files Summary

| File | Size | Lines | Purpose |
|------|------|-------|---------|
| CLICKHOUSE_SUMMARY.md | 2.2K | 67 | Quick reference |
| CLICKHOUSE_INVENTORY_REPORT.md | 13K | 308 | Full analysis |
| CLICKHOUSE_SCHEMA_REFERENCE.md | 6.7K | 233 | Technical specs |
| CLICKHOUSE_INDEX.md | This file | ~200 | Master index |

**Total Documentation:** 22K bytes, 608+ lines of comprehensive reference material

---

## Support & Troubleshooting

### Query Timeout?
- Use timestamp filters to reduce data scan
- Add market_id filters to exclude nulls
- Consider sampling for exploratory queries

### Null Results on market_id?
- 1.26M trades have NULL/zero market_ids
- These are unmapped trades
- Use vw_trades_canonical if you need cleaned data

### Missing P&L Data?
- 96.68% of trades are still open
- Use trades_with_pnl for resolved subset only
- For open positions, calculate manually from entry/exit

### Direction Not Available?
- Use vw_trades_canonical or trades_with_pnl
- Check direction_confidence level
- trades_raw doesn't have direction (use trades_with_direction)

---

**Last Updated:** November 6, 2025
**Status:** READ-ONLY exploration complete
**Next Review:** When new major tables are added

