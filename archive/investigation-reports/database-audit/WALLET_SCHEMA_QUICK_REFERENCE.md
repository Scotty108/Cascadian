# Wallet Schema Quick Reference

## All Tables with Wallet Fields (13 tables + 3 views)

### Dimension & Metrics Tables (6)
1. **wallets_dim** - wallet_address (50K rows)
2. **wallet_metrics** - wallet_address (200K rows, 4 time windows)
3. **wallet_metrics_complete** - wallet_address (200K rows, 102 metrics)
4. **wallet_resolution_outcomes** - wallet_address (5M rows)
5. **wallet_metrics_by_category** - wallet_address (500K rows)
6. **wallet_metrics_daily** - wallet_address (materialized view)

### Trade Tables (4)
7. **trades_raw** - wallet_address (10M rows)
8. **elite_trade_attributions** - wallet_address (500K rows)
9. **pm_trades** - maker_address, taker_address (50M rows)
10. **pm_trades_external** - wallet_address, operator_address (20M rows)

### Proxy & Mapping Tables (2)
11. **pm_user_proxy_wallets** - user_eoa, proxy_wallet (5K rows)
12. **condition_market_map** - (reference table, no wallet fields)
13. **markets_dim**, **events_dim** - (reference tables, no wallet fields)

### Views (3)
- **erc1155_transfers_enriched** - from_addr, to_addr, from_eoa, to_eoa (100M rows)
- **wallet_positions_current** - wallet (5M positions)
- **proxy_wallets_active** - user_eoa, proxy_wallet

---

## Wallet Field Name Variations

| Field | Count | Tables | Use Case |
|-------|-------|--------|----------|
| wallet_address | 10 | Main identifier | Generic wallet |
| maker_address | 1 | pm_trades | Order maker |
| taker_address | 1 | pm_trades | Order taker |
| from_addr | 1 | erc1155_transfers | Token sender |
| to_addr | 1 | erc1155_transfers | Token recipient |
| user_eoa | 2 | pm_user_proxy_wallets | Owner EOA |
| proxy_wallet | 2 | pm_user_proxy_wallets | Proxy contract |
| operator_address | 1 | pm_trades_external | Transaction signer |
| from_eoa | 1 | erc1155_transfers | Decoded sender EOA |
| to_eoa | 1 | erc1155_transfers | Decoded recipient EOA |

---

## Primary Indexes by Table

| Table | Primary Key |
|-------|-----------|
| wallets_dim | wallet_address |
| wallet_metrics | (wallet_address, time_window) |
| wallet_metrics_complete | (wallet_address, window) |
| wallet_resolution_outcomes | (wallet_address, condition_id) |
| trades_raw | (wallet_address, timestamp) [PARTITION] |
| pm_trades | (market_id, timestamp, id) |
| pm_trades_external | (condition_id, wallet_address, block_time, fill_id) |
| elite_trade_attributions | (market_id, timestamp, wallet_address) |
| pm_user_proxy_wallets | (user_eoa, proxy_wallet) |

---

## Bloom Filter Indexes (Fast Lookups)

| Table | Field | Type |
|-------|-------|------|
| pm_trades_external | wallet_address | bloom_filter |
| pm_trades_external | condition_id | bloom_filter |
| pm_trades | maker_address | bloom_filter |
| pm_trades | taker_address | bloom_filter |

---

## Data Volume Summary

| Table | Rows | Growth/day | Key Field |
|-------|------|-----------|-----------|
| wallets_dim | 50K | 100 | wallet_address |
| wallet_metrics | 200K | 400 | wallet_address |
| wallet_resolution_outcomes | 5M | 10K | wallet_address |
| trades_raw | 10M | 20K | wallet_address |
| pm_trades | 50M | 50K | maker/taker_address |
| pm_trades_external | 20M | 10K | wallet_address |
| erc1155_transfers | 100M | 50K | from_addr, to_addr |

**Total unique wallets**: ~50,000+
**Total wallet events**: ~300M+ across all tables

---

## Canonicalization Strategy

### Problem
- wallet_address vs maker_address vs taker_address vs from_addr/to_addr
- proxy contracts vs EOA owners
- Case variations (though mostly lowercase)
- Nullable fields (operator_address can be empty)

### Solution (4 Phases)

**Phase 1**: Create canonical_wallet_addresses lookup table
- Maps all variations to normalized format
- Tracks proxy relationships

**Phase 2**: Add canonical_wallet_address column to dimension tables
- wallets_dim, wallet_metrics*, wallet_resolution_outcomes

**Phase 3**: Add canonical columns to trade tables
- pm_trades (for both maker and taker)
- pm_trades_external
- trades_raw

**Phase 4**: Update all downstream views and APIs
- wallet_metrics_daily
- erc1155_transfers_enriched
- All API endpoints

---

## Sample Discovery Queries

### Find all unique wallets
```sql
SELECT COUNT(DISTINCT wallet_address) FROM wallets_dim
```

### Get wallet metrics across time windows
```sql
SELECT wallet_address, time_window, realized_pnl, omega_ratio
FROM wallet_metrics
WHERE time_window IN ('30d', '90d', '180d', 'lifetime')
ORDER BY omega_ratio DESC
LIMIT 100
```

### Join proxy to EOA
```sql
SELECT DISTINCT user_eoa, proxy_wallet
FROM pm_user_proxy_wallets
WHERE is_active = 1
ORDER BY user_eoa
```

### Top wallets by recent activity
```sql
SELECT maker_address, COUNT(*) as trade_count
FROM pm_trades
WHERE timestamp >= now() - interval 7 day
GROUP BY maker_address
ORDER BY trade_count DESC
LIMIT 50
```

---

## Integration Checklist

- [ ] Schema discovery complete (this document)
- [ ] Identify all wallet field variations
- [ ] Create canonical_wallet_addresses table
- [ ] Build lookup functions (SQL + TypeScript)
- [ ] Add canonical columns to key tables
- [ ] Update wallets API endpoints
- [ ] Update leaderboard queries
- [ ] Update copy-trading logic
- [ ] Add validation/monitoring
- [ ] Document in RULES.md

---

**Report**: /Users/scotty/Projects/Cascadian-app/WALLET_SCHEMA_DISCOVERY_REPORT.md
**Quick Ref**: /Users/scotty/Projects/Cascadian-app/WALLET_SCHEMA_QUICK_REFERENCE.md
**Generated**: 2025-11-16
