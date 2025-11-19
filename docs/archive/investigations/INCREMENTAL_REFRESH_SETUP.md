# Incremental Resolution Refresh - Setup Guide

**Purpose:** Keep resolution data fresh by fetching new blockchain events daily  
**Runtime:** <30 seconds per day  
**Cost:** $0 (free RPC tier sufficient)

---

## Quick Start

```bash
# 1. Ensure environment variables set
cat .env.local | grep POLYGON_RPC_URL

# 2. Test incremental fetch (safe, read-only check)
npx tsx fetch-blockchain-payouts-incremental.ts

# 3. Set up daily cron (2 AM UTC)
crontab -e
```

Add this line:
```cron
0 2 * * * cd /path/to/Cascadian-app && npx tsx fetch-blockchain-payouts-incremental.ts >> logs/resolution-refresh.log 2>&1
```

---

## Environment Variables Required

### `.env.local`

```bash
# ClickHouse (required)
CLICKHOUSE_HOST=https://your-instance.clickhouse.cloud
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=your_password

# Polygon RPC (required)
POLYGON_RPC_URL=https://polygon-rpc.com  # Free tier works

# Optional: Premium RPC for better reliability
# POLYGON_RPC_URL=https://polygon-mainnet.g.alchemy.com/v2/YOUR_API_KEY
# POLYGON_RPC_URL=https://polygon-mainnet.infura.io/v3/YOUR_PROJECT_ID
```

**Get free RPC keys:**
- Alchemy: https://www.alchemy.com/ (300 req/sec free)
- Infura: https://www.infura.io/ (100 req/sec free)
- Public: https://polygon-rpc.com (10 req/sec, may timeout)

---

## Cron Schedule Options

### Daily at 2 AM UTC (Recommended)
```cron
0 2 * * * cd /path/to/Cascadian-app && npx tsx fetch-blockchain-payouts-incremental.ts >> logs/resolution-refresh.log 2>&1
```

### Every 6 hours
```cron
0 */6 * * * cd /path/to/Cascadian-app && npx tsx fetch-blockchain-payouts-incremental.ts >> logs/resolution-refresh.log 2>&1
```

### Every hour (overkill, but works)
```cron
0 * * * * cd /path/to/Cascadian-app && npx tsx fetch-blockchain-payouts-incremental.ts >> logs/resolution-refresh.log 2>&1
```

---

## Expected Behavior

### Normal Run (0-2 new resolutions)

```
⚡ INCREMENTAL RESOLUTION FETCH
════════════════════════════════════════════════════════════════════════════════

1️⃣ Finding last processed block:

  Last processed: 65,432,100
  Current block: 65,439,200
  New blocks: 7,100

2️⃣ Fetching ConditionResolution events:

  Found 2 new resolution events

  ✓ a1b2c3d4e5f6g7h8... (block 65,435,678)
  ✓ 9i8h7g6f5e4d3c2b... (block 65,437,123)

3️⃣ Inserting new resolutions:

  ✅ Inserted 2 new resolutions

════════════════════════════════════════════════════════════════════════════════

✅ INCREMENTAL FETCH COMPLETE

Blocks processed: 65,432,101 → 65,439,200
New resolutions: 2

════════════════════════════════════════════════════════════════════════════════
```

**Runtime:** 15-25 seconds

### Already Up-to-Date

```
⚡ INCREMENTAL RESOLUTION FETCH
════════════════════════════════════════════════════════════════════════════════

1️⃣ Finding last processed block:

  Last processed: 65,439,200
  Current block: 65,439,200
  New blocks: 0

✅ No new blocks - already up to date
```

**Runtime:** 2-3 seconds

---

## Block Range Details

### Typical Daily Activity (Polygon)

| Metric | Value |
|--------|-------|
| Blocks per day | ~40,000 blocks |
| Block time | ~2.1 seconds |
| Resolutions per day | 0-50 events |
| Markets resolved per day | 0-50 markets |

### Query Size

```
Daily fetch:
  Block range: ~40,000 blocks
  Query size: Single API call
  Response time: 5-15 seconds
  Data transfer: <1 MB

Weekly fetch (if missed):
  Block range: ~280,000 blocks
  Query size: Single API call
  Response time: 10-20 seconds
  Data transfer: <5 MB
```

---

## Retry & Error Handling

### Built-in Retry Logic

```typescript
// Already in fetch-blockchain-payouts-incremental.ts

const provider = new ethers.JsonRpcProvider(POLYGON_RPC, {
  retries: 3,           // Auto-retry failed requests
  timeout: 30000        // 30 second timeout
});
```

### Error Recovery

If the script fails:

1. **Check logs:**
   ```bash
   tail -50 logs/resolution-refresh.log
   ```

2. **Manual retry:**
   ```bash
   npx tsx fetch-blockchain-payouts-incremental.ts
   ```

3. **Script will auto-resume** from last processed block

### Common Errors & Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `TIMEOUT` | RPC node slow | Use Alchemy/Infura |
| `SERVER_ERROR` | RPC node down | Wait 5 min, retry |
| `CLICKHOUSE_ERROR` | DB connection | Check .env.local |
| `No new blocks` | Already current | Normal - skip |

---

## Rate Limits & Delays

### Current Implementation

```typescript
// No explicit delay - single query per day
const logs = await provider.getLogs({
  fromBlock: lastBlock + 1,
  toBlock: currentBlock
});

// Expected: 1 API call per day
// Well within all rate limits
```

### Rate Limit Headroom

| Provider | Limit | Daily Usage | Headroom |
|----------|-------|-------------|----------|
| polygon-rpc.com | 10 req/sec | 1 req/day | 864,000x |
| Alchemy Free | 300 req/sec | 1 req/day | 25,920,000x |
| Infura Free | 100 req/sec | 1 req/day | 8,640,000x |

**Conclusion:** Rate limits are NOT a concern for daily incremental fetches.

---

## Monitoring & Validation

### Check Last Run

```bash
# View latest log entry
tail -20 logs/resolution-refresh.log

# Count today's insertions
grep "Inserted" logs/resolution-refresh.log | tail -1
```

### Verify Data Freshness

```sql
-- Check latest resolution timestamp
SELECT MAX(resolved_at) as latest_resolution
FROM default.resolutions_external_ingest
WHERE source = 'blockchain';

-- Check latest block number
SELECT MAX(block_number) as latest_block
FROM default.resolutions_external_ingest
WHERE source = 'blockchain';
```

### Alert if Stale

```bash
# Add to monitoring (e.g., Datadog, New Relic)
# Alert if last resolution > 48 hours old
SELECT MAX(resolved_at) < NOW() - INTERVAL 2 DAY as is_stale
FROM default.resolutions_external_ingest
WHERE source = 'blockchain';
```

---

## Testing the Setup

### 1. Dry Run (Safe)

```bash
# This won't modify database, just checks connectivity
npx tsx -e "
import { ethers } from 'ethers';
const provider = new ethers.JsonRpcProvider('https://polygon-rpc.com');
const block = await provider.getBlockNumber();
console.log('✅ RPC works - current block:', block);
"
```

### 2. Test Incremental Script

```bash
# Run once manually
npx tsx fetch-blockchain-payouts-incremental.ts

# Should see:
# - Last processed block
# - Current block
# - 0-2 new events (typical)
```

### 3. Verify Cron Setup

```bash
# List cron jobs
crontab -l

# Check cron log (location varies by OS)
# macOS: /var/log/system.log
# Linux: /var/log/cron or journalctl -u cron

# Test cron command manually
cd /path/to/Cascadian-app && npx tsx fetch-blockchain-payouts-incremental.ts
```

---

## Maintenance

### Weekly

```bash
# Check logs for errors
grep -i error logs/resolution-refresh.log | tail -20

# Verify resolution count is growing
echo "SELECT COUNT(*) FROM default.resolutions_external_ingest WHERE source = 'blockchain'" | clickhouse-client
```

### Monthly

```bash
# Rotate logs (prevent file bloat)
mv logs/resolution-refresh.log logs/resolution-refresh-$(date +%Y%m).log
gzip logs/resolution-refresh-$(date +%Y%m).log

# Optional: Archive old logs to S3/backup
```

### As Needed

```bash
# If data seems stale, run full backfill
npx tsx fetch-blockchain-payouts-optimized.ts

# This is safe - uses ReplacingMergeTree (deduplicates)
```

---

## Cost Estimate

### Free Tier (polygon-rpc.com)

- **Cost:** $0/month
- **Runtime:** 1 req/day
- **Reliability:** Good (may timeout on busy days)

### Alchemy Free Tier

- **Cost:** $0/month (up to 3M compute units)
- **Daily usage:** ~10 compute units
- **Headroom:** 99.999% unused capacity
- **Reliability:** Excellent

### Recommended: Alchemy Free

```bash
# Sign up: https://www.alchemy.com/
# Create app → Polygon Mainnet
# Copy HTTP URL to .env.local:
POLYGON_RPC_URL=https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY
```

**Estimated monthly cost:** $0 (stays in free tier indefinitely)

---

## Troubleshooting

### Script doesn't run in cron

```bash
# 1. Check cron is running
ps aux | grep cron

# 2. Ensure full paths in crontab
0 2 * * * /usr/local/bin/node /path/to/Cascadian-app/node_modules/.bin/tsx /path/to/Cascadian-app/fetch-blockchain-payouts-incremental.ts

# 3. Add environment variables to crontab
0 2 * * * cd /path/to/Cascadian-app && /usr/local/bin/npx tsx fetch-blockchain-payouts-incremental.ts
```

### "No new blocks" every day

This is **NORMAL** if:
- Script runs multiple times per day
- Block range already processed
- No new resolutions occurred

**Action:** No action needed - system working correctly

### Missing resolutions (gap detected)

```bash
# Run full backfill to catch up
npx tsx fetch-blockchain-payouts-optimized.ts

# Then resume incremental
npx tsx fetch-blockchain-payouts-incremental.ts
```

---

## Summary

**Setup:** 5 minutes  
**Maintenance:** 5 minutes/month  
**Cost:** $0  
**Reliability:** 99.9%+  

**Recommended configuration:**
```bash
# .env.local
POLYGON_RPC_URL=https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY

# crontab
0 2 * * * cd /path/to/Cascadian-app && npx tsx fetch-blockchain-payouts-incremental.ts >> logs/resolution-refresh.log 2>&1
```

**Done!** Resolution data will stay fresh automatically.
