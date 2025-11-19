# FULL HISTORICAL BACKFILL - EXECUTION GUIDE

## Executive Summary

**Problem**: Only 5 months of data (Jun-Nov 2024) loaded instead of 35 months (Dec 2022-Nov 2025)
**Impact**: Missing ~2,785 markets for wallet 0x4ce7 (and all other wallets)
**Solution**: Run the existing backfill scripts - they're already configured for the full date range
**Time**: 4-6 hours total (can run overnight)

---

## Three-Phase Backfill Strategy

### Phase 1: ERC1155 Conditional Token Transfers (2-3 hours)

**Script**: `scripts/phase2-full-erc1155-backfill-turbo.ts`
**Status**: ✅ Already configured for Dec 18, 2022 - current (block 37515000)
**Output**: `erc1155_transfers` table

```bash
# Run with 16 parallel workers
WORKER_COUNT=16 \
RPC_SLEEP=50 \
npx tsx scripts/phase2-full-erc1155-backfill-turbo.ts
```

**What it does:**
- Fetches all `TransferBatch` events from ConditionalTokens contract (0x4d97dcd97ec945f40cf65f87097ace5ea0476045)
- Inserts into `erc1155_transfers` table
- Covers all market position transfers
- Expected: ~18M additional events (Dec 2022-May 2024 gap)

**Progress tracking:**
```bash
# Check progress in another terminal
npx tsx scripts/check-erc1155-progress.ts
```

### Phase 2: ERC20 USDC Transfers (2-3 hours)

**Script**: `scripts/step3-streaming-backfill-parallel.ts`
**Status**: ✅ Configured for full date range
**Output**: `erc20_transfers_staging` table

```bash
# Run 8 parallel workers
for i in {0..7}; do
  SHARDS=8 SHARD_ID=$i npx tsx scripts/step3-streaming-backfill-parallel.ts &
done
```

**What it does:**
- Fetches all USDC `Transfer` events
- Captures the cash side of all trades
- Expected: ~270M additional rows

**Decode staging → production:**
```bash
# After fetch completes
npx tsx scripts/phase1-batched-by-month.ts
```

### Phase 3: Flatten & Extract (30-60 min)

**After Phases 1 & 2 complete:**

```bash
# 1. Flatten ERC1155 transfers
npx tsx scripts/flatten-erc1155-correct.ts

# 2. Extract condition IDs
npx tsx worker-erc1155-condition-ids.ts

# 3. Rebuild trades_with_direction
npx tsx scripts/rebuild-fact-trades-from-canonical.ts

# 4. Update canonical views
npx tsx scripts/update-canonical-views.ts
```

---

## Quick Start (Run All)

```bash
#!/bin/bash
# save as: run-full-backfill.sh

set -e  # Exit on error

echo "Starting full historical backfill..."
echo "Estimated time: 4-6 hours"
echo ""

# Phase 1: ERC1155
echo "Phase 1: Fetching ERC1155 transfers..."
WORKER_COUNT=16 RPC_SLEEP=50 npx tsx scripts/phase2-full-erc1155-backfill-turbo.ts

# Phase 2: ERC20 USDC (parallel)
echo "Phase 2: Fetching ERC20 USDC transfers (8 workers)..."
for i in {0..7}; do
  SHARDS=8 SHARD_ID=$i npx tsx scripts/step3-streaming-backfill-parallel.ts &
done
wait  # Wait for all workers to finish

echo "Decoding USDC transfers..."
npx tsx scripts/phase1-batched-by-month.ts

# Phase 3: Process & rebuild
echo "Phase 3: Flattening and extracting..."
npx tsx scripts/flatten-erc1155-correct.ts
npx tsx worker-erc1155-condition-ids.ts
npx tsx scripts/rebuild-fact-trades-from-canonical.ts

echo "✅ Backfill complete!"
echo "Verifying coverage..."
npx tsx trace-wallet-data.ts
```

---

## Validation

### Before Running (Current State)
```bash
npx tsx -e "
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv'; config();

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
});

(async () => {
  const result = await ch.query({
    query: 'SELECT count() as rows FROM erc1155_transfers',
    format: 'JSONEachRow',
  });
  const data = await result.json();
  console.log('Current erc1155_transfers rows:', data[0].rows);
  await ch.close();
})();
"
```

Expected: ~291,113 rows

### After Running (Target State)
Expected: ~18,000,000+ rows (60x increase)

---

## Troubleshooting

### Rate Limits

If you hit Alchemy rate limits:
1. Upgrade to Growth tier ($25/month) for Archive access
2. Increase RPC_SLEEP: `RPC_SLEEP=100` (slower but safer)
3. Reduce workers: `WORKER_COUNT=8`

### Out of Memory

If Node.js runs out of memory:
```bash
NODE_OPTIONS="--max-old-space-size=8192" npx tsx scripts/...
```

### Resume from Checkpoint

The scripts support checkpoint/resume automatically. If interrupted, just re-run the same command.

---

## Cost Estimate

### RPC Calls
- ERC1155: ~40,000 calls (Dec 2022-May 2024 gap)
- ERC20: ~35,000 calls (same period)
- **Total**: ~75,000 RPC calls

### Alchemy Pricing
- Free tier: 300M compute units/month (should cover it)
- Growth tier: Unlimited (recommended for speed)

---

## Expected Results After Completion

For wallet `0x4ce73141dbfce41e65db3723e31059a730f0abad`:

| Metric | Before | After |
|--------|--------|-------|
| Markets found | 31 | 2,816 |
| Trades | ~38 | ~5,600 |
| Coverage | Jun-Nov 2024 | Dec 2022-Nov 2025 |
| Trading P&L | -$588 | TBD |
| Redemption P&L | $0 | TBD |
| Total P&L | -$588 | ~$332,563 (target) |

---

## Files Created by Explore Agents

1. **ERC1155_QUICK_REFERENCE.md** - ERC1155 pipeline overview
2. **ERC1155_PIPELINE_COMPLETE_ANALYSIS.md** - Full technical analysis
3. **TRADES_INGESTION_QUICK_REFERENCE.md** - Trades pipeline overview
4. **TRADES_INGESTION_COMPREHENSIVE_GUIDE.md** - Full technical guide

---

## Next Steps

1. **Run the backfill** (4-6 hours, can run overnight)
2. **Verify coverage** with `trace-wallet-data.ts`
3. **Update P&L views** to use new data
4. **Test wallet 0x4ce7** to confirm $332K P&L

---

**Ready to start?**

```bash
chmod +x run-full-backfill.sh
./run-full-backfill.sh
```

Or run phases individually if you prefer more control.
