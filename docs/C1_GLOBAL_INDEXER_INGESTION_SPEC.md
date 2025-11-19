# Global Indexer Ingestion Pipeline Specification

**Date:** 2025-11-15
**Author:** C1
**Status:** ACTIVE (Mode 2 Incremental Sync Only)
**Last Updated:** 2025-11-15 (Post-C3 Audit)

---

## Overview

This document specifies the ingestion pipeline for syncing Polymarket position and P&L data from the Goldsky-hosted PNL Subgraph into ClickHouse `pm_positions_indexer` and `pm_wallet_pnl_indexer` tables.

**Goal:** Achieve near 100% Polymarket coverage without brute-forcing the Data API.

---

## Data Source

**Endpoint:** `https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn`

**Protocol:** GraphQL over HTTPS
**Authentication:** None required (public endpoint)
**Rate Limits:** Not publicly specified, but generous for reasonable usage

---

## Ingestion Modes

### Mode 1: Initial Full Backfill ❌ CANCELLED

**Status:** CANCELLED (Superseded by C3 Audit)

**Reason:** C3 Database Coverage Audit (2025-11-15) confirmed we already have near-complete historical coverage:
- 157,541,131 trades across 996,109 wallets
- Date range: Dec 2022 - Oct 31, 2025
- 100% ghost wallet coverage (all 12,717 wallets present)

**Original Plan (No Longer Needed):**
- ~~Trigger: First-time setup or complete rebuild~~
- ~~Scope: ALL UserPosition entities from subgraph~~
- ~~Estimated Size: ~130,000 positions~~
- ~~Estimated Time: 2-13 seconds (8 parallel workers)~~

**Conclusion:** Full backfill is redundant. Existing data in `vw_trades_canonical` provides complete historical coverage.

---

### Mode 2: Incremental Sync ✅ ACTIVE

**Trigger:** Scheduled (every 15 minutes) or on-demand
**Scope:** Trades/positions from 2025-10-31 10:00:38 to present (15-day gap + ongoing)
**Estimated Size:** 100-500 positions per sync (varies by market activity)
**Estimated Time:** <1 second

**One-Time Backfill (Priority):**
- Fill 15-day gap: Oct 31, 2025 - Nov 15, 2025
- Estimated missing trades: ~2,250,000 (150k/day × 15 days)
- Execute once, then switch to ongoing sync

**Process:**
1. Read last sync timestamp from checkpoint table
2. Query positions with `id > lastCheckpoint` (ordered by id)
3. Fetch up to 1000 positions
4. Upsert into ClickHouse (ReplacingMergeTree handles duplicates)
5. Update checkpoint timestamp
6. Trigger materialized view refresh if needed

---

## GraphQL Query Patterns

### Full Backfill Query (Paginated)

```graphql
query GetPositions($skip: Int!, $first: Int!) {
  userPositions(
    first: $first
    skip: $skip
    orderBy: id
    orderDirection: asc
  ) {
    id
    user
    tokenId
    amount
    avgPrice
    realizedPnl
    totalBought
  }
}
```

**Variables:**
```json
{
  "skip": 0,      // Offset (0, 1000, 2000, ...)
  "first": 1000   // Page size (max 1000)
}
```

---

### Incremental Sync Query

```graphql
query GetPositionsSince($lastId: ID!, $first: Int!) {
  userPositions(
    where: { id_gt: $lastId }
    first: $first
    orderBy: id
    orderDirection: asc
  ) {
    id
    user
    tokenId
    amount
    avgPrice
    realizedPnl
    totalBought
  }
}
```

**Variables:**
```json
{
  "lastId": "0xcce2b7c...-12345",  // Last synced composite ID
  "first": 1000
}
```

---

### Count Query (For Progress Tracking)

```graphql
query GetTotalCount {
  _meta {
    block {
      number
    }
  }
}
```

**Note:** GraphQL doesn't provide direct count, so we estimate from pagination.

---

## ClickHouse Upsert Mechanism

### Insert Strategy

**Engine:** ReplacingMergeTree(version)

**Upsert Logic:**
```sql
INSERT INTO pm_positions_indexer (
  id,
  wallet_address,
  token_id,
  condition_id,
  outcome_index,
  amount,
  avg_price,
  realized_pnl,
  total_bought,
  version,
  last_synced_at,
  source_version
) VALUES (
  '0xcce2b7c...-12345',
  '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
  '123456789...',
  'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1',
  1,
  1000000000000000000,  -- 1.0 shares (18 decimals)
  500000,                -- $0.50 (6 decimals)
  100000000,             -- $100 P&L (6 decimals)
  2000000000000000000,  -- 2.0 total bought
  NOW(),                 -- version (latest wins)
  NOW(),                 -- last_synced_at
  '0.0.14'              -- source_version
);
```

**Deduplication:** ReplacingMergeTree automatically keeps latest version based on `version` field.

**Query Pattern:** Use `FINAL` modifier to get deduplicated results:
```sql
SELECT * FROM pm_positions_indexer FINAL WHERE wallet_address = '0x...';
```

---

## Batch Sizes and Parallelization

### Full Backfill

**Page Size:** 1000 records per GraphQL query
**Parallel Workers:** 8 workers
**Worker Assignment:**
- Worker 0: pages 0-N/8
- Worker 1: pages N/8 - 2N/8
- etc.

**Insert Batch Size:** 1000 records per ClickHouse insert
**Checkpoint Frequency:** Every 1000 records

**Example:**
```
Total positions: 130,000
Pages: 130
Workers: 8
Pages per worker: ~16
Time per page: 100ms (GraphQL) + 50ms (ClickHouse) = 150ms
Total time: 16 * 150ms = 2.4 seconds per worker
```

---

### Incremental Sync

**Page Size:** 1000 records (usually much less needed)
**Parallel Workers:** 1 (sequential for simplicity)
**Insert Batch Size:** All fetched records in single insert
**Checkpoint Frequency:** After each successful sync

---

## Retry and Backoff Strategy

### GraphQL Query Failures

**Retry Count:** 3 attempts
**Backoff:** Exponential
- Attempt 1: Immediate
- Attempt 2: 1 second delay
- Attempt 3: 4 seconds delay
- Attempt 4: Fail and log

**Retryable Errors:**
- HTTP 429 (Rate Limit)
- HTTP 500, 502, 503, 504 (Server Errors)
- Network timeouts
- Connection resets

**Non-Retryable Errors:**
- HTTP 400 (Bad Request) - fix query
- HTTP 401, 403 (Auth) - shouldn't happen
- GraphQL syntax errors

---

### ClickHouse Insert Failures

**Retry Count:** 2 attempts
**Backoff:** Linear (1 second delay)

**Retryable:**
- Connection errors
- Temporary table locks

**Non-Retryable:**
- Schema mismatches
- Constraint violations
- Disk full errors

---

## Checkpoint Management

### Checkpoint Table Schema

```sql
CREATE TABLE sync_checkpoints (
  sync_type String,           -- 'full_backfill' or 'incremental'
  last_synced_id String,      -- Last processed UserPosition.id
  last_synced_block UInt64,   -- Last processed block number
  last_synced_at DateTime64(3) DEFAULT now(),
  records_processed UInt64,
  status String,              -- 'in_progress', 'completed', 'failed'
  worker_id UInt8,            -- For parallel workers (0-7)
  error_message Nullable(String)
) ENGINE = ReplacingMergeTree(last_synced_at)
ORDER BY (sync_type, worker_id);
```

### Checkpoint Usage

**Save Checkpoint:**
```sql
INSERT INTO sync_checkpoints VALUES (
  'full_backfill',
  '0xcce2b7c...-12345',
  18234567,
  now(),
  1000,
  'in_progress',
  0,
  NULL
);
```

**Resume from Checkpoint:**
```sql
SELECT last_synced_id, records_processed
FROM sync_checkpoints FINAL
WHERE sync_type = 'full_backfill' AND worker_id = 0
ORDER BY last_synced_at DESC
LIMIT 1;
```

---

## Token ID Decoding

**Challenge:** GraphQL returns `tokenId` as BigInt (256-bit), need to extract `condition_id` (64-char hex) and `outcome_index` (0-based).

**Algorithm:**
```typescript
function decodeTokenId(tokenId: bigint): { conditionId: string; outcomeIndex: number } {
  // Token ID format: conditionId (254 bits) + outcomeIndex (log2 encoding)
  // For binary markets: outcomeIndex = 0 or 1

  // Extract condition ID (first 254 bits → 64 hex chars)
  const conditionId = (tokenId >> 2n).toString(16).padStart(64, '0');

  // Extract outcome index from lower 2 bits (for binary)
  const collectionId = tokenId & 0x3n;  // Last 2 bits
  const outcomeIndex = collectionId === 1n ? 0 : 1;  // log2 decoding

  return { conditionId, outcomeIndex };
}
```

**Implementation:** Create `lib/polymarket/token-decoder.ts`

**Validation:** Cross-check against existing condition_id mappings from pm_markets

---

## Sync Frequency

### Incremental Sync Schedule

**Frequency:** Every 5 minutes
**Cron Expression:** `*/5 * * * *`
**Implementation:** GitHub Actions, systemd timer, or cron job

**Example Cron:**
```bash
*/5 * * * * cd /app && npx tsx scripts/sync-indexer-positions.ts --mode incremental
```

---

### Manual Triggers

**Full Rebuild:**
```bash
npx tsx scripts/sync-indexer-positions.ts --mode full --workers 8
```

**Incremental (On-Demand):**
```bash
npx tsx scripts/sync-indexer-positions.ts --mode incremental
```

**Resume Failed Backfill:**
```bash
npx tsx scripts/sync-indexer-positions.ts --mode full --workers 8 --resume
```

---

## Monitoring and Alerts

### Metrics to Track

**Ingestion Health:**
- Last successful sync timestamp
- Records processed in last hour/day
- Failed sync attempts
- Average sync duration
- GraphQL query latency
- ClickHouse insert latency

**Data Quality:**
- Total positions in pm_positions_indexer
- Distinct wallets
- Distinct conditions
- Positions with amount = 0 (closed positions)
- P&L sum (should be non-negative overall)

---

### Alert Conditions

| Condition | Threshold | Action |
|-----------|-----------|--------|
| Sync failure | 3 consecutive failures | Page on-call |
| Sync lag | >10 minutes behind | Slack alert |
| GraphQL errors | >10% error rate | Investigate endpoint |
| ClickHouse errors | Any insert failure | Investigate schema |
| Position count drop | >5% decrease | Data quality check |

---

## Error Handling

### Graceful Degradation

**If Goldsky Subgraph Unavailable:**
1. Log error
2. Retry with exponential backoff (up to 5 minutes)
3. If still failing, fall back to cached data
4. Alert monitoring system
5. Continue serving from existing ClickHouse data

**If ClickHouse Unavailable:**
1. Queue incoming data in memory (max 10MB)
2. Retry insert every 10 seconds
3. If queue full, write to disk buffer
4. Alert monitoring system
5. Resume when ClickHouse available

---

## Data Validation

### Pre-Insert Validation

**Check before inserting:**
- `wallet_address` is 40-char hex (lowercase)
- `token_id` is valid 256-bit number
- `condition_id` is 64-char hex (lowercase)
- `outcome_index` is 0 or 1 (for binary markets)
- `amount >= 0` (can be zero for closed positions)
- `avg_price` in range [0, 1000000] (6 decimals)
- `realized_pnl` is reasonable (not > $1M per position)

**Reject if:**
- Invalid hex formats
- Negative shares
- Price > $1.00
- Impossible P&L values

---

### Post-Insert Validation

**After each sync, verify:**
```sql
-- Check for negative shares
SELECT COUNT(*) FROM pm_positions_indexer FINAL WHERE amount < 0;

-- Check for invalid prices
SELECT COUNT(*) FROM pm_positions_indexer FINAL WHERE avg_price < 0 OR avg_price > 1000000;

-- Check for duplicate IDs (shouldn't happen with ReplacingMergeTree)
SELECT id, COUNT(*) FROM pm_positions_indexer GROUP BY id HAVING COUNT(*) > 1;
```

**If validation fails:** Alert and investigate, don't block future syncs

---

## Implementation Checklist

- [ ] Create `lib/polymarket/token-decoder.ts` with decodeTokenId function
- [ ] Create `scripts/sync-indexer-positions.ts` main ingestion script
- [ ] Implement GraphQL client with retry logic
- [ ] Implement checkpoint management
- [ ] Implement parallel worker coordination
- [ ] Add validation functions
- [ ] Create sync_checkpoints table
- [ ] Test full backfill with 1000 records
- [ ] Test incremental sync
- [ ] Test resume from checkpoint
- [ ] Set up monitoring and alerts
- [ ] Deploy cron job for 5-minute sync

---

## Performance Targets

| Metric | Target | Rationale |
|--------|--------|-----------|
| Full backfill (130K positions) | <15 seconds | 8 workers × 2s per worker |
| Incremental sync | <2 seconds | Typically <500 new positions |
| GraphQL query latency | <200ms | Goldsky SLA |
| ClickHouse insert latency | <100ms | Batch insert of 1000 records |
| Sync lag (incremental) | <5 minutes | Fresh enough for leaderboards |
| Uptime | >99.9% | 1 failure per 1000 syncs acceptable |

---

## Future Optimizations

**If needed in future:**

1. **Delta Compression**
   - Only sync positions that changed (compare avgPrice, amount, realizedPnl)
   - Reduces ClickHouse writes by ~80%

2. **Materialized View Auto-Refresh**
   - Trigger pm_wallet_pnl_indexer refresh after inserts
   - Use POPULATE keyword or manual refresh

3. **Multi-Region Deployment**
   - Deploy sync workers in multiple regions
   - Reduces GraphQL latency

4. **GraphQL Subscription**
   - Use GraphQL subscriptions instead of polling
   - Real-time updates instead of 5-minute lag

5. **Sharding**
   - Shard pm_positions_indexer by wallet_address hash
   - Improves write throughput for >1M positions

---

**Status:** Mode 2 (Incremental Sync) active, Mode 1 (Full Backfill) cancelled

---

## Post-C3 Audit Update

### Implementation Status Change

**Original Plan:**
- Mode 1: Full backfill of ~130K positions (8 workers, 10-15 seconds)
- Mode 2: Incremental sync every 5 minutes

**Revised Plan (Post-C3 Audit):**
- Mode 1: ❌ CANCELLED (we already have 157M trades through Oct 31)
- Mode 2: ✅ ACTIVE (fill 15-day gap + ongoing sync every 15 minutes)

### C3 Audit Key Findings

- **157,541,131 trades** already in database (Dec 2022 - Oct 31, 2025)
- **996,109 wallets** with trade data
- **100% ghost wallet coverage** (all 12,717 wallets present)
- **Data freshness issue:** Latest trade is 2025-10-31 10:00:38 (15 days old)

### New Priorities

1. **Market ID Repair** (P0) - Fix 51% null market IDs in xcnstrategy trades
2. **15-Day Backfill** (P1) - Fill gap from Oct 31 to present
3. **Ongoing Sync** (P2) - Maintain freshness with 15-minute recurring job

### Dependencies Removed

- ❌ Wait for C2 ghost cohort ingestion
- ❌ Cross-validate against C2 Data API
- ❌ Full historical backfill

### New Dependencies

- ✅ vw_trades_canonical (existing 157M trades)
- ✅ market_resolutions_final (existing 157K resolutions)
- ✅ wallet_metrics_complete (existing 1M wallet metrics)

---

**Signed:** Claude 1 (C1)
**Date:** 2025-11-15 (PST)
**Last Updated:** 2025-11-15 (Post-C3 Audit)
