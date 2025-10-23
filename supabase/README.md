# Supabase Database - CASCADIAN Platform

**Version:** 1.0 (Phase 1: Polymarket Integration)
**Last Updated:** 2025-10-22

---

## Quick Start

### 1. Apply Migration

```bash
# Using Supabase CLI
npx supabase db push

# Or using psql directly
psql $DATABASE_URL -f supabase/migrations/20251022131000_create_polymarket_tables.sql
```

### 2. Insert Test Data

```bash
psql $DATABASE_URL -f supabase/seed/polymarket-test-data.sql
```

### 3. Verify Installation

```sql
-- Check tables exist
SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('markets', 'sync_logs');

-- Check row counts
SELECT 'markets' AS table_name, COUNT(*) AS row_count FROM markets
UNION ALL
SELECT 'sync_logs', COUNT(*) FROM sync_logs;

-- Test a query
SELECT market_id, title, volume_24h FROM markets WHERE active = TRUE ORDER BY volume_24h DESC LIMIT 5;
```

---

## Directory Structure

```
supabase/
├── README.md                                    # This file
├── migrations/
│   ├── 20251022131000_create_polymarket_tables.sql    # Main schema
│   └── 20251022131001_rollback_polymarket_tables.sql  # Rollback script
├── docs/
│   └── polymarket-schema.md                     # Comprehensive documentation
└── seed/
    └── polymarket-test-data.sql                 # Sample data for testing
```

---

## Database Schema Overview

### Tables

#### `markets`
Stores current state of all Polymarket markets.

**Key Columns:**
- `market_id` (TEXT, PRIMARY KEY)
- `title`, `description`, `category`
- `current_price` (NUMERIC 0-1)
- `volume_24h`, `volume_total`, `liquidity`
- `active`, `closed`, `end_date`
- `momentum_score`, `sii_score`, `smart_money_delta` (Phase 2, NULL for now)
- `raw_polymarket_data` (JSONB)

**Indexes:** 9 indexes optimized for screener queries

**Constraints:**
- Cannot be both active and closed
- 24h volume ≤ total volume
- Price must be 0-1
- Active markets must have future end_date

---

#### `sync_logs`
Audit trail of all market sync operations.

**Key Columns:**
- `id` (BIGSERIAL, PRIMARY KEY)
- `sync_started_at`, `sync_completed_at`, `duration_ms`
- `status` ('running', 'success', 'partial', 'failed')
- `markets_fetched`, `markets_synced`, `markets_failed`
- `error_message`, `api_response_time_ms`
- `api_rate_limited` (BOOLEAN)

---

### Helper Functions

- `get_market_data_staleness()` → Returns INTERVAL since last update
- `is_market_data_stale(threshold_minutes)` → Returns BOOLEAN (default: 5 min)
- `get_last_successful_sync()` → Returns info about last successful sync

---

## Common Operations

### Check if Sync is Needed

```sql
SELECT is_market_data_stale(5) AS needs_sync;
```

### Get Staleness

```sql
SELECT get_market_data_staleness() AS age;
```

### Get Active Markets by Volume

```sql
SELECT
  market_id,
  title,
  category,
  current_price,
  volume_24h
FROM markets
WHERE active = TRUE
ORDER BY volume_24h DESC
LIMIT 100;
```

### Search Markets by Title

```sql
SELECT
  market_id,
  title,
  category,
  current_price
FROM markets
WHERE active = TRUE
  AND title ILIKE '%bitcoin%'
ORDER BY volume_24h DESC;
```

### Get Markets Closing Soon

```sql
SELECT
  market_id,
  title,
  end_date,
  EXTRACT(EPOCH FROM (end_date - NOW())) / 3600 AS hours_until_close
FROM markets
WHERE active = TRUE
  AND closed = FALSE
  AND end_date BETWEEN NOW() AND NOW() + INTERVAL '24 hours'
ORDER BY end_date ASC;
```

### UPSERT Markets (Batch Sync)

```sql
INSERT INTO markets (
  market_id,
  title,
  slug,
  category,
  current_price,
  volume_24h,
  volume_total,
  liquidity,
  active,
  closed,
  end_date,
  raw_polymarket_data
)
VALUES
  ('0x123...', 'Market 1', 'market-1', 'Sports', 0.65, 10000, 50000, 5000, true, false, '2025-12-31', '{}')
ON CONFLICT (market_id)
DO UPDATE SET
  title = EXCLUDED.title,
  current_price = EXCLUDED.current_price,
  volume_24h = EXCLUDED.volume_24h,
  volume_total = EXCLUDED.volume_total,
  liquidity = EXCLUDED.liquidity,
  active = EXCLUDED.active,
  closed = EXCLUDED.closed,
  end_date = EXCLUDED.end_date,
  raw_polymarket_data = EXCLUDED.raw_polymarket_data,
  updated_at = NOW();
```

### Log Sync Operation

```sql
INSERT INTO sync_logs (
  sync_started_at,
  sync_completed_at,
  duration_ms,
  status,
  markets_fetched,
  markets_synced,
  markets_failed,
  api_response_time_ms,
  api_rate_limited,
  triggered_by
)
VALUES (
  '2025-10-22 13:10:00+00',
  '2025-10-22 13:10:12+00',
  12450,
  'success',
  1234,
  1234,
  0,
  380,
  false,
  'cron'
);
```

---

## Performance Targets

| Query Type | Target (P50) | Target (P95) |
|------------|--------------|--------------|
| Default screener load | < 50ms | < 100ms |
| Category filter | < 30ms | < 80ms |
| Fuzzy search | < 100ms | < 200ms |
| Single market lookup | < 5ms | < 10ms |
| UPSERT (500 markets) | < 800ms | < 1.5s |

---

## Maintenance

### Weekly Tasks

```sql
-- Update query planner statistics
ANALYZE markets;
ANALYZE sync_logs;
```

### Monthly Tasks

```sql
-- Reclaim space and update stats
VACUUM ANALYZE markets;
VACUUM ANALYZE sync_logs;

-- Rebuild indexes (if needed)
REINDEX TABLE markets;
REINDEX TABLE sync_logs;
```

### Cleanup Old Sync Logs (Optional)

```sql
-- Delete sync logs older than 90 days
DELETE FROM sync_logs WHERE created_at < NOW() - INTERVAL '90 days';
```

---

## Monitoring

### Daily Health Check

```sql
SELECT
  (SELECT COUNT(*) FROM markets WHERE active = TRUE) AS active_markets,
  (SELECT COUNT(*) FROM markets WHERE closed = TRUE) AS closed_markets,
  (SELECT get_market_data_staleness()) AS data_age,
  (SELECT is_market_data_stale(5)) AS needs_sync,
  (SELECT COUNT(*) FROM sync_logs WHERE sync_started_at >= NOW() - INTERVAL '24 hours') AS syncs_last_24h,
  (SELECT COUNT(*) FROM sync_logs WHERE status = 'failed' AND sync_started_at >= NOW() - INTERVAL '24 hours') AS failed_syncs_24h;
```

### Sync Performance Trends

```sql
SELECT
  DATE(sync_started_at) AS date,
  COUNT(*) AS total_syncs,
  COUNT(*) FILTER (WHERE status = 'success') AS successful,
  COUNT(*) FILTER (WHERE status = 'failed') AS failed,
  AVG(duration_ms) AS avg_duration_ms,
  AVG(markets_synced) AS avg_markets_synced
FROM sync_logs
WHERE sync_started_at >= NOW() - INTERVAL '7 days'
GROUP BY DATE(sync_started_at)
ORDER BY date DESC;
```

### Index Usage

```sql
-- Check which indexes are being used
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
  AND tablename IN ('markets', 'sync_logs')
ORDER BY idx_scan DESC;
```

---

## Troubleshooting

### Slow Queries

**Check query plan:**
```sql
EXPLAIN ANALYZE
SELECT * FROM markets WHERE active = TRUE ORDER BY volume_24h DESC LIMIT 100;
```

**Rebuild statistics:**
```sql
ANALYZE markets;
```

**Rebuild indexes:**
```sql
REINDEX TABLE markets;
```

---

### UPSERT Timeouts

**Reduce batch size:**
```typescript
// Instead of 500 rows
const BATCH_SIZE = 250;
```

**Check for locks:**
```sql
SELECT * FROM pg_stat_activity WHERE query ILIKE '%markets%';
```

---

### Stale Data

**Check staleness:**
```sql
SELECT get_market_data_staleness();
```

**Check last sync:**
```sql
SELECT * FROM get_last_successful_sync();
```

**Check for errors:**
```sql
SELECT * FROM sync_logs WHERE status = 'failed' ORDER BY sync_started_at DESC LIMIT 5;
```

---

## Rollback

If you need to completely remove the Polymarket schema:

```bash
psql $DATABASE_URL -f supabase/migrations/20251022131001_rollback_polymarket_tables.sql
```

**WARNING:** This will permanently delete all market data and sync logs!

---

## Documentation

For detailed documentation, see:

- **Full Schema Docs:** [`supabase/docs/polymarket-schema.md`](./docs/polymarket-schema.md)
  - Column-by-column documentation
  - Index strategy and rationale
  - Query patterns with EXPLAIN plans
  - Performance tuning guide
  - Common queries and examples

- **Feature Spec:** [`.agent-os/features/polymarket-integration.md`](../.agent-os/features/polymarket-integration.md)
  - Overall integration architecture
  - Data flow diagrams
  - Sync strategy
  - API design

- **Migration File:** [`supabase/migrations/20251022131000_create_polymarket_tables.sql`](./migrations/20251022131000_create_polymarket_tables.sql)
  - Complete schema definition
  - All indexes and constraints
  - Helper functions
  - Inline comments

---

## Phase 2 Roadmap

The schema is designed to support Phase 2 features without requiring ALTER TABLE:

**Columns already in place (NULL in Phase 1):**
- `momentum_score` - Price momentum indicator
- `sii_score` - Smart Imbalance Index (smart money positioning)
- `smart_money_delta` - Net smart money flow
- `last_trade_timestamp` - Most recent trade time

**Future tables (not in Phase 1):**
- `trades` - Individual trade records
- `positions` - Wallet position snapshots
- `wallet_scores` - Wallet intelligence scores
- `prices_1m` - 1-minute OHLCV data

---

## Support

For questions or issues:
1. Check the [full documentation](./docs/polymarket-schema.md)
2. Review the [feature spec](../.agent-os/features/polymarket-integration.md)
3. Check the [operations manual](../.agent-os/product/IMPLEMENTATION_OPERATIONS_MANUAL.md) for lessons learned

---

## License

Part of the CASCADIAN platform.
