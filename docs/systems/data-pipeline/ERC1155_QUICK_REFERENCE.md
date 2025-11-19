# ERC1155 Pipeline - Quick Reference

## What Scripts Write to ERC1155 Tables?

### Write to `erc1155_transfers` (Fetch Phase)
- `scripts/phase2-full-erc1155-backfill-v2-resilient.ts` ✅ **RECOMMENDED**
- `scripts/phase2-full-erc1155-backfill-turbo.ts` ✅ **FAST**
- `scripts/phase2-full-erc1155-backfill-http.ts` (HTTP alternative)
- Other variants: v2.ts, parallel.ts, pilot.ts, fetch-erc1155.ts

### Write to `pm_erc1155_flats` (Flatten Phase)
- `scripts/flatten-erc1155-correct.ts` ✅ **RECOMMENDED**
- `scripts/flatten-erc1155.ts` (legacy)
- `worker-goldsky.ts` (reads erc1155_transfers, outputs pm_erc1155_flats)

### Supplement with Condition IDs
- `worker-erc1155-condition-ids.ts` (extract via bit shifting)
- `scripts/execute-erc1155-recovery.ts` (full recovery)

---

## Block Ranges

### Current Configuration
```
START_BLOCK: 37515000 (December 18, 2022)
END_BLOCK:   getCurrentBlock() (Nov 2025 = ~78.7M)
```

### Data Timeline
| Period | Coverage |
|--------|----------|
| 2020-2021 | Missing (contracts didn't exist) |
| 2021-Dec 2022 | Missing (not fetched) |
| Dec 2022-May 2024 | **GAP - NOT FETCHED** |
| June 2024-Nov 2025 | ✅ Complete |

---

## Data Sources

### Primary
- **Source:** Alchemy Polygon RPC
- **Event:** `TransferBatch` (0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb)
- **Contract:** `0x4d97dcd97ec945f40cf65f87097ace5ea0476045` (ConditionalTokens)
- **Method:** `eth_getLogs` with block ranges

### Alternative (Not Used Yet)
- Goldsky/TheGraph (subgraph)
- Polygon Archive Node (full history)
- Dune Analytics (pre-indexed)

---

## How to Backfill ALL Historical Data (2020-2024)

### Option 1: Quick (Fill 2022-2024 Gap) - 2 Hours
```bash
# Upgrade to Alchemy Archive tier (free growth plan)
# Run the turbo backfill
ALCHEMY_POLYGON_RPC_URL=<archive_endpoint> \
WORKER_COUNT=16 \
RPC_SLEEP=50 \
npx tsx scripts/phase2-full-erc1155-backfill-turbo.ts
```

### Option 2: Complete (2020-2024) - 4-6 Hours
```bash
# 1. Verify contract deployment block
npx tsx scripts/test-blockchain-connection.ts

# 2. Update START_BLOCK to 0 (or deployment block)
# Edit: scripts/phase2-full-erc1155-backfill-turbo.ts
# Line 151: const START_BLOCK = 0

# 3. Run with archive RPC
ALCHEMY_POLYGON_RPC_URL=<archive_endpoint> \
WORKER_COUNT=16 \
RPC_SLEEP=50 \
npx tsx scripts/phase2-full-erc1155-backfill-turbo.ts

# 4. Follow with flatten and extraction
npx tsx scripts/flatten-erc1155-correct.ts
npx tsx worker-erc1155-condition-ids.ts
```

### Option 3: Minimal (Check pre-2022 only) - 1-2 Hours
```bash
# Check if contract deployed before Dec 18, 2022
# If not found, you already have complete history
npx tsx scripts/test-blockchain-connection.ts
```

---

## File Locations (Absolute Paths)

### Backfill Scripts
- `/Users/scotty/Projects/Cascadian-app/scripts/phase2-full-erc1155-backfill-v2-resilient.ts`
- `/Users/scotty/Projects/Cascadian-app/scripts/phase2-full-erc1155-backfill-turbo.ts`
- `/Users/scotty/Projects/Cascadian-app/scripts/phase2-full-erc1155-backfill-http.ts`

### Flattening Scripts
- `/Users/scotty/Projects/Cascadian-app/scripts/flatten-erc1155-correct.ts`
- `/Users/scotty/Projects/Cascadian-app/scripts/flatten-erc1155.ts`

### Condition ID Extraction
- `/Users/scotty/Projects/Cascadian-app/worker-erc1155-condition-ids.ts`
- `/Users/scotty/Projects/Cascadian-app/scripts/execute-erc1155-recovery.ts`

### Checkpoints
- `/Users/scotty/Projects/Cascadian-app/blockchain-backfill-checkpoint-*.json`

---

## Key Configuration Changes Needed

| File | Line | Current | Change To |
|------|------|---------|-----------|
| phase2-full-erc1155-backfill-turbo.ts | 151 | `37515000` | `0` (for pre-2022) |
| phase2-full-erc1155-backfill-v2-resilient.ts | 198 | `37515000` | `0` (for pre-2022) |
| (All phase2-*.ts variants) | Various | `37515000` | `0` (for pre-2022) |

**Also adjust for Archive RPC:**
- `WORKER_COUNT`: 8-32 (16 recommended)
- `RPC_SLEEP_MS`: 50-100 (not 500+)
- `BLOCKS_PER_BATCH`: 1000 (can increase to 10k with archive)

---

## Environment Variables Required

```bash
# Set in .env.local
ALCHEMY_POLYGON_RPC_URL=https://polygon-mainnet.g.alchemy.com/v2/[YOUR_KEY]

# Optional (use defaults if not set)
CLICKHOUSE_HOST=
CLICKHOUSE_PASSWORD=
CLICKHOUSE_USER=default
WORKER_COUNT=8
RPC_SLEEP=50
```

---

## Validation Commands

```bash
# Quick check
npx tsx check-erc1155-progress.ts

# Detailed check
npx tsx verify-erc1155.ts

# Verify connection
npx tsx scripts/test-blockchain-connection.ts

# Check data freshness
npx tsx scripts/data-freshness-check.ts
```

---

## Current Data State

**Checkpoint Status (blockchain-backfill-checkpoint-5.json):**
- Last block: 78,700,000
- Events processed: 133,517
- Events inserted: 132,814

**Gap Identified:**
- Missing: ~18+ million events from Dec 2022-May 2024
- Current data: June 2024-Nov 2025 only
- Recovery path: Run backfill with modified START_BLOCK

---

## Cost & Time Estimates

### Public RPC (Free)
- Time: 11-20 hours
- Reliability: Low (rate limits, timeouts)
- Not recommended

### Alchemy Growth Tier (~$25/month)
- Time: 2-3 hours
- Reliability: High
- Cost: ~5M compute units (included in growth plan)
- **Recommended**

### Alchemy Archive (Custom pricing)
- Time: 2-3 hours
- Reliability: Excellent
- Coverage: Full history since genesis

---

## Summary Table

| Component | Current | Needed | Files |
|-----------|---------|--------|-------|
| Fetch from RPC | Dec 2022+ | Dec 2022+ ✅ | 9 scripts |
| Flatten/Decode | ✅ Complete | ✅ Complete | 2 scripts |
| Extract Condition IDs | ✅ Complete | ✅ Complete | 2 scripts |
| Backfill pre-Dec 2022 | Missing | Optional | N/A |
| Backfill Dec 2022-May 2024 | Missing | Critical | phase2-*.ts |

---

## Next Steps

1. **Immediate:** Review `/Users/scotty/Projects/Cascadian-app/ERC1155_PIPELINE_COMPLETE_ANALYSIS.md`
2. **Short-term:** Set Alchemy API key with archive access
3. **Implementation:** Run phase2-full-erc1155-backfill-turbo.ts with updated blocks
4. **Validation:** Check coverage improved with check-erc1155-progress.ts
5. **Complete pipeline:** Run flatten, then condition_id extraction

---

**For detailed information, see:** `/Users/scotty/Projects/Cascadian-app/ERC1155_PIPELINE_COMPLETE_ANALYSIS.md`
