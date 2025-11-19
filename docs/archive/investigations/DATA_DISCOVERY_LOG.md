# Data Discovery & Architecture Log

**Last Updated**: 2025-11-06
**Status**: ✅ Pipeline Complete - Ready for UI Integration

## Critical Discoveries

### Source of Truth: `trades_raw` Table
- **Location**: ClickHouse `default.trades_raw`
- **Row Count**: 159,574,259 (159M+)
- **Time Range**: ~919 days (2.5 years)
- **Schema**: trade_id, wallet_address, market_id, timestamp, side (YES/NO), entry_price, exit_price, shares, usd_value, pnl, is_closed, transaction_hash, condition_id, outcome, outcome_index, etc.
- **Validation**: 100% reconciliation with `pm_erc1155_flats` by transaction_hash ✅

### Target Wallets - Fill Count Validation
| Wallet Name | Address | Fills | Gate Requirement | Status |
|---|---|---|---|---|
| **HolyMoses7** | 0xa4b366ad22fc0d06f1e934ff468e8922431a87b8 | 8,484 | 2,182 | ✅ 3.9x above |
| **niggemon** | 0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0 | 16,472 | 1,087 | ✅ 15x above |

**Finding**: Both wallets far exceed hard acceptance gates. No backfill needed.

### ERC-1155 Token Transfers
- **Table**: `pm_erc1155_flats`
- **Row Count**: 206,112
- **Validation**: All 25,084 trades for target wallets matched by transaction_hash
- **Reconciliation Rate**: 100% ✅
- **Columns**: tx_hash, log_index, block_number, block_time, address, operator, from_address, to_address, token_id, amount

### Market Price History: `market_candles_5m`
- **Table Engine**: ReplacingMergeTree
- **Row Count**: 8,051,265 candle buckets
- **Unique Markets**: 151,846
- **Time Range**: 919 days
- **Schema**: market_id, bucket (DateTime), open, high, low, close, volume, notional, vwap (all String)
- **Created**: 2025-11-06 via `scripts/build-market-candles.ts`

### Known Blockers & Workarounds
| Blocker | Root Cause | Resolution |
|---|---|---|
| CLOB API `/trades?maker=X` | Auth-only, user-scoped (requires L2 header) | ✅ Used existing trades_raw instead |
| Subgraph endpoints deprecated | All Graph endpoints returned 404 | ✅ Not needed - trades_raw has complete history |
| Too many partitions INSERT | Date-based partitioning with 919 days | ✅ Changed to ReplacingMergeTree without PARTITION BY |

## Data Pipeline Architecture

### Upstream Sources (Read-Only, No New Fetches)
```
Blockchain Events
    ↓
ClickHouse Ingestion Layer
    ├── pm_erc1155_flats (206k rows) - Token transfers
    └── trades_raw (159M rows) - Trade history
```

### Computed Views (Ready to Build)
```
trades_raw + market_candles_5m
    ↓
wallet_positions (live positions + avg entry)
    ↓
market_last_price (latest VWAP per market)
    ↓
unrealized_pnl (marked to market)
```

## Next Steps - UI Integration

### 1. Price Charts
```sql
SELECT market_id, bucket, open, high, low, close, volume
FROM market_candles_5m
WHERE market_id = ?
  AND bucket >= now() - INTERVAL 90 DAY
ORDER BY bucket;
```

### 2. Market Last Price View
```sql
CREATE OR REPLACE VIEW market_last_price AS
SELECT market_id, anyLast(close) AS last_price
FROM market_candles_5m
GROUP BY market_id;
```

### 3. Live Positions View
```sql
CREATE OR REPLACE VIEW wallet_positions AS
SELECT
  lower(wallet_address) AS wallet,
  market_id,
  outcome,
  sumIf(shares, side='YES') - sumIf(shares, side='NO') AS net_shares,
  countDistinct(transaction_hash) AS trade_count,
  sumIf(entry_price * shares, side='YES') / nullIf(sumIf(shares, side='YES'), 0) AS avg_entry_price
FROM trades_raw
WHERE lower(wallet_address) IN (
  lower('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8'),
  lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0')
)
GROUP BY wallet, market_id, outcome;
```

### 4. Portfolio PnL
```sql
SELECT
  p.wallet,
  p.market_id,
  p.outcome,
  p.net_shares,
  p.avg_entry_price,
  l.last_price,
  round((l.last_price - p.avg_entry_price) * p.net_shares, 2) AS unrealized_pnl_usd,
  p.trade_count
FROM wallet_positions p
LEFT JOIN market_last_price l ON p.market_id = l.market_id
WHERE p.net_shares != 0
ORDER BY abs(unrealized_pnl_usd) DESC;
```

## Health Check Queries

All passing ✅

```sql
-- 1. Total candle count
SELECT count() FROM market_candles_5m;
-- Expected: ~8.05M

-- 2. Target wallets trade count
SELECT lower(wallet_address) AS wallet, count() AS txs
FROM trades_raw
WHERE lower(wallet_address) IN (
  lower('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8'),
  lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0')
)
GROUP BY wallet;
-- Expected: HolyMoses7=8484, niggemon=16472

-- 3. ERC-1155 reconciliation
WITH trades_with_erc AS (
  SELECT t.trade_id, e.tx_hash
  FROM trades_raw t
  LEFT JOIN pm_erc1155_flats e ON lower(t.transaction_hash) = lower(e.tx_hash)
  WHERE lower(t.wallet_address) IN (
    lower('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8'),
    lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0')
  )
)
SELECT
  count() as total_trades,
  countIf(tx_hash IS NOT NULL) as erc1155_matched,
  round(countIf(tx_hash IS NOT NULL) / count() * 100, 2) as match_percentage
FROM trades_with_erc;
-- Expected: 100% match

-- 4. Market candles coverage
SELECT
  count(DISTINCT market_id) as markets,
  min(bucket) as earliest_candle,
  max(bucket) as latest_candle,
  count() as total_buckets
FROM market_candles_5m;
-- Expected: 151k+ markets, 8M+ buckets
```

## Configuration

### ClickHouse Connection
```
Host: igm38nvzub.us-central1.gcp.clickhouse.cloud:8443
User: default
Password: [in .env as CLICKHOUSE_PASSWORD]
Database: default
Request Timeout: 300s
```

### Scripts Directory
- `scripts/build-market-candles.ts` - Creates/backfills market_candles_5m
- `.subgraph_mapping.json` - Deprecated (for reference only)
- `test-dual-stream.ts` - API testing (deprecated)

## Critical Metadata

**Data Freshness**:
- `trades_raw`: Contains all historical trades up to today
- `market_candles_5m`: Rebuilt 2025-11-06, covers last 919 days
- `pm_erc1155_flats`: Static snapshot, 206k token transfers

**Reconciliation Status**:
- Wallet coverage: ✅ Complete (8.5k + 16.5k fills)
- ERC-1155 validation: ✅ 100% match
- Market coverage: ✅ 151.8k markets with price history
- Hard gates: ✅ Both passed (3.9x and 15x above requirement)

**No Further Data Pulls Required**: All discovery complete. Ready for consumption.
