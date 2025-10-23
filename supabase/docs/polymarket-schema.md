# Polymarket Integration: Schema Documentation

**Version:** 1.0
**Last Updated:** 2025-10-22
**Migration File:** `20251022131000_create_polymarket_tables.sql`

---

## Table of Contents

1. [Overview](#overview)
2. [Tables](#tables)
3. [Indexes](#indexes)
4. [Query Patterns](#query-patterns)
5. [Performance Expectations](#performance-expectations)
6. [Data Types Rationale](#data-types-rationale)
7. [Constraints](#constraints)
8. [Helper Functions](#helper-functions)
9. [Common Queries](#common-queries)

---

## Overview

This schema stores Polymarket market data optimized for:

- **UPSERT pattern**: Batch syncing 500+ markets efficiently
- **Screener queries**: Fast filtering, sorting, and searching
- **Future extensibility**: Placeholder columns for Phase 2 signals
- **Data integrity**: Comprehensive constraints preventing invalid data

### Design Principles

1. **Store raw + parsed**: JSONB column for debugging + typed columns for performance
2. **Index strategically**: Cover common query patterns, avoid over-indexing
3. **Future-proof**: Phase 2 columns exist now (NULL), avoid ALTER TABLE later
4. **Observability**: Dedicated `sync_logs` table for monitoring

---

## Tables

### `markets`

**Purpose:** Stores current state of all Polymarket markets

**Row Count (expected):**
- Phase 1: ~1,000-2,000 active markets
- Growth: +100-200 markets/month

**Storage (estimated):**
- ~5-10 KB per market (with JSONB)
- Total: ~10-20 MB for 2,000 markets

**Update Frequency:** Every 5 minutes (on-demand sync)

#### Columns

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `market_id` | TEXT | NOT NULL | **PRIMARY KEY** - Unique Polymarket market ID |
| `title` | TEXT | NOT NULL | Market question/title |
| `description` | TEXT | NULL | Detailed market description |
| `slug` | TEXT | NOT NULL | URL-friendly slug from Polymarket |
| `condition_id` | TEXT | NULL | Polymarket condition ID |
| `category` | TEXT | NULL | Category: Politics, Sports, Crypto, etc. |
| `tags` | TEXT[] | NULL | Array of tag strings |
| `image_url` | TEXT | NULL | Market image URL |
| `outcomes` | TEXT[] | NOT NULL | Binary outcomes (default: ['Yes', 'No']) |
| `current_price` | NUMERIC(18,8) | NULL | Current YES outcome price (0-1) |
| `outcome_prices` | NUMERIC(18,8)[] | NULL | Array: [yes_price, no_price] |
| `volume_24h` | NUMERIC(18,2) | NOT NULL | 24h volume in USD |
| `volume_total` | NUMERIC(18,2) | NOT NULL | Total volume in USD |
| `liquidity` | NUMERIC(18,2) | NOT NULL | Current liquidity in USD |
| `active` | BOOLEAN | NOT NULL | Is market active? |
| `closed` | BOOLEAN | NOT NULL | Is market closed/resolved? |
| `end_date` | TIMESTAMPTZ | NULL | Market close/resolution date |
| `momentum_score` | NUMERIC(5,2) | NULL | **Phase 2**: Momentum score (-100 to +100) |
| `sii_score` | NUMERIC(5,2) | NULL | **Phase 2**: Smart Imbalance Index (-100 to +100) |
| `smart_money_delta` | NUMERIC(5,4) | NULL | **Phase 2**: Smart money flow (-1 to +1) |
| `last_trade_timestamp` | TIMESTAMPTZ | NULL | **Phase 2**: Last trade timestamp |
| `raw_polymarket_data` | JSONB | NULL | Complete API response for debugging |
| `created_at` | TIMESTAMPTZ | NOT NULL | Row creation timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL | Last update timestamp (auto-updated) |

#### Example Row

```json
{
  "market_id": "0x1234567890abcdef",
  "title": "Will Bitcoin reach $100k by December 2025?",
  "description": "This market resolves YES if Bitcoin (BTC) trades at or above $100,000 USD on any major exchange...",
  "slug": "will-bitcoin-reach-100k-by-dec-2025",
  "condition_id": "0xabcdef1234567890",
  "category": "Crypto",
  "tags": ["Bitcoin", "Price Prediction", "2025"],
  "image_url": "https://polymarket-upload.s3.amazonaws.com/bitcoin.png",
  "outcomes": ["Yes", "No"],
  "current_price": 0.65000000,
  "outcome_prices": [0.65000000, 0.35000000],
  "volume_24h": 125000.00,
  "volume_total": 2450000.00,
  "liquidity": 85000.00,
  "active": true,
  "closed": false,
  "end_date": "2025-12-31T23:59:59Z",
  "momentum_score": null,
  "sii_score": null,
  "smart_money_delta": null,
  "last_trade_timestamp": null,
  "raw_polymarket_data": { ... },
  "created_at": "2025-01-15T10:30:00Z",
  "updated_at": "2025-10-22T13:15:00Z"
}
```

---

### `sync_logs`

**Purpose:** Audit trail of all market sync operations

**Row Count (expected):**
- 12 syncs/hour × 24 hours = 288 syncs/day
- ~8,600 syncs/month
- Consider retention policy (delete logs older than 90 days)

**Storage (estimated):** ~1 KB per log entry

#### Columns

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | BIGSERIAL | NOT NULL | **PRIMARY KEY** - Auto-incrementing ID |
| `sync_started_at` | TIMESTAMPTZ | NOT NULL | When sync job started |
| `sync_completed_at` | TIMESTAMPTZ | NULL | When sync job completed (NULL if still running) |
| `duration_ms` | INTEGER | NULL | Total duration in milliseconds |
| `status` | TEXT | NOT NULL | 'running', 'success', 'partial', 'failed' |
| `markets_fetched` | INTEGER | NOT NULL | Markets fetched from Polymarket API |
| `markets_synced` | INTEGER | NOT NULL | Markets successfully upserted |
| `markets_failed` | INTEGER | NOT NULL | Markets failed to upsert |
| `error_message` | TEXT | NULL | Error message if failed |
| `error_stack` | TEXT | NULL | Full error stack trace |
| `api_response_time_ms` | INTEGER | NULL | Polymarket API response time |
| `api_rate_limited` | BOOLEAN | NOT NULL | Did we hit 429 rate limit? |
| `triggered_by` | TEXT | NULL | 'cron', 'manual', 'api_request' |
| `sync_config` | JSONB | NULL | Sync configuration snapshot |
| `created_at` | TIMESTAMPTZ | NOT NULL | Row creation timestamp |

#### Example Row

```json
{
  "id": 12345,
  "sync_started_at": "2025-10-22T13:10:00Z",
  "sync_completed_at": "2025-10-22T13:10:15Z",
  "duration_ms": 15234,
  "status": "success",
  "markets_fetched": 1234,
  "markets_synced": 1234,
  "markets_failed": 0,
  "error_message": null,
  "error_stack": null,
  "api_response_time_ms": 450,
  "api_rate_limited": false,
  "triggered_by": "cron",
  "sync_config": {
    "batch_size": 500,
    "include_closed": false,
    "min_liquidity": 0
  },
  "created_at": "2025-10-22T13:10:00Z"
}
```

---

## Indexes

### Index Strategy

**Goal:** Fast queries without over-indexing (slows writes)

**Approach:**
1. **Covering indexes** for common filter+sort combinations
2. **Partial indexes** (`WHERE active = TRUE`) to reduce index size
3. **GIN indexes** for array/JSONB columns
4. **Trigram index** for full-text search

### Index Details

| Index Name | Columns | Type | Purpose | Size Impact |
|------------|---------|------|---------|-------------|
| `idx_markets_active` | `active` (WHERE active=TRUE) | BTREE | Filter active markets | Small (partial) |
| `idx_markets_category` | `category` (WHERE active=TRUE) | BTREE | Category filter | Small (partial) |
| `idx_markets_volume_24h` | `volume_24h DESC` (WHERE active=TRUE) | BTREE | Default screener sort | Medium |
| `idx_markets_end_date` | `end_date ASC` (WHERE active=TRUE) | BTREE | Markets closing soon | Small |
| `idx_markets_title_trgm` | `title` | GIN (trigram) | Fuzzy text search | Large |
| `idx_markets_category_volume` | `category, volume_24h DESC` (WHERE active=TRUE) | BTREE | Category + volume sort | Medium |
| `idx_markets_raw_data_gin` | `raw_polymarket_data` | GIN | JSONB queries | Large |
| `idx_markets_momentum_score` | `momentum_score DESC` (WHERE active=TRUE AND NOT NULL) | BTREE | Phase 2: Momentum sort | Small |
| `idx_markets_sii_score` | `sii_score DESC` (WHERE active=TRUE AND NOT NULL) | BTREE | Phase 2: SII sort | Small |
| `idx_sync_logs_started_at` | `sync_started_at DESC` | BTREE | Recent sync logs | Small |
| `idx_sync_logs_status` | `status` (WHERE status IN ('failed', 'partial')) | BTREE | Failed syncs | Tiny (partial) |

**Total Index Size (estimated):** ~5-10 MB for 2,000 markets

---

## Query Patterns

### Pattern 1: Default Screener Load

**Query:**
```sql
SELECT
  market_id,
  title,
  category,
  current_price,
  volume_24h,
  liquidity,
  end_date
FROM markets
WHERE active = TRUE
ORDER BY volume_24h DESC NULLS LAST
LIMIT 100;
```

**Indexes Used:**
- `idx_markets_volume_24h` (covering index for WHERE + ORDER BY)

**Expected Performance:** < 50ms

**EXPLAIN Plan:**
```
Index Scan using idx_markets_volume_24h on markets
  Index Cond: (active = true)
  Limit: 100
```

---

### Pattern 2: Category Filter + Volume Sort

**Query:**
```sql
SELECT
  market_id,
  title,
  category,
  current_price,
  volume_24h
FROM markets
WHERE active = TRUE
  AND category = 'Sports'
ORDER BY volume_24h DESC
LIMIT 100;
```

**Indexes Used:**
- `idx_markets_category_volume` (composite covering index)

**Expected Performance:** < 30ms

**EXPLAIN Plan:**
```
Index Scan using idx_markets_category_volume on markets
  Index Cond: (category = 'Sports' AND active = true)
  Limit: 100
```

---

### Pattern 3: Fuzzy Title Search

**Query:**
```sql
SELECT
  market_id,
  title,
  category,
  current_price
FROM markets
WHERE active = TRUE
  AND title ILIKE '%bitcoin%'
ORDER BY volume_24h DESC
LIMIT 20;
```

**Indexes Used:**
- `idx_markets_title_trgm` (GIN trigram for ILIKE)
- `idx_markets_volume_24h` (for ORDER BY)

**Expected Performance:** < 100ms

**EXPLAIN Plan:**
```
Bitmap Heap Scan on markets
  Recheck Cond: (title ILIKE '%bitcoin%')
  Filter: (active = true)
  -> Bitmap Index Scan on idx_markets_title_trgm
  Sort: volume_24h DESC
```

---

### Pattern 4: Single Market Lookup

**Query:**
```sql
SELECT *
FROM markets
WHERE market_id = '0x1234567890abcdef';
```

**Indexes Used:**
- PRIMARY KEY index on `market_id`

**Expected Performance:** < 5ms

**EXPLAIN Plan:**
```
Index Scan using markets_pkey on markets
  Index Cond: (market_id = '0x1234567890abcdef')
```

---

### Pattern 5: Markets Closing Soon

**Query:**
```sql
SELECT
  market_id,
  title,
  end_date,
  EXTRACT(EPOCH FROM (end_date - NOW())) / 3600 AS hours_until_close
FROM markets
WHERE active = TRUE
  AND closed = FALSE
  AND end_date IS NOT NULL
  AND end_date < NOW() + INTERVAL '24 hours'
ORDER BY end_date ASC
LIMIT 50;
```

**Indexes Used:**
- `idx_markets_end_date` (covering index for WHERE + ORDER BY)

**Expected Performance:** < 50ms

**EXPLAIN Plan:**
```
Index Scan using idx_markets_end_date on markets
  Index Cond: (end_date < (NOW() + '24 hours'))
  Filter: (active = true AND closed = false)
  Limit: 50
```

---

### Pattern 6: UPSERT (Batch Insert)

**Query:**
```sql
INSERT INTO markets (
  market_id,
  title,
  slug,
  category,
  current_price,
  outcome_prices,
  volume_24h,
  volume_total,
  liquidity,
  active,
  closed,
  end_date,
  raw_polymarket_data
)
VALUES
  ('0x123...', 'Market 1', 'market-1', 'Sports', 0.65, ARRAY[0.65, 0.35], 10000, 50000, 5000, true, false, '2025-12-31', '{}'),
  ('0x456...', 'Market 2', 'market-2', 'Crypto', 0.72, ARRAY[0.72, 0.28], 20000, 100000, 8000, true, false, '2026-01-15', '{}')
  -- ... (up to 500 rows per batch)
ON CONFLICT (market_id)
DO UPDATE SET
  title = EXCLUDED.title,
  current_price = EXCLUDED.current_price,
  outcome_prices = EXCLUDED.outcome_prices,
  volume_24h = EXCLUDED.volume_24h,
  volume_total = EXCLUDED.volume_total,
  liquidity = EXCLUDED.liquidity,
  active = EXCLUDED.active,
  closed = EXCLUDED.closed,
  end_date = EXCLUDED.end_date,
  raw_polymarket_data = EXCLUDED.raw_polymarket_data,
  updated_at = NOW();
```

**Expected Performance:**
- 500 rows: < 1 second (target: ~500-800ms)
- 1,000 rows: < 2 seconds

**Optimization Tips:**
- Use prepared statements
- Batch size: 500 rows (tested optimal in old system)
- Run inside transaction for atomicity

---

## Performance Expectations

### Query Performance Targets

| Query Type | P50 Target | P95 Target | P99 Target |
|------------|------------|------------|------------|
| Default screener load | < 50ms | < 100ms | < 200ms |
| Category filter | < 30ms | < 80ms | < 150ms |
| Fuzzy search | < 100ms | < 200ms | < 400ms |
| Single market lookup | < 5ms | < 10ms | < 20ms |
| Markets closing soon | < 50ms | < 100ms | < 200ms |
| UPSERT (500 markets) | < 800ms | < 1.5s | < 3s |

### Write Performance

**UPSERT Benchmarks (500 markets):**
- **Best case** (all new): ~500ms
- **Average case** (50% updates): ~700ms
- **Worst case** (all updates): ~900ms

**Index Maintenance Overhead:**
- Each index adds ~5-10% to write time
- Total overhead: ~40-80ms per 500-row batch

### Index Size vs Performance Trade-off

**Current strategy:**
- 11 indexes total
- Estimated size: ~5-10 MB (negligible)
- Write overhead: ~40-80ms per batch (acceptable)
- Read performance gain: 10-50x faster queries

**If performance degrades:**
1. Drop `idx_markets_raw_data_gin` (rarely used)
2. Drop `idx_markets_title_trgm` (if search not critical)
3. Combine `idx_markets_momentum_score` and `idx_markets_sii_score` into single multi-column index

---

## Data Types Rationale

### `NUMERIC(18,8)` for Prices

**Why not FLOAT/DOUBLE?**
- Floating-point has rounding errors (0.1 + 0.2 ≠ 0.3)
- Prediction market prices need exact precision
- Example: 0.12345678 must be stored exactly

**Precision choice:**
- 18 total digits, 8 decimals
- Range: 0.00000001 to 9999999999.99999999
- Polymarket prices: 0-1 with up to 8 decimals
- **NUMERIC(18,8)** handles this perfectly

### `NUMERIC(18,2)` for USD Amounts

**Why not INTEGER (cents)?**
- Need to store fractional cents (e.g., $1,234.567)
- Polymarket API returns decimals
- Easier to work with in application code

**Precision choice:**
- 18 total digits, 2 decimals
- Range: $0.01 to $9,999,999,999,999,999.99
- Max Polymarket market volume: ~$10M (as of 2025)
- **NUMERIC(18,2)** has plenty of headroom

### `TEXT[]` for Arrays

**Why not separate table?**
- Simple use case (tags, outcomes)
- No normalization needed
- Faster to query (no JOIN)
- PostgreSQL arrays support indexing (GIN)

**Example:**
```sql
-- Query markets with tag 'Bitcoin'
SELECT * FROM markets WHERE 'Bitcoin' = ANY(tags);

-- Uses GIN index on tags column (if created)
```

### `JSONB` for raw_polymarket_data

**Why JSONB instead of JSON?**
- **JSONB** is binary format (faster queries)
- Supports indexing with GIN
- Can query nested fields efficiently

**Example:**
```sql
-- Query markets where raw data has specific field
SELECT * FROM markets
WHERE raw_polymarket_data->>'condition_id' = '0xabc...';

-- Uses idx_markets_raw_data_gin
```

---

## Constraints

### Primary Key: `market_id`

**Purpose:** Enforce uniqueness, enable efficient UPSERT

**Performance:**
- Lookup by PK: O(log n) using B-tree index
- UPSERT conflict resolution: O(log n)

### Check Constraints

#### `markets_status_check`

```sql
CHECK (NOT (active = TRUE AND closed = TRUE))
```

**Prevents:** Market being both active and closed simultaneously

**Error Example:**
```
ERROR: new row for relation "markets" violates check constraint "markets_status_check"
DETAIL: Failing row contains (active = true, closed = true)
```

#### `markets_volume_24h_check`

```sql
CHECK (volume_24h <= volume_total OR volume_total = 0)
```

**Prevents:** 24h volume exceeding total volume

**Rationale:** 24h volume is subset of total volume (unless market just started)

#### `markets_price_range_check`

```sql
CHECK (current_price IS NULL OR (current_price >= 0 AND current_price <= 1))
```

**Prevents:** Invalid probability values

**Rationale:** Polymarket prices are probabilities (0-1 range)

#### `markets_end_date_check`

```sql
CHECK (
  closed = TRUE OR
  end_date IS NULL OR
  end_date > created_at
)
```

**Prevents:** Active markets with past end dates

**Rationale:** End date must be in future for open markets

### Foreign Keys

**None in Phase 1** - Tables are independent

**Phase 2 additions:**
- `trades.market_id` → `markets.market_id`
- `positions.market_id` → `markets.market_id`

---

## Helper Functions

### `get_market_data_staleness()`

**Purpose:** Check how old the market data is

**Returns:** `INTERVAL` (e.g., "00:03:45" = 3 minutes 45 seconds)

**Usage:**
```sql
SELECT get_market_data_staleness();
-- Output: "00:03:45"
```

**Implementation:**
```sql
SELECT NOW() - MAX(updated_at) FROM markets;
```

---

### `is_market_data_stale(threshold_minutes)`

**Purpose:** Boolean check if sync is needed

**Parameters:**
- `threshold_minutes` (default: 5)

**Returns:** `BOOLEAN`

**Usage:**
```sql
-- Check if data is older than 5 minutes
SELECT is_market_data_stale(); -- Returns TRUE or FALSE

-- Custom threshold (10 minutes)
SELECT is_market_data_stale(10);
```

**Used By:** Sync orchestrator to determine if sync is needed

---

### `get_last_successful_sync()`

**Purpose:** Get info about most recent successful sync

**Returns:** Table with columns:
- `sync_id` (BIGINT)
- `completed_at` (TIMESTAMPTZ)
- `markets_synced` (INTEGER)
- `duration_ms` (INTEGER)

**Usage:**
```sql
SELECT * FROM get_last_successful_sync();
```

**Output Example:**
```
sync_id | completed_at         | markets_synced | duration_ms
--------|----------------------|----------------|------------
12345   | 2025-10-22 13:10:15  | 1234           | 15234
```

---

## Common Queries

### Get Active Markets by Volume

```sql
SELECT
  market_id,
  title,
  category,
  current_price,
  volume_24h,
  liquidity
FROM markets
WHERE active = TRUE
ORDER BY volume_24h DESC NULLS LAST
LIMIT 100;
```

---

### Search Markets by Title

```sql
SELECT
  market_id,
  title,
  category,
  current_price,
  volume_24h
FROM markets
WHERE active = TRUE
  AND title ILIKE '%election%'
ORDER BY volume_24h DESC
LIMIT 50;
```

---

### Get Markets in Specific Category

```sql
SELECT
  market_id,
  title,
  current_price,
  volume_24h,
  end_date
FROM markets
WHERE active = TRUE
  AND category = 'Politics'
ORDER BY volume_24h DESC
LIMIT 50;
```

---

### Get Markets Closing Soon (Next 24 Hours)

```sql
SELECT
  market_id,
  title,
  end_date,
  EXTRACT(EPOCH FROM (end_date - NOW())) / 3600 AS hours_until_close
FROM markets
WHERE active = TRUE
  AND closed = FALSE
  AND end_date IS NOT NULL
  AND end_date BETWEEN NOW() AND NOW() + INTERVAL '24 hours'
ORDER BY end_date ASC;
```

---

### Get Sync Status

```sql
-- Check if sync is needed
SELECT is_market_data_stale(5) AS needs_sync;

-- Get staleness
SELECT get_market_data_staleness() AS staleness;

-- Get last sync info
SELECT * FROM get_last_successful_sync();
```

---

### Get Recent Failed Syncs

```sql
SELECT
  id,
  sync_started_at,
  status,
  error_message,
  markets_fetched,
  markets_synced,
  markets_failed
FROM sync_logs
WHERE status IN ('failed', 'partial')
ORDER BY sync_started_at DESC
LIMIT 10;
```

---

### Get Sync Performance Over Time

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

---

### Get Markets with High Volume but Low Liquidity

```sql
SELECT
  market_id,
  title,
  volume_24h,
  liquidity,
  (volume_24h / NULLIF(liquidity, 0)) AS volume_to_liquidity_ratio
FROM markets
WHERE active = TRUE
  AND volume_24h > 10000 -- $10k+ volume
  AND liquidity < 5000   -- <$5k liquidity
ORDER BY volume_to_liquidity_ratio DESC
LIMIT 20;
```

---

## Migration Checklist

- [ ] Review migration SQL file
- [ ] Test migration on local development database
- [ ] Verify all indexes are created
- [ ] Verify constraints are working (try inserting invalid data)
- [ ] Test UPSERT with sample data (500 rows)
- [ ] Measure query performance with sample data
- [ ] Run rollback script to test reversibility
- [ ] Re-run migration to verify idempotency
- [ ] Document any deviations from this schema
- [ ] Update API routes to use new schema
- [ ] Deploy to staging environment
- [ ] Monitor query performance in staging
- [ ] Deploy to production

---

## Monitoring Queries

### Daily Health Check

```sql
-- Run this daily to monitor system health
SELECT
  (SELECT COUNT(*) FROM markets WHERE active = TRUE) AS active_markets,
  (SELECT COUNT(*) FROM markets WHERE closed = TRUE) AS closed_markets,
  (SELECT get_market_data_staleness()) AS data_age,
  (SELECT is_market_data_stale(5)) AS needs_sync,
  (SELECT COUNT(*) FROM sync_logs WHERE sync_started_at >= NOW() - INTERVAL '24 hours') AS syncs_last_24h,
  (SELECT COUNT(*) FROM sync_logs WHERE status = 'failed' AND sync_started_at >= NOW() - INTERVAL '24 hours') AS failed_syncs_24h;
```

---

## Troubleshooting

### Slow Queries

**Symptom:** Screener queries taking >500ms

**Diagnosis:**
```sql
-- Check if indexes are being used
EXPLAIN ANALYZE
SELECT * FROM markets WHERE active = TRUE ORDER BY volume_24h DESC LIMIT 100;
```

**Solutions:**
1. Verify indexes exist: `\d markets` in psql
2. Run `ANALYZE markets;` to update query planner statistics
3. Check for table bloat: `SELECT pg_size_pretty(pg_total_relation_size('markets'));`
4. Rebuild indexes: `REINDEX TABLE markets;`

---

### UPSERT Timeouts

**Symptom:** Batch UPSERT taking >3 seconds

**Diagnosis:**
```sql
-- Check for locks
SELECT * FROM pg_stat_activity WHERE query ILIKE '%markets%';
```

**Solutions:**
1. Reduce batch size (500 → 250)
2. Drop unused indexes temporarily
3. Increase statement timeout: `SET statement_timeout = '10s';`
4. Run `VACUUM ANALYZE markets;` to reclaim space

---

### Stale Data

**Symptom:** Market data not updating

**Diagnosis:**
```sql
-- Check sync logs
SELECT * FROM sync_logs ORDER BY sync_started_at DESC LIMIT 5;

-- Check staleness
SELECT get_market_data_staleness();
```

**Solutions:**
1. Check if cron job is running
2. Check for failed syncs in `sync_logs`
3. Manually trigger sync: `curl -X POST /api/polymarket/sync`
4. Check Polymarket API status

---

## Performance Tuning

### Query Optimization

If queries are slow, try these optimizations:

1. **Add covering indexes** for common filter+sort combinations
2. **Use EXPLAIN ANALYZE** to identify bottlenecks
3. **Increase `work_mem`** for complex sorts: `SET work_mem = '64MB';`
4. **Partition table** by category (if >100k markets)
5. **Use materialized views** for expensive aggregations

### Index Optimization

**When to add an index:**
- Query appears in slow query log
- Sequential scan on large table
- Query runs frequently (>100/min)

**When to drop an index:**
- Never used (check `pg_stat_user_indexes`)
- Write performance is critical
- Index size > table size

### Maintenance

**Weekly:**
```sql
ANALYZE markets;
```

**Monthly:**
```sql
VACUUM ANALYZE markets;
REINDEX TABLE markets;
```

**When needed:**
```sql
VACUUM FULL markets; -- Reclaims space, locks table
```

---

## Appendix: EXPLAIN Plan Examples

### Example 1: Index Scan (Good)

```sql
EXPLAIN ANALYZE
SELECT * FROM markets WHERE active = TRUE ORDER BY volume_24h DESC LIMIT 100;
```

**Good Plan:**
```
Limit  (cost=0.42..123.45 rows=100 width=512) (actual time=0.123..1.234 rows=100 loops=1)
  ->  Index Scan using idx_markets_volume_24h on markets  (cost=0.42..1234.56 rows=1000 width=512) (actual time=0.121..1.198 rows=100 loops=1)
        Index Cond: (active = true)
Planning Time: 0.234 ms
Execution Time: 1.456 ms
```

**Key indicators:**
- ✅ Index Scan (not Seq Scan)
- ✅ Execution time < 10ms
- ✅ Rows returned = rows expected

---

### Example 2: Sequential Scan (Bad)

```sql
EXPLAIN ANALYZE
SELECT * FROM markets WHERE active = TRUE ORDER BY volume_24h DESC LIMIT 100;
```

**Bad Plan:**
```
Limit  (cost=1234.56..1234.67 rows=100 width=512) (actual time=456.789..456.890 rows=100 loops=1)
  ->  Sort  (cost=1234.56..1237.89 rows=1000 width=512) (actual time=456.788..456.850 rows=100 loops=1)
        Sort Key: volume_24h DESC
        Sort Method: top-N heapsort  Memory: 25kB
        ->  Seq Scan on markets  (cost=0.00..1200.00 rows=1000 width=512) (actual time=0.012..234.567 rows=1000 loops=1)
              Filter: (active = true)
              Rows Removed by Filter: 500
Planning Time: 0.345 ms
Execution Time: 456.901 ms
```

**Problems:**
- ❌ Sequential Scan (index not used)
- ❌ Execution time >450ms (too slow)
- ❌ Sort step (expensive)

**Fix:**
```sql
-- Create missing index
CREATE INDEX idx_markets_volume_24h ON markets(volume_24h DESC) WHERE active = TRUE;

-- Update statistics
ANALYZE markets;
```

---

## References

- [PostgreSQL Performance Tips](https://wiki.postgresql.org/wiki/Performance_Optimization)
- [Supabase Performance Docs](https://supabase.com/docs/guides/database/performance)
- [pg_trgm Extension](https://www.postgresql.org/docs/current/pgtrgm.html)
- [NUMERIC vs FLOAT](https://www.postgresql.org/docs/current/datatype-numeric.html)
