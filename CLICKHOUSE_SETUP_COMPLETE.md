# ClickHouse Setup - COMPLETE ✅

**Date:** 2025-10-24
**Status:** ClickHouse is ready for data ingestion

---

## What's Been Set Up

### 1. ClickHouse Cloud Instance ✅
- **Host:** `igm38nvzub.us-central1.gcp.clickhouse.cloud`
- **Version:** 25.6.2.6261
- **Database:** `default`
- **Status:** Connected and verified

### 2. Environment Configuration ✅
Added to `.env.local`:
```
CLICKHOUSE_HOST=https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=8miOkWI~OhsDb
CLICKHOUSE_DATABASE=default
```

### 3. Client Library ✅
- Installed: `@clickhouse/client@1.12.1`
- Location: `/lib/clickhouse/client.ts`
- Features:
  - Connection pooling
  - Lazy initialization
  - Test utilities

### 4. Database Schema ✅
Created tables:
1. **`trades_raw`** - Main trades table
   - Engine: SharedMergeTree
   - Partitioned by month (YYYYMM)
   - Ordered by (wallet_address, timestamp)
   - Fields: trade_id, wallet_address, market_id, timestamp, side, prices, shares, pnl, etc.

2. **`wallet_metrics_daily`** - Materialized View
   - Engine: SharedSummingMergeTree
   - Auto-aggregates daily metrics per wallet
   - Pre-calculated: wins, losses, PnL, volume, stddev

---

## Files Created

```
lib/clickhouse/
├── client.ts                    # ClickHouse client with connection management

migrations/clickhouse/
├── 001_create_trades_table.sql  # Schema migration

scripts/
├── test-clickhouse-connection.ts  # Test connection & verify setup
└── setup-clickhouse-schema.ts     # Run schema migrations
```

---

## Next Steps

### Ready Now:
✅ ClickHouse is ready to accept trade data
✅ Schema supports all required metrics (Omega, Sharpe, win rate)
✅ Materialized views will auto-calculate daily aggregates

### Up Next:
1. **Build Goldsky GraphQL client** - Fetch historical trade data
2. **Create ETL pipeline** - Transform & load trades into ClickHouse
3. **Test with sample data** - Validate 10 wallets
4. **Calculate first smart scores** - Verify Omega ratio works

---

## Testing Commands

```bash
# Test connection
npx tsx scripts/test-clickhouse-connection.ts

# Verify schema
npx tsx scripts/setup-clickhouse-schema.ts

# Query trades (once you have data)
echo "SELECT count() FROM trades_raw" | \
  curl --user 'default:8miOkWI~OhsDb' \
  --data-binary @- \
  https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443
```

---

## Architecture

```
Goldsky (next) → ETL (next) → ClickHouse (✅ READY)
                                    ↓
                            Materialized Views (✅ READY)
                                    ↓
                            Calculate Metrics (next)
                                    ↓
                            Postgres (wallet_scores)
```

---

**ClickHouse Setup: COMPLETE**
**Next Task: Goldsky Integration**
