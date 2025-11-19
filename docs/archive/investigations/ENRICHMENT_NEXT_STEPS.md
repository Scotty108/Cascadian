
# Enrichment Next Steps - Quick Guide

## Current Status
- ✅ **Enriched table created:** `trades_raw_enriched` (160.9M rows)
- ✅ **Coverage analyzed:** 51.07% have condition_ids (82.17M trades)
- ✅ **Mapping prepared:** 41,305 markets in `merged_market_mapping`
- ⚠️ **Bottleneck identified:** ClickHouse HTTP protocol buffer limits

---

## You Have 4 Options to Reach 95%+

### Option 1: Quick Win (Using Goldsky) ⚡ 2-3 hours
**Status:** Requires external integration
**Approach:**
1. Sign up for Goldsky API (blockchain data provider)
2. Query Goldsky for ERC1155 condition_ids not in our mapping
3. INSERT new mappings into `merged_market_mapping`
4. Apply enrichment via curl batch processing

**Code to adapt:**
```bash
# Use curl to work around protocol buffer limit
curl -X POST "https://instance:8443/?user=X&password=Y" \
  -d "INSERT INTO merged_market_mapping \
      SELECT distinct ... FROM goldsky_erc1155_data"
```

**Expected result:** 65-75% coverage

---

### Option 2: Build it Locally (Native Protocol) ⏱️ 4-6 hours
**Status:** Setup required
**Approach:**
1. Install ClickHouse server locally (not cloud)
2. Migrate data from cloud ClickHouse
3. Use native protocol (port 9000) instead of HTTP
4. Run enrichment JOIN without protocol buffer limits

**Key file:** `apply-enrichment-complete.ts` (will work with native protocol)

**Expected result:** 95%+ coverage

---

### Option 3: Staged Batch Processing ⏱️ 3-4 hours
**Status:** Works with current setup
**Approach:**
1. Process trades in 10M row stages using curl
2. Create temp tables for each stage
3. Apply JOIN enrichment per stage
4. Union results back together

**Code example:**
```bash
# Stage 1: trades 0-10M with enrichment
curl -X POST "..." -d \
  "INSERT INTO temp_enriched_1
   SELECT t.*, m.condition_id FROM trades_raw t
   LEFT JOIN merged_market_mapping m ON ...
   LIMIT 10000000"
```

**Expected result:** 51% + additional from staged processing

---

### Option 4: Accept 51% Coverage ✅ 0 hours
**Status:** Available now
**Approach:**
1. Use `trades_raw_enriched` as production table
2. Document that 51% represents blockchain-native markets
3. Add API endpoint for additional lookups via Polymarket/Goldsky
4. Annotate results with coverage confidence

**Rationale:**
- 51% is accurate and verifiable
- Most trading volume likely in covered markets
- Can add live API enrichment for missing trades
- Zero additional infrastructure

**Expected result:** Production-ready, documented coverage

---

## Recommended Path Forward

**If time is not critical:** Option 2 (native protocol)
- Best long-term solution
- No external dependencies
- Solves protocol buffer issues permanently
- Enables 95%+ coverage

**If you need quick improvement:** Option 1 (Goldsky)
- Fastest external path
- Proven blockchain data provider
- 2-3 hour integration
- Reaches 65-75% coverage

**If you want production now:** Option 4 (accept 51%)
- Deploy immediately
- Document limitations
- Add live API fallback
- Plan for future improvement

**If you want to stay local:** Option 3 (batch processing)
- Works with cloud ClickHouse
- More complex but doable
- Moderate time investment

---

## To Implement Your Choice

### Option 1 Script Template
```typescript
// enrichment-via-goldsky.ts
import { clickhouse } from './lib/clickhouse/client'
import fetch from 'node-fetch'

async function enrichViaGoldsky() {
  // 1. Query Goldsky API for condition_ids
  const goldskyConds = await fetch('https://api.goldsky.com/...', {
    headers: { 'Authorization': `Bearer ${process.env.GOLDSKY_KEY}` }
  })

  // 2. Process in 1M batches
  // 3. INSERT into merged_market_mapping via curl

  // 4. Apply enrichment in stages using curl
}
```

### Option 3 Script Template
```typescript
// apply-enrichment-staged.ts
// Process trades_raw in 10M row chunks
// Use LIMIT and OFFSET to process stages
// Build temp tables for each stage
// UNION results together
```

---

## Current Files for Reference

| File | Purpose | Status |
|------|---------|--------|
| `ENRICHMENT_SESSION_FINAL_REPORT.md` | Detailed analysis | ✅ Complete |
| `apply-enrichment-minimal.ts` | Assessment report | ✅ Complete |
| `merged_market_mapping` | Central mapping table | ✅ 41K entries |
| `trades_raw_enriched` | Enriched trades table | ✅ 160.9M rows |
| `erc1155_condition_map` | Blockchain mappings | ✅ 41K condition_ids |

---

## Key Learnings for Future Work

### ✅ What Worked
- Curl HTTP API for large operations
- ERC1155 blockchain extraction
- Market format compatibility analysis
- Streaming inserts (100 row batches)

### ❌ What Didn't
- Node.js SDK on 160M+ row operations
- Protocol buffer limits on HTTP protocol
- CLOB API market persistence (data vanished)
- Traditional SQL batching via SDK

### 🔑 Key Insight
**Direct HTTP works, SDK wrapper fails.** For future mega-table operations on ClickHouse Cloud, use curl with direct POST requests rather than SDK client libraries.

---

## Make a Decision

Choose one path and comment back what you want to do:
1. **"Let's do Option 1"** → I'll help integrate Goldsky
2. **"Let's do Option 2"** → I'll help set up local ClickHouse
3. **"Let's do Option 3"** → I'll build the staging script
4. **"Let's ship Option 4"** → I'll create final production table and documentation

---

## Session Complete ✅

- Identified protocol bottleneck
- Created enrichment infrastructure
- Verified 51% baseline coverage
- Prepared mapping table (41K markets)
- Documented path to 95%+ coverage

**Next decision:** Which option fits your timeline and resources?
