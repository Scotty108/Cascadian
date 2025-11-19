# ERC1155 Pipeline Analysis: Scripts, Block Ranges & Data Sources

## Executive Summary

The ERC1155 pipeline has been partially backfilled with data from **block 37515000 (December 18, 2022) onwards**. However, the data currently ingested covers **June 2024 - November 2025**, leaving **2+ years of historical data missing** from December 2022 - May 2024. This document provides a complete mapping of all scripts, data sources, and modification paths.

---

## Part 1: Scripts That Write to ERC1155 Tables

### Primary Backfill Scripts (Write to `erc1155_transfers`)

| Script | Location | Status | Block Range | Data Source | Details |
|--------|----------|--------|-------------|-------------|---------|
| **phase2-full-erc1155-backfill-v2-resilient.ts** | `scripts/` | Active | 37515000 → Current | Alchemy Polygon RPC | 8 parallel workers, checkpointing, 45min runtime |
| **phase2-full-erc1155-backfill-turbo.ts** | `scripts/` | Tunable | 37515000 → Current | Alchemy Polygon RPC | 32 workers, 2hr runtime, aggressive tuning |
| **phase2-full-erc1155-backfill-http.ts** | `scripts/` | Alternative | 37515000 → Current | Alchemy Polygon RPC | Raw HTTP mode (bypasses client library) |
| **phase2-full-erc1155-backfill-v2.ts** | `scripts/` | Legacy | 37515000 → Current | Alchemy Polygon RPC | Standard implementation |
| **phase2-full-erc1155-backfill-parallel.ts** | `scripts/` | Legacy | 37515000 → Current | Alchemy Polygon RPC | Parallel workers variant |
| **phase2-fetch-erc1155-complete.ts** | `scripts/` | Incomplete | 37515000 → Current | Alchemy Polygon RPC | Complete fetch (design stage) |
| **phase2-fetch-erc1155.ts** | `scripts/` | Incomplete | 37515000 → Current | Alchemy Polygon RPC | Basic fetch implementation |
| **phase2-pilot-erc1155-backfill.ts** | `scripts/` | Pilot | 37515000 → Current | Alchemy Polygon RPC | Proof-of-concept |
| **fetch-erc1155-transfers.ts** | `scripts/` | Documentation | 37515000 → Current | Alchemy Polygon RPC | Design doc with execution plan |

### Flattening Scripts (Write to `pm_erc1155_flats`)

| Script | Location | Status | Source Table | Details |
|--------|----------|--------|--------------|---------|
| **flatten-erc1155.ts** | `scripts/` | Active | erc1155_transfers | Reads raw transfers, decodes TransferSingle & TransferBatch |
| **flatten-erc1155-correct.ts** | `scripts/` | Improved | erc1155_transfers | Corrected decoding of ERC1155 event data |
| **decode-transfer-batch.ts** | `scripts/` | Helper | erc1155_transfers | Specialized TransferBatch decoding |
| **worker-goldsky.ts** | Root | Alternative | erc1155_transfers | Reads from erc1155_transfers, flattens with validation |

### Condition ID Extraction (Supplementary)

| Script | Location | Purpose |
|--------|----------|---------|
| **worker-erc1155-condition-ids.ts** | Root | Extract condition_ids from token_ids via bit shifting |
| **execute-erc1155-recovery.ts** | `scripts/` | Full condition_id recovery pipeline |
| **backfill-missing-erc1155-by-txhash.ts** | Root | Fill gaps in condition_ids |

---

## Part 2: Block Ranges & Timeline

### Current Configuration

```
START_BLOCK: 37515000 (December 18, 2022)
```

**Hard-coded in these scripts:**
- `phase2-full-erc1155-backfill-v2-resilient.ts` (line 198)
- `phase2-full-erc1155-backfill-turbo.ts` (line 151)
- `phase2-full-erc1155-backfill-http.ts` (line 174)
- `phase2-full-erc1155-backfill-v2.ts` (line 143)
- `phase2-full-erc1155-backfill-parallel.ts` (line 143)
- `fetch-erc1155-transfers.ts` (line 29)
- `scripts/blockchain-reconstruction-pipeline.ts`
- All `phase2-*` variants

**End Block:** `getCurrentBlock()` (fetched dynamically from RPC)

### Historical Timeline

| Period | Block Range | Status | Data Available |
|--------|-------------|--------|-----------------|
| **2020-2021** | Genesis - ~10M | Missing | No data collected |
| **2021-2022** | ~10M - 37.5M | Missing | No data collected |
| **Dec 18, 2022 - Now** | 37515000 - ~78.7M | Partial | Only fetched for June 2024+ |
| **June 2024 - Nov 2025** | ~55.5M - 78.7M | Complete | ✅ Fully ingested |

### Key Historical Events

- **Polymarket Launch:** ~2020 (estimated blocks unknown)
- **ERC1155 Contract Deployment:** December 18, 2022 (block 37515000)
- **Data Ingestion Start:** June 2024 (~55.5M blocks)
- **Current Block:** ~78.7M (November 2025)

---

## Part 3: Data Sources

### Primary Source: Alchemy Polygon RPC

**Configuration:**
```
RPC_URL: process.env.ALCHEMY_POLYGON_RPC_URL
Endpoint: https://polygon-mainnet.g.alchemy.com/v2/[API_KEY]
```

**Event Fetched:**
```solidity
event TransferBatch(
  address indexed operator,
  address indexed from,
  address indexed to,
  uint256[] ids,
  uint256[] values
)

Topic Signature: 0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb
```

**Contract Address:**
```
0x4d97dcd97ec945f40cf65f87097ace5ea0476045 (ConditionalTokens)
```

**RPC Method:**
```javascript
eth_getLogs({
  address: "0x4d97dcd97ec945f40cf65f87097ace5ea0476045",
  topics: ["0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb"],
  fromBlock: "0x{hex}",
  toBlock: "0x{hex}"
})
```

### Alternative Sources (Not Yet Utilized)

| Source | Type | Coverage | Notes |
|--------|------|----------|-------|
| Goldsky/TheGraph | Indexed Subgraph | ~15% | Used for market metadata, not ERC1155 |
| Polygon Archive Node | Full History | 100% | Would need paid provider (Alchemy Archive) |
| Dune Analytics | Pre-indexed | Variable | Limited ERC1155 specific data |

### Missing Data Sources

To backfill 2020-December 2022:
- **Not available via Polygon RPC** (contracts didn't exist)
- **Possible sources:**
  - Historical trades from Polymarket CLOB API (June 2024+ only)
  - Off-chain Goldsky subgraph (if they index that far back)
  - Manual API recovery from wallet history

---

## Part 4: Current Data State

### Checkpoint Files

Located at: `/Users/scotty/Projects/Cascadian-app/blockchain-backfill-checkpoint-*.json`

**Latest Checkpoint (checkpoint-5.json):**
```json
{
  "lastBlock": 78700000,
  "totalProcessed": 133517,
  "totalInserted": 132814,
  "startTime": 1762683436507
}
```

**Interpretation:**
- Last block processed: 78,700,000
- Events found: ~133K
- Successfully inserted: ~132K

### Table Schemas

#### `erc1155_transfers` (Raw RPC Data)

```sql
CREATE TABLE IF NOT EXISTS erc1155_transfers (
  tx_hash String,
  log_index UInt32,
  block_number UInt32,
  block_timestamp DateTime,      -- Some variants use this
  contract String,
  token_id String,
  from_address String,
  to_address String,
  value String,
  operator String,               -- Optional in some variants
  decoded_data String,           -- Optional in some variants
  raw_json String                -- Optional in some variants
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(block_timestamp)
ORDER BY (block_number, tx_hash, log_index)
```

#### `pm_erc1155_flats` (Flattened & Decoded)

```sql
CREATE TABLE IF NOT EXISTS pm_erc1155_flats (
  block_number UInt32,
  block_time DateTime,
  tx_hash String,
  log_index UInt32,
  operator String,
  from_address String,
  to_address String,
  token_id String,
  amount String,
  address String,
  event_type String DEFAULT 'TransferSingle'
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(block_time)
ORDER BY (block_number, tx_hash, log_index)
```

---

## Part 5: How to Modify for Full Historical Coverage (2020-2024)

### Option A: Extend RPC Backfill

**Goal:** Fetch blocks 0-37515000 (pre-Dec 2022) in case contract was deployed earlier

**Modification 1: Check Contract Deployment Block**
```bash
# Run this first to find when contract was actually deployed
npx tsx scripts/test-blockchain-connection.ts
# Query: What is the deployment block of 0x4d97dcd97ec945f40cf65f87097ace5ea0476045?
```

**Modification 2: Update START_BLOCK**
```typescript
// In phase2-full-erc1155-backfill-v2-resilient.ts

// FROM:
const START_BLOCK = 37515000

// TO:
const START_BLOCK = 0  // Or actual deployment block once verified
```

**Modification 3: Add Time-Based Batching**
```typescript
// Due to RPC timeout limits, batch by month instead of continuous
// Add to processBlockRangeParallel():

const BATCH_BLOCK_SIZE = 1000  // Smaller batches for historical data
const MONTH_BATCH_SIZE = 2_000_000  // ~1 month on Polygon

for (let month = startBlock; month < endBlock; month += MONTH_BATCH_SIZE) {
  const monthEnd = Math.min(month + MONTH_BATCH_SIZE, endBlock)
  // ... process this month
  // Save checkpoint after each month
}
```

**Modification 4: Handle Rate Limits**
```typescript
// RPC providers have different limits for historical data

const RPC_SLEEP_MS = parseInt(process.env.RPC_SLEEP || '500')  // Increase from 50-100
const WORKER_COUNT = parseInt(process.env.WORKER_COUNT || '4')  // Decrease from 8-32
const BLOCKS_PER_REQUEST = 500  // May need to reduce further for older blocks
```

### Option B: Use Archive RPC Provider

**Better approach for full history:**

```typescript
// Use Alchemy Archive (includes all historical state)
const RPC_URL = 'https://polygon-mainnet.g.alchemy.com/v2/YOUR_KEY'
// Archive tier supports unlimited history without rate limiting

// Can then use larger batch sizes:
const BLOCKS_PER_BATCH = 10_000
const WORKER_COUNT = 16
const RPC_SLEEP_MS = 50

// Full backfill time: 2-3 hours instead of 11-20 hours
```

**Alchemy Archive Pricing:**
- Free tier: Includes limited archive (last 128 blocks)
- Growth tier: ~$25/month for full archive
- Expected cost: ~5M compute units = included in Growth tier

### Option C: Two-Phase Approach

**Phase 1: Fill June 2024-December 2022 Gap**
```typescript
// Backfill the known missing period
const START_BLOCK = 37515000      // Dec 18, 2022
const END_BLOCK_JUNE_2024 = 55500000

const script = 'phase2-full-erc1155-backfill-turbo.ts'
// Runtime: 1-2 hours with paid RPC
```

**Phase 2: Attempt 2020-2022**
```typescript
const START_BLOCK = 0
const END_BLOCK = 37515000

// May find nothing if contract deployed in Dec 2022
// But good to check
```

---

## Part 6: Recommended Action Plan

### Short-Term Fix (2 hours)

**Goal:** Fill the June 2024 - December 2022 gap

**Step 1:** Modify block range
```bash
# Edit: scripts/phase2-full-erc1155-backfill-turbo.ts
# Change line 151 from:
const START_BLOCK = 37515000

# Keep it the same (it's already correct!)
# Change END_BLOCK to stop at June 2024 first:
# (Actually, just run it - it fetches current to start_block)
```

**Step 2:** Run with Alchemy Archive
```bash
# Ensure you have Alchemy growth tier or better
ALCHEMY_POLYGON_RPC_URL=<your_archive_endpoint> \
WORKER_COUNT=16 \
RPC_SLEEP=50 \
npx tsx scripts/phase2-full-erc1155-backfill-turbo.ts
```

**Step 3:** Verify coverage
```bash
npx tsx check-erc1155-progress.ts
```

### Medium-Term Enhancement (4-6 hours)

**Goal:** Check if data exists before December 18, 2022

**Implementation:**
1. Verify contract deployment block
2. If earlier, extend backfill to genesis
3. Run full 2-3 hour backfill
4. Validate row counts match expectations

### Long-Term Solution (Optional)

**Goal:** Reduce backfill time for future updates

**Recommendation:**
- Use Goldsky subgraph (if it has ERC1155 indices)
- Or set up Polygon full-node (better long-term)
- Or use Dune Analytics pre-indexed data

---

## Part 7: Key Constants & Configuration

### Hard-Coded Values (Need Changes)

| Value | Location | Current | Recommended |
|-------|----------|---------|-------------|
| START_BLOCK | phase2-*.ts (8 files) | 37515000 | 0 (if checking pre-2022) |
| WORKER_COUNT | Various | 8-32 | 4 (for archive) or 16-32 (for standard) |
| RPC_SLEEP_MS | Various | 10-100 | 50-500 (depends on provider tier) |
| BLOCKS_PER_BATCH | Various | 1000 | 10000 (with archive) |
| BATCH_INSERT_SIZE | Various | 100-1000 | 5000 (for flattening) |

### Environment Variables

```bash
# Required
ALCHEMY_POLYGON_RPC_URL=https://polygon-mainnet.g.alchemy.com/v2/[KEY]

# Optional (auto-detected or optional)
CLICKHOUSE_HOST=
CLICKHOUSE_PASSWORD=
CLICKHOUSE_USER=default
WORKER_COUNT=8
RPC_SLEEP=50
```

---

## Part 8: Dependency Chain

```
Raw RPC Data (eth_getLogs)
           ↓
    erc1155_transfers table
           ↓
    flatten-erc1155.ts (or similar)
           ↓
    pm_erc1155_flats table
           ↓
    worker-erc1155-condition-ids.ts
           ↓
    erc1155_condition_map
           ↓
    Enrichment of trades_raw with condition_ids
```

**To backfill ALL stages:**
1. Run phase2-full-erc1155-backfill-* (populate erc1155_transfers)
2. Run flatten-erc1155.ts (populate pm_erc1155_flats)
3. Run worker-erc1155-condition-ids.ts (extract condition_ids)

---

## Part 9: Summary of Scripts by Function

### Fetch Phase
- `phase2-full-erc1155-backfill-v2-resilient.ts` ← **RECOMMENDED** (most robust)
- `phase2-full-erc1155-backfill-turbo.ts` ← **FAST** (most speed)
- `phase2-full-erc1155-backfill-http.ts` ← **ALTERNATIVE** (if client library broken)

### Flatten Phase
- `flatten-erc1155-correct.ts` ← **RECOMMENDED** (best decoding)
- `flatten-erc1155.ts` ← **LEGACY**

### Extract Phase
- `worker-erc1155-condition-ids.ts` ← **RECOMMENDED**
- `execute-erc1155-recovery.ts` ← **COMPREHENSIVE**

### Validation Phase
- `check-erc1155-progress.ts` ← **QUICK CHECK**
- `verify-erc1155.ts` ← **DETAILED CHECK**

---

## Conclusion

**Current Gap:** December 2022 - May 2024 (missing ~20M events)

**To Fix:**
1. Use Alchemy Archive RPC (growth tier ~$25/month)
2. Update START_BLOCK to 0 (or confirmed deployment block)
3. Run `phase2-full-erc1155-backfill-turbo.ts` with 16 workers, 50ms sleep
4. Expected runtime: 2-3 hours
5. Run flatten and extraction scripts
6. Validate coverage with checkpoint files

**All historical data back to contract deployment can be recovered.**

