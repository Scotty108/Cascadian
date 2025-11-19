# Gate B Recovery Guide

## Overview

This guide documents the complete process to raise **Gate B (Condition ID Coverage)** from **39.21%** to **≥85%** using a targeted ERC-1155 blockchain backfill.

## Current State

- **Gate A (TX Coverage)**: 99.43% ✅ PASSED
- **Gate B (CID Coverage)**: 39.21% ❌ FAILED
- **fact_trades_clean**: 63,380,340 rows
- **Missing Resolution CIDs**: 87,605 out of 144,109 total

## Solution Architecture

### Four-Step Recovery Process

```
┌─────────────────────────────────────────────────────────────┐
│  STEP 1: Setup Views & Staging Table                       │
│  • Create canonical CID sets                                │
│  • Identify missing CIDs                                    │
│  • Create repair_pairs_temp staging table                   │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  STEP 2: Blockchain Backfill                                │
│  • Fetch ERC-1155 events from Polygon via Alchemy           │
│  • 8-16 parallel workers with checkpointing                 │
│  • Filter to missing CIDs only                              │
│  • Populate repair_pairs_temp                               │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  STEP 3: Patch fact_trades_clean                            │
│  • Phase 1: Join with vw_trades_canonical                   │
│  • Phase 2: Fallback to trade_direction_assignments         │
│  • Insert missing rows atomically                           │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  STEP 4: Verify Gates                                       │
│  • Recompute Gate A & B percentages                         │
│  • Show top CIDs recovered                                  │
│  • Display contract addresses that produced hits            │
└─────────────────────────────────────────────────────────────┘
```

## Usage

### Quick Start (Recommended)

Run the complete recovery process with a single command:

```bash
npx tsx scripts/gate-b-full-recovery.ts
```

**Estimated Runtime**: 30-90 minutes depending on blockchain RPC performance

### Step-by-Step Execution (Advanced)

If you prefer manual control or need to debug individual steps:

```bash
# Step 1: Setup (30 seconds)
npx tsx scripts/gate-b-step1-setup-views.ts

# Step 2: Blockchain Backfill (30-90 minutes)
npx tsx scripts/gate-b-step2-blockchain-backfill.ts

# Step 3: Patch Fact Table (2-5 minutes)
npx tsx scripts/gate-b-step3-patch-fact-table.ts

# Step 4: Verify Results (30 seconds)
npx tsx scripts/gate-b-step4-verify-gates.ts
```

## Configuration

### Environment Variables

Required in `.env.local`:

```bash
# Blockchain RPC
ALCHEMY_POLYGON_RPC_URL=https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY

# ClickHouse
CLICKHOUSE_HOST=https://your-instance.clickhouse.cloud:8443
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=your_password
CLICKHOUSE_DATABASE=default
```

### Worker Configuration

Control parallelism via environment variable:

```bash
# Use 8 workers (default)
npx tsx scripts/gate-b-step2-blockchain-backfill.ts

# Use 16 workers for faster backfill
WORKER_COUNT=16 npx tsx scripts/gate-b-step2-blockchain-backfill.ts
```

## Technical Details

### SQL Objects Created

**Views** (temporary, can be dropped after completion):
- `_res_cid`: Canonical resolution CIDs
- `_fact_cid`: Existing fact table CIDs
- `_still_missing_cids`: Target CIDs for recovery
- `_candidate_ctf_addresses`: Contract addresses to scan

**Tables**:
- `repair_pairs_temp`: Staging table for (tx_hash, cid) pairs

### ERC-1155 Event Types Fetched

1. **TransferSingle** (`0xc3d58168...`)
2. **TransferBatch** (`0x4a39dc06...`)

### CID Computation Formula

```javascript
// token_id from ERC-1155 log topics[3]
const collectionId = BigInt(token_id) / BigInt(256)
const cid = '0x' + collectionId.toString(16).padStart(64, '0')
```

### Blockchain Block Range

- **Start Block**: 37,515,000 (Polymarket CTF deployment)
- **End Block**: Current block
- **Total Blocks**: ~26,000,000
- **Shard Size**: 100,000 blocks per fetch

## Checkpointing & Recovery

The blockchain backfill step (Step 2) includes automatic checkpointing:

- **Checkpoint File**: `/tmp/gate-b-backfill-checkpoint.json`
- **Save Frequency**: Every 100k block shard
- **Resume Behavior**: Automatically resumes from last completed shard on restart

If Step 2 crashes or is interrupted:
```bash
# Just re-run the same command - it will resume automatically
npx tsx scripts/gate-b-step2-blockchain-backfill.ts
```

## Expected Results

### Gate B Coverage Targets

| Metric | Before | Target | Status |
|--------|--------|--------|--------|
| Gate A (TX Coverage) | 99.43% | ≥99% | ✅ Already passing |
| Gate B (CID Coverage) | 39.21% | ≥85% | 🎯 Target of this recovery |

### Output Metrics

After completion, you'll see:

1. **Total repair pairs found**: Number of (tx_hash, cid) pairs recovered
2. **New Gate B percentage**: Updated CID coverage
3. **Top 10 CIDs by tx count**: Most active missing markets
4. **Contract addresses with hits**: Which CTF contracts provided data
5. **Rows inserted into fact_trades_clean**: New trade records added

## Troubleshooting

### Issue: RPC Rate Limiting

**Symptoms**: Errors like "429 Too Many Requests" or timeouts

**Solution**: Reduce worker count
```bash
WORKER_COUNT=4 npx tsx scripts/gate-b-step2-blockchain-backfill.ts
```

### Issue: ClickHouse Insert Errors

**Symptoms**: "Code: 252. DB::Exception: Too many parts"

**Solution**: Wait 5-10 minutes for ClickHouse to merge parts, then re-run

### Issue: Low Gate B After Completion

**Symptoms**: Gate B still below 85% after full run

**Possible Causes**:
1. Some CTF contracts not in `_candidate_ctf_addresses`
2. Missing CIDs don't have on-chain ERC-1155 events
3. CID computation formula mismatch

**Diagnostic**:
```sql
-- Check how many missing CIDs were NOT found
SELECT count() FROM _still_missing_cids
WHERE cid NOT IN (SELECT DISTINCT cid FROM repair_pairs_temp);

-- Check if repair_pairs actually joined successfully
SELECT count() FROM repair_pairs_temp rp
LEFT JOIN vw_trades_canonical v ON v.transaction_hash = rp.tx_hash
WHERE v.transaction_hash IS NULL;
```

### Issue: Out of Memory

**Symptoms**: "JavaScript heap out of memory"

**Solution**: Increase Node.js memory
```bash
NODE_OPTIONS="--max-old-space-size=8192" npx tsx scripts/gate-b-full-recovery.ts
```

## Cleanup

After successful recovery (Gate B ≥85%), clean up temporary objects:

```sql
DROP VIEW _res_cid;
DROP VIEW _fact_cid;
DROP VIEW _still_missing_cids;
DROP VIEW _candidate_ctf_addresses;
DROP TABLE repair_pairs_temp;
```

Also remove checkpoint file:
```bash
rm /tmp/gate-b-backfill-checkpoint.json
```

## Performance Optimization

### Factors Affecting Runtime

1. **Worker Count**: 16 workers ≈ 30-45 min, 8 workers ≈ 60-90 min
2. **RPC Provider**: Alchemy vs Infura vs others
3. **ClickHouse Instance**: Cloud vs local, CPU/memory
4. **Network Latency**: Geographic distance to RPC and ClickHouse

### Recommended Settings

For fastest recovery:
```bash
WORKER_COUNT=16 \
NODE_OPTIONS="--max-old-space-size=8192" \
npx tsx scripts/gate-b-full-recovery.ts
```

## Validation

After completion, verify data quality:

```sql
-- Check that new CIDs have valid resolutions
SELECT
  f.cid,
  count() as tx_count,
  count(DISTINCT f.wallet_address) as unique_wallets
FROM fact_trades_clean f
JOIN repair_pairs_temp rp ON rp.cid = f.cid AND rp.tx_hash = f.tx_hash
GROUP BY f.cid
ORDER BY tx_count DESC
LIMIT 20;

-- Verify no duplicate (tx_hash, cid) pairs
SELECT tx_hash, cid, count(*) as dupes
FROM fact_trades_clean
GROUP BY tx_hash, cid
HAVING dupes > 1
LIMIT 10;
```

## Related Documentation

- **BLOCKCHAIN_BACKFILL_NECESSITY_REPORT.md**: Why blockchain backfill is needed
- **CONDITION_ID_RECOVERY_ACTION_PLAN.md**: Original recovery strategy
- **DATABASE_ARCHITECTURE_AUDIT_2025.md**: Overall database architecture

## Support

If you encounter issues:

1. Check this guide's troubleshooting section
2. Review checkpoint file: `/tmp/gate-b-backfill-checkpoint.json`
3. Query repair_pairs_temp to see partial results
4. Re-run individual steps for better error visibility

## Success Criteria

✅ Gate B coverage ≥85%
✅ All 4 steps complete without errors
✅ repair_pairs_temp has >100k rows
✅ fact_trades_clean row count increased significantly
✅ Top recovered CIDs have reasonable transaction counts

---

**Version**: 1.0
**Last Updated**: 2025-11-08
**Estimated Total Runtime**: 30-90 minutes
