# TIMESTAMP CRISIS ANALYSIS
**Date:** 2025-11-11
**Status:** CRITICAL SITUATION - RECOVERY ANALYSIS COMPLETE

## Executive Summary

The `tmp_block_timestamps` table was dropped and is now empty (0 rows from 1.6M). An RPC fetch attempt for 52,960 blocks returned 0 timestamps. Analysis shows **95.28% of erc1155_transfers rows (196,377/206,112) have epoch zero timestamps**. Recovery options have been identified.

## Critical Findings

### 1. Table Status
- **tmp_block_timestamps**: EXISTS but EMPTY (0 rows) - was 1.6M rows before drop
- **erc1155_transfers**: 206,112 total rows
  - **196,377 rows (95.28%)** have epoch zero timestamps ❌
  - **9,735 rows (4.72%)** have valid timestamps ✅
  - Field name: `block_timestamp` (Nullable(DateTime))

### 2. Timestamp Distribution
```json
{
  "epoch_zero_count": "196377",
  "has_timestamp_count": "9735",
  "null_count": "0",
  "total_rows": "206112",
  "epoch_zero_pct": 95.28,
  "has_timestamp_pct": 4.72
}
```

### 3. Valid Timestamp Range
Only 9,735 rows have real timestamps covering:
- **Date range**: 2024-01-06 to 2025-10-13
- **Block range**: 52,004,902 to 77,628,470
- **Coverage**: Sparse, only 4.72% of data

### 4. Unique Blocks Needing Timestamps
- Estimated **52,960+ unique block numbers** have epoch zero timestamps
- Block range spans millions of blocks
- This is the complete gap that needs to be filled

### 5. Other Table Analysis
**erc20_transfers_staging**: 387M rows
- Schema: No `block_timestamp` field (only has `created_at`)
- Cannot be used for recovery ❌

**erc20_transfers**: 21M rows
- Has `block_timestamp` field ✅
- **Coverage test (10K sample)**: Only 0.01% overlap
- Insufficient for recovery ❌

## Why RPC Fetch Failed

The 52,960 block fetch that returned 0 timestamps failed likely due to:

1. **Rate limiting**: Alchemy/RPC rate limits exhausted (evidence in checkpoint file error logs)
2. **Request format issue**: Possible malformed batch request
3. **Endpoint issue**: Alchemy/RPC temporary outage
4. **Query parameters**: Incorrect block range or parameter format

Evidence from checkpoint file:
```json
{
  "block": 52126509,
  "error": "Too many requests, reason: call rate limit exhausted, retry in 10m0s"
}
```

## System Table Investigation (Task 1)

### 1a. Mutations Log
No mutations found for `tmp_block_timestamps` - table was likely dropped via `DROP TABLE` command rather than data mutation.

### 1b. Table Still Exists
```json
{
  "name": "tmp_block_timestamps",
  "engine": "SharedMergeTree",
  "total_rows": "0",
  "size": "0.00 B",
  "metadata_modification_time": "1970-01-01 00:00:00"
}
```
Table structure exists but all data is gone.

### 1c. No DROP operations in query_log
Unable to query `system.query_log` (may not be enabled on ClickHouse Cloud free tier or insufficient permissions).

### 1d. No backup tables found
No tables matching `*backup*` or `*_old*` patterns with timestamp data.

## Checkpoint Files Analysis

Located in `/Users/scotty/Projects/Cascadian-app/runtime/`:
- `blockchain-fetch-checkpoint.json` - Main checkpoint (last block: 52,336,658)
- `blockchain-fetch-checkpoint-worker-*.json` - 11 worker checkpoints (various block ranges)
- Worker checkpoints show blocks up to 78.4M

**Key Finding**: Checkpoints track progress but do NOT contain the timestamp data itself.

## Recovery Options

### OPTION A: Restore from ClickHouse Backup ⭐ BEST IF AVAILABLE
**Risk**: LOW | **Effort**: LOW (5-15 min) | **Success Rate**: HIGH

**Prerequisites**:
- ClickHouse Cloud backup exists from before the drop
- Access to ClickHouse Cloud console/API

**Steps**:
1. Check ClickHouse Cloud console for available backups
2. Identify backup timestamp before `tmp_block_timestamps` was dropped
3. Restore `tmp_block_timestamps` table from backup
4. Verify restored row count (should be ~1.6M)
5. Run enrichment to apply timestamps to `erc1155_transfers`

**Pros**:
- Fastest recovery (5-15 minutes)
- Complete data restoration
- No RPC costs

**Cons**:
- Only works if backup exists and is recent
- May require ClickHouse Cloud paid plan for backup access

---

### OPTION B: Refetch with Different RPC Provider 🔄 RECOMMENDED IF NO BACKUP
**Risk**: MEDIUM | **Effort**: HIGH (2-4 hours) | **Success Rate**: MEDIUM-HIGH

**Strategy**: Use multiple RPC providers with proper rate limiting

**Steps**:
1. **Set up multiple RPC endpoints**:
   - Primary: Alchemy (current)
   - Fallback 1: Infura
   - Fallback 2: Polygon public RPC
   - Fallback 3: Ankr or GetBlock

2. **Implement retry logic with backoff**:
   ```typescript
   - Batch size: 100 blocks per request (reduce from 1000)
   - Rate limit: 2 requests/second per endpoint
   - Exponential backoff: 1s → 2s → 4s → 8s
   - Rotate endpoints on rate limit errors
   ```

3. **Fetch in chunks with checkpointing**:
   - Split 52,960 blocks into 530 batches of 100
   - Save checkpoint after every 1,000 blocks
   - Resume from checkpoint on failure

4. **Parallel fetch with 4 workers**:
   - Worker 1: Blocks 52M-58M
   - Worker 2: Blocks 58M-64M
   - Worker 3: Blocks 64M-70M
   - Worker 4: Blocks 70M-78M

**Estimated Time**: 2-4 hours with proper rate limiting

**Pros**:
- Complete data recovery
- Reusable for future timestamp needs
- No dependency on backups

**Cons**:
- Time-consuming (2-4 hours)
- May hit rate limits even with rotation
- RPC endpoint costs (if using paid tiers)

---

### OPTION C: Partial Recovery from erc20_transfers ⚠️ NOT RECOMMENDED
**Risk**: HIGH | **Effort**: LOW | **Success Rate**: VERY LOW (< 1% coverage)

Coverage test showed only 0.01% of needed blocks are available in `erc20_transfers`. This option would leave 99.99% of data without timestamps.

**Recommendation**: Skip this option unless combined with Option B.

---

### OPTION D: Accept Current State and Use Fallback ❌ NOT VIABLE
**Risk**: HIGH | **Effort**: NONE | **Success Rate**: N/A

**Impact**: 95% of erc1155_transfers would remain unusable for time-series queries, trade reconstruction, and analytics.

**Recommendation**: Not acceptable for production system.

---

## Recommended Path Forward

### Immediate Action (Next 30 minutes)
1. ✅ **Check ClickHouse Cloud backup availability**
   - Log into ClickHouse Cloud console
   - Navigate to Backups section
   - Check for backup from last 24-48 hours

   **If backup exists**: Proceed with Option A ⭐
   **If no backup**: Proceed with Option B 🔄

### Option A: Backup Restoration (If Available)
**Time**: 5-15 minutes

```bash
# Via ClickHouse Cloud console:
1. Select backup from before drop
2. Restore tmp_block_timestamps table
3. Verify: SELECT count() FROM tmp_block_timestamps
   Expected: ~1,600,000 rows

# Then run enrichment:
npx tsx scripts/enrich-erc1155-with-timestamps.ts
```

### Option B: RPC Refetch (If No Backup)
**Time**: 2-4 hours

```bash
# 1. Create multi-RPC configuration
cat > .env.local.backup << EOF
ALCHEMY_RPC=https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY
INFURA_RPC=https://polygon-mainnet.infura.io/v3/YOUR_KEY
ANKR_RPC=https://rpc.ankr.com/polygon
POLYGON_RPC=https://polygon-rpc.com
EOF

# 2. Run improved fetch script with:
# - Batch size: 100 blocks
# - Rate limit: 2 req/sec
# - Checkpoint every 1000 blocks
# - 4 parallel workers with endpoint rotation
npx tsx scripts/refetch-block-timestamps-robust.ts

# 3. Monitor progress
tail -f runtime/timestamp-refetch.log
```

## Risk Assessment

| Option | Data Loss Risk | Time Investment | RPC Cost | Success Probability |
|--------|---------------|-----------------|----------|---------------------|
| A: Backup | None | 5-15 min | $0 | 95% (if backup exists) |
| B: Refetch | None | 2-4 hours | $0-20 | 80% (with proper retry) |
| C: Partial | 99.99% | 30 min | $0 | 5% (insufficient) |
| D: Accept | 95.28% | 0 min | $0 | 0% (not viable) |

## Prevention for Future

1. **Enable ClickHouse Cloud backups** (if not already)
2. **Add table protection**: Mark `tmp_block_timestamps` as non-droppable
3. **Export checkpoint data**: Include sample timestamp data in checkpoint files
4. **Set up monitoring**: Alert on table row count drops > 10%
5. **Dual storage**: Keep timestamp mapping in both ClickHouse and a JSON checkpoint file

## Questions to Resolve

1. **ClickHouse Cloud backup status**: Does a recent backup exist?
2. **RPC endpoints**: Which RPC providers do we have API keys for?
3. **Priority**: Can we wait 2-4 hours for refetch, or is immediate recovery critical?
4. **Budget**: Are we OK with paid RPC tier usage if needed?

## Next Steps

**IMMEDIATE** (User decision required):
1. Check ClickHouse Cloud backup availability
2. Report back: "backup exists" or "no backup found"
3. If backup exists → Execute Option A
4. If no backup → Prepare for Option B (gather RPC keys, set up script)

---

**Analysis completed at**: 2025-11-11
**Analyst**: Claude (Database Agent)
**Status**: Awaiting user decision on recovery path
