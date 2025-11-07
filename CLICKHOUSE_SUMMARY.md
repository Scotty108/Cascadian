# ClickHouse Inventory - Quick Reference

## Key Numbers
- **Total Trades:** 159,574,259
- **Unique Wallets:** 996,334
- **Unique Markets:** 151,846
- **Date Range:** 2022-12-18 to 2025-10-31
- **Target Wallet Trades:** 24,956 (0.0156% of total)

## Primary Tables

| Name | Rows | Purpose | Use Case |
|------|------|---------|----------|
| **trades_raw** | 159.5M | Complete canonical dataset | Historical analysis, market studies |
| vw_trades_canonical | 157.5M | Cleaned version (-2M dups) | Statistical analysis, dashboards |
| trades_with_pnl | 515.7K | Resolved trades with P&L | P&L calculations, win rates |
| market_candles_5m | 8.0M | OHLCV price data | Technical analysis, backtesting |

## Target Wallets
```
HolyMoses7 (0xa4b3...):    8,484 trades  (Dec 4, 2024 - Oct 29, 2025)
niggemon (0xeb6f...):      16,472 trades (Jun 7, 2024 - Oct 31, 2025)
────────────────────────────────────────────────────────
Combined:                   24,956 trades (0.0156% of 159.5M)
```

## Data Quality
- Null wallets: 0
- Null market IDs: 1,257,929 (0.79% - known issue)
- Null transaction hashes: 0
- Duplicate rates: High in market_id='12' entries
- Candle coverage: 100% (perfect match with trades_raw markets)

## Recommended Approach

### For Wallet Analysis
```sql
SELECT * FROM trades_raw 
WHERE wallet_address = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8'
ORDER BY timestamp DESC
```

### For P&L Analysis
```sql
SELECT * FROM trades_with_pnl
WHERE wallet_address = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8'
ORDER BY timestamp DESC
```

### For Market Data
```sql
SELECT * FROM market_candles_5m
WHERE market_id = '<target_id>'
ORDER BY timestamp DESC
```

## Key Insight
The 25k trades are ONLY the two target wallets. The actual dataset is 159.5M trades from 996K+ wallets across 151K+ markets. This represents the complete Polymarket activity from Dec 2022 - Oct 2025.

## Files
- `CLICKHOUSE_INVENTORY_REPORT.md` - Full detailed report (10 sections, 13KB)
- `CLICKHOUSE_SUMMARY.md` - This quick reference

## Database
- Host: igm38nvzub.us-central1.gcp.clickhouse.cloud:8443
- Database: default
- Status: READ-ONLY exploration complete
