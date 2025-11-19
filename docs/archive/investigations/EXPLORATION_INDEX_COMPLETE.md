# Exploration Task Completion Index

## Exploration Scope

Search the CASCADIAN codebase for backup/recovery mechanisms, RPC configuration, checkpoint systems, and recovery instructions.

---

## 1. Backup/Recovery Scripts

### Location: `/Users/scotty/Projects/Cascadian-app/scripts/`

**Core Recovery Scripts**
- `rollback-swap.ts` - Table swap rollback with timestamped backups
- `gate-b-full-recovery.ts` - Complete 4-step recovery workflow
- `blockchain-resolution-backfill.ts` - Blockchain data recovery (2-4 hours)
- `dedup-forensics-and-rebuild.ts` - Forensics and atomic rebuild pattern
- `check-backup-tables.ts` - Verify backup table status

**ERC1155 Recovery Suite (8 variants)**
- `33-erc1155-recovery.ts` through `38-erc1155-recovery-simplest.ts`
- `43-erc1155-recovery-improved.ts`
- `44-erc1155-recovery-simple-dedup.ts`

**Blockchain Backfill Suite**
- `fetch-blockchain-payouts*.ts` (3 variants)
- `backfill-payout-vectors-blockchain.ts`
- `backfill-condition-payouts.ts`

**Condition ID Recovery**
- `phase2-batched-condition-id-recovery.ts`
- `TOKEN_DECODING_RECOVERY.ts`
- `union-map-recovery.ts`

**Validation & Analysis**
- `analyze-recovery-situation.ts`
- `check-erc1155-for-fast-recovery.ts`
- `check-recovery-potential-remaining-trades.ts`
- `execute-erc1155-recovery.ts`
- `phase1-validate-recovery-strategy.ts`
- `phase3-direct-recovery.ts`
- `test-tx-receipt-recovery.ts`
- `validate-recovery-options.ts`
- `verify-recovery-possible.ts`

---

## 2. RPC Configuration

### Found RPC Endpoints

**Location**: `/Users/scotty/Projects/Cascadian-app/.env.local`

Lines: 51, 135-137, 215-216

Endpoints:
- Alchemy Polygon RPC: `https://polygon-mainnet.g.alchemy.com/v2/30-jbCprwX6TA-BaZacoO`
- Alchemy Ethereum RPC: `https://eth-mainnet.g.alchemy.com/v2/agpW5gfZvLIqqNUZy9fTu`
- Fallback Public RPC: `https://polygon-rpc.com`

### RPC Implementation

**File**: `/Users/scotty/Projects/Cascadian-app/scripts/blockchain-resolution-backfill.ts`

Lines: 1-33
- Uses ethers.js `JsonRpcProvider`
- Configurable via `POLYGON_RPC_URL` environment variable
- Falls back to public RPC if not configured
- Error handling for 429 (rate limit) and 502 (gateway) errors
- Rate limiting: 40ms between requests (25 req/sec per worker)
- Batch size: 20,000 blocks per batch

---

## 3. Checkpoint Files

### Checkpoint Locations

**Main Directory**: `/Users/scotty/Projects/Cascadian-app/runtime/`
- 160+ checkpoint files
- Size range: 158 bytes to 25MB per file

**Checkpoint Archive**: `/Users/scotty/Projects/Cascadian-app/runtime/old-checkpoints/`
- 12 archived worker checkpoints

**CLOB Checkpoints**: `/Users/scotty/Projects/Cascadian-app/.clob_checkpoints/`
- 6 wallet-specific checkpoint files

### Checkpoint Types Found

1. Blockchain Fetch (Main + 12 workers)
2. Goldsky (4 variants)
3. Payout Backfill (4 workers)
4. Emergency Recovery (9 workers)
5. Wallet Discovery
6. Resolution Backfill
7. Log Decoding
8. CLOB/Trades Pagination

### Checkpoint Data Structure

**Blockchain Fetch Format**:
```
- lastProcessedBlock (resume point)
- totalEvents, totalTrades (metrics)
- uniqueWallets[] (discovered wallets)
- errors[] (with block numbers and messages)
- startTime (ISO8601)
```

**CLOB Format**:
```
- lastMinTimestampMs (pagination resume)
- pagesProcessed
- totalNewFills
- lastPageSize
- lastPageUniqueIdCount
```

---

## 4. Backup Mechanisms

### Atomic Rebuild Pattern

**Pattern**: CREATE TABLE AS SELECT + RENAME (safe for concurrent updates)

**Implementations**:
1. `dedup-forensics-and-rebuild.ts` (line 96)
2. `enrich-very-safe.ts` (lines 131-137)
3. `execute-enrichment-simple.ts`
4. `compute-metrics-nuclear.ts`
5. `build-current-prices.ts`

### Backup Naming Convention

Format: `{table_name}_backup_{ISO8601_timestamp}`

Example: `outcome_positions_v2_backup_20251107T071726`

### Rollback Mechanism

**File**: `/Users/scotty/Projects/Cascadian-app/scripts/rollback-swap.ts`

Process:
1. Drop broken current tables
2. RENAME timestamped backups to production
3. Verify restoration complete

---

## 5. Checkpoint Management Code

### Load Checkpoint

**File**: `/Users/scotty/Projects/Cascadian-app/scripts/blockchain-resolution-backfill.ts`
Lines: 74-85

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
```

### Save Checkpoint

**File**: `/Users/scotty/Projects/Cascadian-app/scripts/blockchain-resolution-backfill.ts`
Lines: 88-91

```typescript
function saveCheckpoint(checkpoint: Checkpoint) {
  const fs = require('fs');
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2));
}
```

---

## 6. Recovery Documentation

### Primary Recovery Guide

**File**: `/Users/scotty/Projects/Cascadian-app/docs/operations/GATE_B_RECOVERY_GUIDE.md`

Contents:
- Overview of recovery gates
- 4-step recovery architecture
- Configuration instructions
- Worker setup (8-16 parallel)
- Quick start vs step-by-step execution
- Estimated runtime: 30-90 minutes

### Additional Recovery Docs

**Location**: `/Users/scotty/Projects/Cascadian-app/docs/`

- `archive/investigations/blockchain/CRITICAL_CORRECTION_ERC1155_RECOVERY.md`
- `archive/investigations/blockchain/ERC1155_RECOVERY_STRATEGY_ANALYSIS.md`
- `archive/investigations/blockchain/ERC1155_RECOVERY_FINAL_ANALYSIS.md`
- `systems/data-pipeline/ERC1155_RECOVERY_QUICK_START.md`
- `archive/investigations/backfill/ORIGINAL_BACKFILL_DATA_RECOVERY.md`
- `archive/investigations/backfill/BACKFILL_RECOVERY_QUICKSTART.md`
- `archive/investigations/backfill/START_HERE_BACKFILL_RECOVERY.md`

---

## 7. Database Configuration

### ClickHouse Cloud

**File**: `/Users/scotty/Projects/Cascadian-app/.env.local`
Lines: 82-90

Host: `https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443`
Database: `default`
User: `default`

### Client Configuration

**Usage Pattern** (All recovery scripts):
```typescript
import { createClient } from "@clickhouse/client";

const client = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  request_timeout: 300000  // 5 minutes for large inserts
});
```

---

## 8. SQL Migration Patterns

### Location: `/Users/scotty/Projects/Cascadian-app/migrations/`

**Safe Patterns Used**:
- `CREATE TABLE IF NOT EXISTS` - Idempotent creation
- `DROP TABLE IF EXISTS` - Safe deletion
- No UPDATE statements on large tables (use atomic rebuild)

**Files Scanned**:
- 22 ClickHouse migration files
- 4 Supabase migration files
- 4 API staging table migrations

---

## 9. Error Handling & Retry Mechanism

### RPC Error Tracking

**File**: `/Users/scotty/Projects/Cascadian-app/scripts/blockchain-resolution-backfill.ts`

Error types captured in checkpoints:
1. 502 Bad Gateway (Cloudflare)
   - Block: 52062909

2. 429 Rate Limit Exhaustion
   - Block: 52126509
   - Message: "Too many requests, reason: call rate limit exhausted, retry in 10m0s"

### Rate Limiting Strategy

- Per-worker delay: 40ms (25 requests/second)
- Batch size: 20,000 blocks
- Blocks per batch: Configurable via `BLOCKS_PER_BATCH`
- Request timeout: 5,000ms (default), 10,000ms (large requests)

---

## 10. Timestamp Data Recovery

### Sources for 1.6M Timestamps

**Location 1**: `/Users/scotty/Projects/Cascadian-app/runtime/blockchain-fetch-checkpoint*.json`
- `lastProcessedBlock` with block number (has associated timestamp via RPC)
- `errors[].block` - Error block numbers

**Location 2**: Blockchain via RPC
```typescript
const block = await provider.getBlock(blockNumber);
const timestamp = block?.timestamp || 0;
```

**Location 3**: ClickHouse System Table
```sql
SELECT event_time, query_id, written_rows
FROM system.query_log
WHERE table = 'trades_dedup_mat'
ORDER BY event_time DESC
```

---

## Summary Statistics

**Files Found**:
- Backup/recovery scripts: 45+
- Checkpoint files: 160+ (active)
- Checkpoint files (archived): 12
- CLOB checkpoint files: 6
- Recovery documentation: 8 files
- Migration files: 30+

**RPC Endpoints Discovered**: 3
- 2 Alchemy endpoints
- 1 public fallback

**Recovery Time Estimates**:
- Quick rollback: <1 minute
- Condition ID recovery: 30-90 minutes
- Full blockchain backfill: 2-4 hours
- Forensics + rebuild: Variable

**Critical Files for Immediate Recovery**:
1. `/Users/scotty/Projects/Cascadian-app/scripts/rollback-swap.ts`
2. `/Users/scotty/Projects/Cascadian-app/scripts/gate-b-full-recovery.ts`
3. `/Users/scotty/Projects/Cascadian-app/scripts/blockchain-resolution-backfill.ts`
4. `/Users/scotty/Projects/Cascadian-app/docs/operations/GATE_B_RECOVERY_GUIDE.md`

---

## Files Generated

1. **EXPLORATION_FINDINGS_BACKUP_RECOVERY_RPC.md** - Complete detailed findings (11 sections)
2. **BACKUP_RECOVERY_QUICK_REFERENCE.md** - Quick lookup guide
3. **EXPLORATION_INDEX_COMPLETE.md** - This index (10 sections)

All files saved to: `/Users/scotty/Projects/Cascadian-app/`
