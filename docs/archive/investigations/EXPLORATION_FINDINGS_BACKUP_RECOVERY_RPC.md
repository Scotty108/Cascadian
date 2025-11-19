# CASCADIAN Codebase Exploration: Backup/Recovery & RPC Configuration

## Executive Summary

This exploration identified backup/recovery mechanisms, RPC configuration, checkpoint systems, and recovery procedures across the CASCADIAN codebase. The project uses a sophisticated checkpoint-based recovery system for blockchain backfill operations and atomic table swap patterns for safe database operations.

---

## 1. RPC Configuration

### Primary RPC Endpoints

**Location**: `/Users/scotty/Projects/Cascadian-app/.env.local` (lines 51, 135-137, 215-216)

#### Alchemy Configuration
```
ALCHEMY_API_KEY=30-jbCprwX6TA-BaZacoO
ALCHEMY_POLYGON_RPC_URL_BLOCKCHAIN=https://eth-mainnet.g.alchemy.com/v2/agpW5gfZvLIqqNUZy9fTu
ALCHEMY_POLYGON_RPC_URL=https://polygon-mainnet.g.alchemy.com/v2/30-jbCprwX6TA-BaZacoO
POLYGON_RPC_URL=https://polygon-mainnet.g.alchemy.com/v2/30-jbCprwX6TA-BaZacoO
```

#### Public RPC Fallback
File: `/Users/scotty/Projects/Cascadian-app/scripts/blockchain-resolution-backfill.ts` (line 32)
```typescript
const POLYGON_RPC = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';
const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
```

### RPC Error Handling

**File**: `/Users/scotty/Projects/Cascadian-app/scripts/blockchain-resolution-backfill.ts` (lines 110-165)

Error handling for rate limits and failures:
- Rate limit detection: Checks for "429" or "rate limit" in error messages
- Retry mechanism: 40ms rate limit between requests (~25 req/sec per worker)
- Batch configuration: 20,000 blocks per batch for Alchemy limits
- Detailed error logging with block numbers and error details

Error types tracked in checkpoints:
- 502 Bad Gateway errors (Cloudflare)
- Rate limit exhaustion with retry-in timeouts
- Missing response errors for eth_getLogs

---

## 2. Checkpoint/Recovery System

### Checkpoint Locations

#### Blockchain Fetch Checkpoints
**Base Directory**: `/Users/scotty/Projects/Cascadian-app/runtime/`

Primary checkpoints (12 workers + main):
- `blockchain-fetch-checkpoint.json` - Main checkpoint
- `blockchain-fetch-checkpoint-worker-1.json` through `blockchain-fetch-checkpoint-worker-12.json` - Per-worker tracking
- `blockchain-fetch-checkpoint.backup.json` - Backup copy

**Checkpoint Archive**: `/Users/scotty/Projects/Cascadian-app/runtime/old-checkpoints/`
- Stores older worker checkpoints for reference

#### Secondary Checkpoints
- `goldsky-checkpoint.json` - Goldsky data integration
- `goldsky-parallel.checkpoint.json` - Parallel processing state
- `goldsky-batch1.checkpoint.json` - Batch 1 state
- `discover-wallets.checkpoint.json` - Wallet discovery progress
- `resolution-backfill-checkpoint.json` - Resolution data backfill
- `logs-decode-checkpoint.json` - Log decoding progress
- `payout-backfill-worker*.checkpoint.json` - Payout backfill per worker
- Emergency recovery checkpoints (9 workers)

#### CLOB Checkpoints
**Location**: `/Users/scotty/Projects/Cascadian-app/.clob_checkpoints/`
Files track progress by wallet address:
- `0xd91e80cf2e7be2e162c6513ced06f1dd0da35296.json`
- `0xa4b366ad22fc0d06f1e934ff468e8922431a87b8.json`
- `0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0.json`
- `0x4d97dcd97ec945f40cf65f87097ace5ea0476045.json`
- `0x56c79347e95530c01a2fc76e732f9566da16e113.json`
- `0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e.json`

### Checkpoint Data Structure

**Blockchain Checkpoint Example** (`blockchain-fetch-checkpoint.json`):
```json
{
  "lastProcessedBlock": 52336658,
  "totalEvents": 0,
  "totalTrades": 0,
  "uniqueWallets": [],
  "errors": [
    {
      "block": 52062909,
      "error": "server response 502 Bad Gateway"
    },
    {
      "block": 52126509,
      "error": "Too many requests, reason: call rate limit exhausted, retry in 10m0s"
    }
  ],
  "startTime": "2025-10-31T00:47:35.008Z"
}
```

**Worker Checkpoint Example** (`blockchain-fetch-checkpoint-worker-1.json`):
```json
{
  "lastProcessedBlock": 54199999,
  "totalEvents": 112255,
  "totalTrades": 224510,
  "uniqueWallets": [
    "0x3cf3e8d5427aed066a7a5926980600f6c3cf87b3",
    ...50+ wallets
  ],
  "errors": []
}
```

**CLOB Checkpoint Example** (`.clob_checkpoints/0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0.json`):
```json
{
  "lastMinTimestampMs": 1762460133000,
  "pagesProcessed": 2,
  "totalNewFills": 1000,
  "lastPageSize": 500,
  "lastPageUniqueIdCount": 500
}
```

### Checkpoint Management Code

**File**: `/Users/scotty/Projects/Cascadian-app/scripts/blockchain-resolution-backfill.ts` (lines 74-91)

```typescript
function loadCheckpoint(): Checkpoint | null {
  try {
    const fs = require('fs');
    if (fs.existsSync(CHECKPOINT_FILE)) {
      return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf-8'));
    }
  } catch (error) {
    console.log('No checkpoint found, starting fresh');
  }
  return null;
}

function saveCheckpoint(checkpoint: Checkpoint) {
  const fs = require('fs');
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2));
}
```

---

## 3. Backup & Recovery Procedures

### Atomic Rebuild Pattern (CREATE TABLE AS SELECT + RENAME)

This is the canonical backup/recovery pattern used throughout the codebase.

#### Pattern Implementation

**Files Using Atomic Rebuild**:
1. `/Users/scotty/Projects/Cascadian-app/scripts/dedup-forensics-and-rebuild.ts` (line 96)
   ```typescript
   ALTER TABLE trades_dedup_mat RENAME TO trades_dedup_mat_bak
   ```

2. `/Users/scotty/Projects/Cascadian-app/scripts/enrich-very-safe.ts` (lines 131-137)
   ```typescript
   CREATE TABLE trades_raw_enriched_v2 AS SELECT * FROM trades_raw WHERE 1=0
   // ... populate with enriched data ...
   RENAME TABLE trades_raw TO trades_raw_backup_pre_enrichment
   RENAME TABLE trades_raw_enriched_v2 TO trades_raw
   ```

3. `/Users/scotty/Projects/Cascadian-app/scripts/execute-enrichment-simple.ts`
   ```typescript
   RENAME TABLE trades_raw TO trades_raw_backup
   RENAME TABLE trades_raw_enriched TO trades_raw
   ```

4. `/Users/scotty/Projects/Cascadian-app/scripts/compute-metrics-nuclear.ts`
   - Uses: CREATE TABLE AS SELECT + RENAME pattern
   - Purpose: Atomic metrics computation

### Rollback/Recovery Scripts

**File**: `/Users/scotty/Projects/Cascadian-app/scripts/rollback-swap.ts`

Complete rollback mechanism for table swap operations:
```typescript
async function main() {
  // Drop broken current tables
  await ch.command({ query: "DROP TABLE outcome_positions_v2" });
  await ch.command({ query: "DROP TABLE trade_cashflows_v3" });
  
  // Restore from timestamped backups
  await ch.command({ 
    query: "RENAME TABLE outcome_positions_v2_backup_20251107T071726 TO outcome_positions_v2" 
  });
  await ch.command({ 
    query: "RENAME TABLE trade_cashflows_v3_backup_20251107T071726 TO trade_cashflows_v3" 
  });
}
```

**Backup naming convention**: `{table_name}_backup_{ISO8601_timestamp}`
- Example: `outcome_positions_v2_backup_20251107T071726`

### Recovery Documentation

**File**: `/Users/scotty/Projects/Cascadian-app/docs/operations/GATE_B_RECOVERY_GUIDE.md`

Comprehensive recovery guide with 4-step process:
1. Setup views and staging tables
2. Blockchain backfill with 8-16 parallel workers and checkpointing
3. Patch affected tables atomically
4. Verify gates and metrics

---

## 4. Database Operations Files

### Backup-Related Scripts

| Script | Location | Purpose |
|--------|----------|---------|
| `check-backup-tables.ts` | `/scripts/` | Verify backup table status |
| `rollback-swap.ts` | `/scripts/rollback-swap.ts` | Rollback table swaps to backup state |
| `dedup-forensics-and-rebuild.ts` | `/scripts/dedup-forensics-and-rebuild.ts` | Forensics and atomic rebuild |

### Recovery-Related Scripts (45+ files)

ERC1155 Recovery Suite:
- `33-erc1155-recovery.ts`
- `34-erc1155-recovery-optimized.ts`
- `35-erc1155-recovery-fixed.ts`
- `36-erc1155-recovery-final.ts`
- `37-erc1155-recovery-direct.ts`
- `38-erc1155-recovery-simplest.ts`
- `43-erc1155-recovery-improved.ts`
- `44-erc1155-recovery-simple-dedup.ts`

Blockchain Backfill Suite:
- `blockchain-resolution-backfill.ts` - Main resolution backfill
- `fetch-blockchain-payouts-incremental.ts`
- `fetch-blockchain-payouts-optimized.ts`
- `fetch-blockchain-payouts.ts`
- `backfill-payout-vectors-blockchain.ts`

Condition ID Recovery:
- `phase2-batched-condition-id-recovery.ts`
- `TOKEN_DECODING_RECOVERY.ts`
- `union-map-recovery.ts`

### SQL Migrations

**Location**: `/Users/scotty/Projects/Cascadian-app/migrations/`

Safe migration patterns:
- `CREATE TABLE IF NOT EXISTS` - Idempotent creation
- `DROP TABLE IF EXISTS` - Safe deletion
- No direct UPDATE statements on large tables (uses atomic rebuild instead)

---

## 5. Previous Timestamp Data Recovery

### Historical Data Found

**Location**: `/Users/scotty/Projects/Cascadian-app/runtime/`

The checkpoint system preserves timestamp data in two ways:

1. **In-memory checkpoints** (JSON files):
   - `lastProcessedBlock`: Block number with timestamp
   - `startTime`: ISO8601 timestamp of backfill start
   - `errors` array: Block numbers where errors occurred with timestamps

2. **Block timestamp caching**:
   - File: `blockchain-resolution-backfill.ts` (lines 139-141)
   ```typescript
   const block = await provider.getBlock(log.blockNumber);
   const timestamp = block?.timestamp || 0;
   // Stored in resolution.ts_block
   ```

### Checkpoint Data Recovery Procedure

To recover 1.6M timestamps from checkpoints:
1. Read all worker checkpoint files from `runtime/` and `runtime/old-checkpoints/`
2. Extract `lastProcessedBlock` from each checkpoint
3. Query ClickHouse for block timestamps via RPC
4. Cross-reference with event logs in system.query_log

---

## 6. Complete Backup/Recovery File Inventory

### Backup Files
- `/Users/scotty/Projects/Cascadian-app/runtime/blockchain-fetch-checkpoint.backup.json` - Timestamped backup
- Multiple timestamped table backups (naming: `{table}_backup_{timestamp}`)

### Recovery Scripts (Alphabetical)
- `analyze-recovery-situation.ts`
- `backfill-missing-erc1155-by-txhash.ts`
- `backfill-missing-erc1155-parallel.ts`
- `blockchain-resolution-backfill.ts`
- `check-erc1155-for-fast-recovery.ts`
- `check-recovery-potential-remaining-trades.ts`
- `execute-erc1155-recovery.ts`
- `gate-b-full-recovery.ts`
- `phase1-validate-recovery-strategy.ts`
- `phase2-batched-condition-id-recovery.ts`
- `phase3-direct-recovery.ts`
- `rollback-swap.ts`
- `test-tx-receipt-recovery.ts`
- `union-map-recovery.ts`
- `validate-recovery-options.ts`
- `verify-recovery-possible.ts`

### Recovery Documentation
- `/docs/operations/GATE_B_RECOVERY_GUIDE.md` - Complete recovery runbook
- `/docs/archive/investigations/blockchain/CRITICAL_CORRECTION_ERC1155_RECOVERY.md`
- `/docs/archive/investigations/blockchain/ERC1155_RECOVERY_STRATEGY_ANALYSIS.md`
- `/docs/archive/investigations/blockchain/ERC1155_RECOVERY_FINAL_ANALYSIS.md`
- `/docs/systems/data-pipeline/ERC1155_RECOVERY_QUICK_START.md`
- `/docs/archive/investigations/backfill/ORIGINAL_BACKFILL_DATA_RECOVERY.md`
- `/docs/archive/investigations/backfill/BACKFILL_RECOVERY_QUICKSTART.md`
- `/docs/archive/investigations/backfill/START_HERE_BACKFILL_RECOVERY.md`

---

## 7. ClickHouse Configuration

### Connection Details
**File**: `/Users/scotty/Projects/Cascadian-app/.env.local` (lines 82-90)

```
CLICKHOUSE_HOST=https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=8miOkWI~OhsDb
CLICKHOUSE_DATABASE=default

CLICKHOUSE_MCP_URL=https://mcp.clickhouse.cloud/mcp
CLICKHOUSE_KEY_ID=iuOZ772eeaM3TBfaqwrQ
CLICKHOUSE_KEY_SECRET=4b1d0e6Mhes8qECIYVBJR7K1SMWPZPsYSPmArLJre6
```

### Client Usage Pattern
Files using ClickHouse:
- All recovery scripts import: `import { createClient } from "@clickhouse/client"`
- Connection timeout: 300,000ms (5 minutes) for large inserts
- Request timeout: 60,000ms - 120,000ms for large queries

---

## 8. Key Recovery Patterns Discovered

### Pattern 1: Checkpoint-Based Resumption
Used for long-running blockchain operations:
- Load checkpoint on startup
- Process from last known block
- Save checkpoint after each batch
- Survives RPC failures and network issues

### Pattern 2: Atomic Table Swap
Used for safe data updates:
```
CREATE TABLE new_table AS SELECT ...  (populate new data)
RENAME TABLE old_table TO old_table_backup_timestamp
RENAME TABLE new_table TO old_table
```
Guarantees zero downtime and easy rollback.

### Pattern 3: Staged Recovery
Multi-step recovery with validation:
1. Create staging table
2. Populate from blockchain
3. Validate data
4. Swap to production
5. Archive backup

### Pattern 4: Parallel Worker Coordination
- Each worker maintains own checkpoint
- Load balancing via block ranges
- Rate limiting: 40ms per request (25 req/sec per worker)
- Error tracking with block number references

---

## 9. System Query Log for Recovery

**File**: `/Users/scotty/Projects/Cascadian-app/scripts/dedup-forensics-and-rebuild.ts`

ClickHouse provides built-in recovery via system tables:
```sql
SELECT event_time, query_id, written_rows, query
FROM system.query_log
WHERE type = 'QueryFinish'
  AND query_kind = 'Insert'
  AND table = 'trades_dedup_mat'
ORDER BY event_time DESC
LIMIT 20
```

This allows audit trail of all inserts and recovery history.

---

## 10. Key Findings Summary

### Discovered RPC Endpoints
1. **Primary**: `https://polygon-mainnet.g.alchemy.com/v2/30-jbCprwX6TA-BaZacoO` (Alchemy)
2. **Fallback**: `https://polygon-rpc.com` (Public endpoint)
3. **Ethereum**: `https://eth-mainnet.g.alchemy.com/v2/agpW5gfZvLIqqNUZy9fTu`

### Discovered Backup Mechanisms
1. **Timestamped table backups** - Pre-operation backups
2. **Checkpoint files** - Progress and state recovery (160+ files)
3. **System query log** - Transaction audit trail
4. **Atomic swaps** - Safe concurrent updates

### Discovered Recovery Procedures
1. **Blockchain backfill** - 2-4 hours with 8-16 workers and checkpointing
2. **ERC1155 recovery** - Recover missing condition IDs from blockchain
3. **Condition ID recovery** - Multi-phase approach with fallbacks
4. **Table rollback** - Restore from timestamped backups

### Critical Files for Recovery
- `rollback-swap.ts` - Immediate rollback
- `gate-b-full-recovery.ts` - Complete recovery workflow
- `blockchain-resolution-backfill.ts` - Blockchain data recovery
- `dedup-forensics-and-rebuild.ts` - Forensics and atomic rebuild

---

## 11. Recommendations

1. **Archive Strategy**: Consider archiving checkpoint files older than 30 days to `runtime/old-checkpoints/`
2. **Backup Policy**: Implement scheduled backups of dimension tables (wallets_dim, markets_dim, events_dim)
3. **Recovery Testing**: Quarterly test of rollback-swap.ts and full recovery procedures
4. **Checkpoint Cleanup**: Implement cleanup script for orphaned checkpoint files
5. **Documentation**: Keep GATE_B_RECOVERY_GUIDE.md updated with latest patterns
