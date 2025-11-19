# ClickHouse Database Documentation

## Overview

This directory contains comprehensive documentation of the Cascadian app's ClickHouse database structure, which handles Polymarket trading data, proxy wallet mappings, and P&L calculations.

## Documentation Files

### Start Here

1. **CLICKHOUSE_QUICK_REFERENCE.md** - One-page reference with essential queries and schema overview
   - Best for: Quick lookups, common queries, data types
   - Time to read: 5 minutes

2. **CLICKHOUSE_KEY_FINDINGS.md** - Executive summary of key architecture
   - Best for: Understanding the overall design
   - Time to read: 10 minutes
   - Key insights: Proxy mapping chain, P&L settlement rules, critical joins

### Comprehensive Reference

3. **CLICKHOUSE_EXPLORATION.md** - Complete schema documentation (912 lines)
   - Best for: Deep understanding of all tables and views
   - Contains:
     - Complete CREATE TABLE statements for all core tables
     - All P&L views and formulas
     - Relationship diagrams
     - Data flow pipeline
     - Verification queries
   - Time to read: 45 minutes

### Specialized Documents

4. **CLICKHOUSE_SCHEMA_REFERENCE.md** - Schema details only
   - Best for: Looking up table structures without context

5. **CLICKHOUSE_INDEX.md** - Index of all tables and views
   - Best for: Finding what table to use for a specific purpose

6. **CLICKHOUSE_INVENTORY_REPORT.md** - Table inventory with row counts and purposes
   - Best for: Understanding what data is available

7. **CLICKHOUSE_SUMMARY.md** - One-paragraph summary
   - Best for: 30-second overview

## Key Architecture

### Two Core Trade Tables

**pm_trades** (CLOB API Fills)
- Source: Polymarket CLOB API
- Fields: maker_address, taker_address, market_id, side ("BUY"/"SELL"), price (Float64)
- Purpose: Order book match data with exact counterparties
- Join pattern: maker/taker → pm_user_proxy_wallets → user_eoa

**trades_raw** (Generic Trades)
- Source: Generic trading data (legacy)
- Fields: wallet_address, market_id, side ("YES"/"NO"), shares, pnl
- Purpose: Portfolio aggregation and P&L calculation
- Join pattern: wallet_address + market_id → canonical_condition → winning_index

### Proxy Wallet Mapping

The system maps EOAs (user wallets) to proxy wallets used on-chain:

```
user EOA (e.g., 0xa4b366ad22fc0d06f1e934ff468e8922431a87b8)
    ↓
pm_user_proxy_wallets.user_eoa → pm_user_proxy_wallets.proxy_wallet
    ↓
Proxy wallet (used in pm_erc1155_flats, pm_trades)
    ↓
erc1155_transfers_enriched (shows historical movements)
```

### P&L Calculation Chain

Three settlement rules apply in sequence:

1. **Signed Cashflow (per fill)**
   - BUY: -(price × shares) - fees = negative (cost)
   - SELL: +(price × shares) - fees = positive (proceeds)

2. **Settlement on Resolution (per market)**
   - Winning long: +$1 per share
   - Winning short: +$1 per share (shorts win when outcome loses)
   - Losing position: $0

3. **Realized P&L (SIDE-DEPENDENT)**
   - Long Win: settlement - cashflow
   - Long Loss: cashflow (negative)
   - Short Win: settlement + cashflow (keep premium + payout)
   - Short Loss: -cashflow (negate premium)

View chain:
```
trades_raw → trade_flows_v2 → realized_pnl_by_market_v2 → 
wallet_realized_pnl_v2 → wallet_pnl_summary_v2
```

## Critical Tables for P&L

To calculate complete P&L, these tables must be populated:

1. **trades_raw** - The actual trades (required)
2. **condition_market_map** OR **ctf_token_map** - Maps market_id → condition_id (required)
3. **market_resolutions_final** - Records market winners (required)
4. **market_outcomes** - Records outcome indices (required)

## Quick Queries

### Find Proxy Wallets for EOA
```sql
SELECT DISTINCT proxy_wallet FROM pm_user_proxy_wallets 
WHERE lower(user_eoa) = lower('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8')
  AND is_active = 1;
```

### Get Complete P&L
```sql
SELECT 
  wallet,
  realized_pnl_usd,
  unrealized_pnl_usd,
  total_pnl_usd
FROM wallet_pnl_summary_v2
WHERE wallet = lower('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8');
```

### Find Trades for Wallet (via Proxy)
```sql
WITH proxy_list AS (
  SELECT proxy_wallet FROM pm_user_proxy_wallets 
  WHERE lower(user_eoa) = lower('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8')
)
SELECT * FROM pm_trades
WHERE lower(maker_address) IN (SELECT proxy_wallet FROM proxy_list)
   OR lower(taker_address) IN (SELECT proxy_wallet FROM proxy_list)
ORDER BY timestamp DESC
LIMIT 100;
```

## Data Type Reference

### Addresses
- All stored lowercase: `0x4d97dcd97ec945f40cf65f87097ace5ea0476045`
- Use `lower()` function in WHERE clauses
- Some comparisons use `replaceAll(..., '0x', '')` to remove prefix

### Prices (0-1 probability)
- pm_trades: `Float64`
- trades_raw: `Decimal(18, 8)`

### Shares
- trades_raw: `Decimal(18, 8)`
- pm_trades: `String` (parse to number when needed)

### P&L and USD Values
- `Decimal(18, 2)` for storage
- `Float64` for aggregations

### Sides
- trades_raw: Enum8 where 1="YES" (long), 2="NO" (short)
- pm_trades: String where "BUY" or "SELL"

## Engine Types

| Engine | Use Case | Key Feature |
|--------|----------|------------|
| MergeTree | Raw data tables | No deduplication |
| ReplacingMergeTree | Cached/derived tables | Deduplicates by created_at or similar |

## Indexes

ClickHouse uses **bloom filters** for selective indexes:

```sql
CREATE INDEX idx_pm_trades_maker
  ON pm_trades (maker_address)
  TYPE bloom_filter(0.01) GRANULARITY 1;
```

These are probabilistic filters that skip blocks, not traditional B-tree indexes.

## Views Available

### P&L Views
- `trade_flows_v2` - Compute signed cashflows per fill
- `canonical_condition` - Map market_id → condition_id
- `winning_index` - Map condition_id → winning outcome index
- `realized_pnl_by_market_v2` - P&L per wallet per market
- `wallet_realized_pnl_v2` - Total realized P&L per wallet
- `wallet_pnl_summary_v2` - Realized + unrealized P&L

### Enrichment Views
- `markets_enriched` - Market metadata + resolution data
- `token_market_enriched` - Token + market + winning side
- `proxy_wallets_active` - Active proxy mappings only
- `erc1155_transfers_enriched` - Transfers + market context + proxy info
- `wallet_positions_current` - Current token holdings per wallet

## Data Ingestion Pipeline

1. **Blockchain Data** → pm_erc1155_flats (ERC1155 transfer events)
2. **Proxy Resolution** → pm_user_proxy_wallets (EOA → proxy wallet mappings)
3. **Token Mapping** → ctf_token_map (token_id → market metadata)
4. **CLOB API Fills** → pm_trades (order matches from Polymarket API)
5. **P&L Calculation** → wallet_pnl_summary_v2 (apply settlement rules)
6. **Wallet Analytics** → wallet_metrics_complete (102+ metrics per wallet)

## Scripts for Data Operations

- **build-approval-proxies.ts** - Creates pm_user_proxy_wallets from pm_erc1155_flats
- **flatten-erc1155.ts** - Creates pm_erc1155_flats from blockchain events
- **ingest-clob-fills.ts** - Populates pm_trades from CLOB API
- **realized-pnl-corrected.sql** - Creates P&L views
- **settlement-rules.sql** - Defines P&L calculation rules

## External Data Sources

These tables reference external data that may not be fully ingested:

- **gamma_markets** - Polymarket API (market questions, outcomes, tags)
- **market_resolutions_final** - Resolution feed (market winners)
- **erc1155_transfers** - Blockchain logs (before flattening)
- **market_outcomes** - Derived from gamma_markets

## Connection Details

**Location:** ClickHouse Cloud (GCP, us-central1)
**Host:** igm38nvzub.us-central1.gcp.clickhouse.cloud:8443
**Client Implementation:** /Users/scotty/Projects/Cascadian-app/lib/clickhouse/client.ts

**Required Environment Variables:**
```bash
CLICKHOUSE_HOST              # e.g., https://igm38...
CLICKHOUSE_USER              # default: 'default'
CLICKHOUSE_PASSWORD          # Required
CLICKHOUSE_DATABASE          # default: 'default'
CLICKHOUSE_REQUEST_TIMEOUT_MS # default: 180000
```

## Verification Queries

### Check Bridge Coverage
```sql
WITH target_markets AS (
  SELECT DISTINCT lower(market_id) AS market_id
  FROM trades_raw
  WHERE lower(wallet_address) = lower('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8')
)
SELECT
  count() AS markets_touched,
  countIf(cc.condition_id_norm IS NOT NULL) AS bridged,
  countIf(wi.win_idx IS NOT NULL) AS resolvable
FROM target_markets tm
LEFT JOIN canonical_condition cc USING (market_id)
LEFT JOIN winning_index wi ON wi.condition_id_norm = cc.condition_id_norm;
```

### Check Data Completeness
```sql
SELECT
  'Total trades' as metric, COUNT(*) as value FROM trades_raw
UNION ALL
SELECT 'Unique wallets', COUNT(DISTINCT wallet_address) FROM trades_raw
UNION ALL
SELECT 'Unique markets', COUNT(DISTINCT market_id) FROM trades_raw
UNION ALL
SELECT 'PM trades (CLOB)', COUNT(*) FROM pm_trades
UNION ALL
SELECT 'Proxy wallets', COUNT(DISTINCT proxy_wallet) FROM pm_user_proxy_wallets;
```

## Notes

- All wallet addresses are stored and queried **lowercase**
- Settlement rules are **side-dependent** - formula changes for longs vs shorts
- P&L differs from accuracy - wallet_resolution_outcomes tracks accuracy separately
- Some tables use ReplacingMergeTree and may need `FINAL` keyword (slow) for latest values
- Views cache complex joins - prefer views to manual joins when possible
- Bloom filter indexes help but aren't as fast as B-tree for address lookups

## Next Steps

1. Read **CLICKHOUSE_QUICK_REFERENCE.md** for essential queries
2. Read **CLICKHOUSE_KEY_FINDINGS.md** for architecture overview
3. Consult **CLICKHOUSE_EXPLORATION.md** for deep schema details
4. Run verification queries to check data completeness

---

**Last Updated:** 2025-11-06
**Documentation Status:** Complete
**Database Host:** igm38nvzub.us-central1.gcp.clickhouse.cloud:8443

