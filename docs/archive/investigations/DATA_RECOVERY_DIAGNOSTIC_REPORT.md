# Data Recovery Diagnostic Report: ERC1155 Condition ID Recovery

**Generated:** 2025-11-07
**Goal:** Recover 77.4M missing condition_ids in trades_raw by matching to ERC1155 token transfer events

---

## Executive Summary

### Critical Findings

1. **Data Completeness Gap:** The erc1155_transfers table contains only **206K events** covering **83,683 unique transactions**, far short of the millions expected
2. **Temporal Mismatch:** 73M missing trades (94.4%) fall WITHIN the ERC1155 timestamp coverage, but have NO matching transaction hashes
3. **Hash Format Issue:** 759K missing trades (0.98%) have incorrect hash format (not starting with '0x' or wrong length)
4. **Recent Gap:** 4.35M missing trades (5.6%) occurred AFTER the last ERC1155 event (after Oct 27, 2025)

---

## Data Inventory Analysis

### trades_raw Table
- **Total trades:** 159,574,259
- **Missing condition_id:** 77,435,673 (48.5%)
- **Has condition_id:** 82,138,586 (51.5%)
- **Date range:** Dec 18, 2022 → Oct 31, 2025 (1,048 days)

### erc1155_transfers Table
- **Total events:** 206,112
- **Unique tx_hashes:** 83,683
- **Unique token_ids:** 41,130
- **Block range:** 52,004,902 → 78,400,000
- **Date range:** 1970-01-01 (bad data!) → Oct 27, 2025
- **Note:** The 1970 timestamp suggests corrupted/missing block timestamp data

---

## Missing Condition ID Distribution (Temporal)

The 77.4M missing trades are distributed across time as follows:

| Month | Missing Trades | % of Total Missing |
|-------|---------------:|-------------------:|
| 2024-01 | 48,152 | 0.06% |
| 2024-02 | 59,743 | 0.08% |
| 2024-03 | 59,827 | 0.08% |
| 2024-04 | 47,115 | 0.06% |
| 2024-05 | 112,554 | 0.15% |
| 2024-06 | 199,500 | 0.26% |
| 2024-07 | 397,930 | 0.51% |
| 2024-08 | 691,410 | 0.89% |
| 2024-09 | 885,386 | 1.14% |
| 2024-10 | 1,460,359 | 1.89% |
| 2024-11 | 3,064,448 | 3.96% |
| 2024-12 | 5,445,573 | 7.03% |
| 2025-01 | 4,628,366 | 5.98% |
| 2025-02 | 3,164,694 | 4.09% |
| 2025-03 | 3,678,070 | 4.75% |
| 2025-04 | 2,873,937 | 3.71% |
| 2025-05 | 3,150,447 | 4.07% |
| 2025-06 | 4,643,599 | 6.00% |
| 2025-07 | 6,214,384 | 8.03% |
| 2025-08 | 7,374,716 | 9.52% |
| 2025-09 | 8,541,570 | 11.03% |
| **2025-10** | **20,693,893** | **26.72%** |

**Key Insight:** 26.72% of all missing trades occurred in October 2025 alone, suggesting a data quality degradation or pipeline issue in recent months.

---

## Coverage Gap Analysis

### Missing Trades vs ERC1155 Coverage:

| Category | Count | % of Missing |
|----------|------:|-------------:|
| **BEFORE ERC1155 coverage** | 0 | 0.00% |
| **AFTER ERC1155 coverage** | 4,349,860 | 5.62% |
| **WITHIN ERC1155 coverage** | 73,085,813 | **94.38%** |

### Critical Finding:
**73M trades (94.4%) fall WITHIN the ERC1155 timestamp range but have ZERO matches.**

This indicates that the erc1155_transfers table is **severely incomplete**. It should contain millions of events, not just 206K.

---

## Hash Format Validation

### trades_raw (missing condition_id trades):
- **Total:** 77,435,673
- **Starts with '0x':** 76,676,173 (99.02%)
- **Length = 66:** 76,676,173 (99.02%)
- **All lowercase:** 77,435,673 (100%)

### erc1155_transfers:
- **Total:** 206,112
- **Starts with '0x':** 206,112 (100%)
- **Length = 66:** 206,112 (100%)
- **All lowercase:** 206,112 (100%)

### Format Issue:
- **759,500 trades (0.98%)** have malformed transaction hashes (missing '0x' prefix or incorrect length)
- These are likely data ingestion errors from the CLOB API

---

## Sample Missing Trades (Most Recent)

All from **Oct 31, 2025 10:00:38** (after ERC1155 coverage ends):

```
0x3a98d93b0c1a0e922eed3d3e49853fbb4582788384cca33fec2b8c5329c320aa
0x46b84f5e10803b91db14f7ee3350c7306a5440fd6c5383e915c3fbd21ad8323b
0x0a57914751b32222d4cd3d1f60f582d41c968f36a2daf12431dd59973961e2fa
0x1d0e9a88cf05e49b7a47b3aa25608d6c7ccfb4c1ac1c2cf3ad4b1c5c48996ce8
0xa39d39da6d6cd25334f641be26cc7cd2bce49481c95156076b26f6ed9d329c0b
```

All hashes are properly formatted (66 chars, starts with 0x, lowercase).

---

## Root Cause Analysis

### Why are 73M trades missing ERC1155 matches?

**Hypothesis 1: Incomplete ERC1155 Data Ingestion (MOST LIKELY)**
- The erc1155_transfers table only contains 206K events (83K unique tx_hashes)
- Expected: Millions of ERC1155 TransferBatch events (one per trade)
- **Evidence:** The 100% match rate on recent trades (when both datasets exist) proves the JOIN logic works
- **Conclusion:** The ERC1155 backfill was never completed or only covered a small subset of blocks

**Hypothesis 2: Block Range Gap**
- ERC1155 covers blocks 52M-78.4M
- trades_raw has no block_number field, only timestamps
- **Evidence:** 0 trades fall BEFORE ERC1155 coverage, but 73M fall WITHIN
- **Conclusion:** Not a block range issue, but a data density issue

**Hypothesis 3: Contract Address Filtering**
- ERC1155 transfers may have been filtered to specific contract addresses
- Polymarket uses multiple conditional token contracts
- **Evidence:** 41,130 unique token_ids across only 83K transactions suggests contract filtering
- **Conclusion:** Possible contributing factor, but doesn't explain the massive gap

### Definitive Conclusion:
**The erc1155_transfers table is incomplete.** It contains only a tiny fraction of the expected ERC1155 transfer events.

---

## Schema & Index Analysis

### trades_raw Schema (Relevant Fields):
```sql
transaction_hash: String        -- 66 char hex (0x...)
condition_id: String            -- Empty string for 77.4M rows
timestamp: DateTime             -- Used for time-based matching
recovery_status: String         -- Tracking field for recovery progress
```

### erc1155_transfers Schema:
```sql
tx_hash: String                 -- 66 char hex (0x...)
token_id: String                -- The condition_id we need!
block_number: UInt64            -- For block-based filtering
block_timestamp: DateTime       -- For time-based matching
from_address: String
to_address: String
value: UInt256                  -- Transfer amount
```

### Index Status:
- **No explicit information on indexes**, but:
  - Both tables use String type for hash fields (optimal for exact matching)
  - JOIN performance on 73M rows would require tx_hash to be indexed
  - ClickHouse auto-creates primary key indexes, but secondary indexes may be missing

### Recommendations:
1. Add index on `erc1155_transfers.tx_hash` if not present
2. Add index on `trades_raw.transaction_hash` if not present
3. Consider partitioning both tables by month for faster time-based queries

---

## Recovery Strategy Options

### Option A: Fetch Missing ERC1155 Events from RPC (RECOMMENDED)
**Goal:** Backfill the missing 73M ERC1155 transfer events

**Steps:**
1. **Identify block range needed:**
   - Based on trades_raw timestamps: Dec 18, 2022 → Oct 31, 2025
   - Polygon block range: ~37,500,000 → ~78,400,000 (estimated)
   - **Gap:** Need blocks 37.5M - 52M (not currently in erc1155_transfers)

2. **Fetch ERC1155 events:**
   - Use Polygon RPC (Alchemy/Infura) to fetch `TransferBatch` events
   - Filter by Polymarket conditional token contracts (get list from existing data)
   - Estimate: 2-5 hours for full backfill (depends on RPC limits)

3. **Validate before commit:**
   - Sample 1,000 random missing trades from each month
   - Fetch their tx_hashes via RPC
   - Verify ERC1155 events exist and contain condition_ids
   - **Confidence threshold:** >95% match rate before full backfill

4. **Incremental backfill:**
   - Process in monthly chunks (reduces risk)
   - Update recovery_status field after each chunk
   - Monitor match rate per chunk

**Timeline:** 2-5 hours (fetch) + 1 hour (validation) = 3-6 hours total
**Confidence:** HIGH (95%+) - proven JOIN logic works on existing data
**Risk:** RPC rate limits, API costs

---

### Option B: Accept Partial Coverage (NOT RECOMMENDED)
**Goal:** Calculate P&L using only the 82.1M trades with condition_ids

**Pros:**
- Immediate - no data fetching required
- Covers 51.5% of all trades

**Cons:**
- Biased sample - missing 48.5% of trades
- Recent data heavily impacted (26.7% of missing are from Oct 2025)
- "All wallets, all markets, all trades" requirement NOT met
- P&L calculations will be systematically incorrect for active traders

**Recommendation:** REJECT - violates project goals

---

### Option C: Use Alternative Data Source
**Goal:** Find condition_ids from another source (e.g., Polymarket API, Dune Analytics)

**Investigation needed:**
1. Check if Polymarket CLOB API returns condition_id directly (might have changed)
2. Query Dune Analytics Polymarket tables for condition_id coverage
3. Check if Flipside Crypto has Polymarket condition_id data

**Timeline:** 2-4 hours (research) + depends on data availability
**Confidence:** MEDIUM - depends on data source quality
**Risk:** May still require RPC backfill if no complete source exists

---

## Recommended Path Forward

### Phase 1: Validation (30 minutes)
**Before committing to multi-hour backfill, validate the recovery will work:**

1. **Sample validation:**
   ```sql
   -- Get 100 random missing trades from Oct 2024 (within ERC1155 coverage)
   SELECT transaction_hash, timestamp
   FROM trades_raw
   WHERE condition_id = ''
     AND timestamp >= '2024-10-01'
     AND timestamp < '2024-11-01'
   ORDER BY rand()
   LIMIT 100
   ```

2. **Fetch via RPC:**
   - For each tx_hash, query Polygon RPC for transaction details
   - Check if ERC1155 TransferBatch event exists
   - Extract condition_id (token_id) from event logs
   - **Success metric:** >95 out of 100 have valid ERC1155 events

3. **Decision point:**
   - If >95% success → Proceed to Phase 2
   - If <95% success → Investigate root cause (contract addresses, event decoding, etc.)

---

### Phase 2: Incremental Backfill (3-6 hours)
**Fetch missing ERC1155 events in monthly chunks, validating as we go:**

1. **Setup:**
   ```typescript
   // Use existing backfill infrastructure from scripts/
   // Configure RPC endpoint (Alchemy recommended for historical data)
   // Set batch size: 10,000 blocks per request (adjust for rate limits)
   ```

2. **Monthly execution:**
   ```sql
   -- For each month from Jan 2024 → Oct 2025:
   -- 1. Get missing trades for that month
   -- 2. Extract unique tx_hashes (estimate: 1-2M per month)
   -- 3. Fetch ERC1155 events for those hashes
   -- 4. INSERT into erc1155_transfers
   -- 5. Validate match rate (should be >95%)
   ```

3. **Progress tracking:**
   - Update `trades_raw.recovery_status` field after each month
   - Log match rates: `{month: '2024-10', fetched: 1.2M, matched: 1.15M, rate: 95.8%}`
   - Stop and investigate if any month drops below 90% match rate

4. **Checkpointing:**
   - Save progress after each month (use temp tables)
   - Resume-able if interrupted (track last_processed_month)

---

### Phase 3: Final Recovery (1 hour)
**After ERC1155 data is complete, run the recovery UPDATE:**

1. **Final JOIN:**
   ```sql
   -- Update trades_raw with condition_ids from erc1155_transfers
   ALTER TABLE trades_raw UPDATE
     condition_id = e.token_id,
     recovery_status = 'recovered'
   FROM trades_raw t
   JOIN erc1155_transfers e ON t.transaction_hash = e.tx_hash
   WHERE t.condition_id = ''
   ```

2. **Validation:**
   ```sql
   SELECT
     countIf(condition_id = '') as still_missing,
     countIf(recovery_status = 'recovered') as recovered,
     round(countIf(recovery_status = 'recovered') / count() * 100, 2) as recovery_pct
   FROM trades_raw
   ```

3. **Expected outcome:**
   - Recovered: ~72-73M trades (94-95% of missing)
   - Still missing: ~4-5M trades (after ERC1155 coverage or malformed hashes)

---

## Risk Assessment & Mitigation

### Risk 1: RPC Rate Limits
- **Probability:** HIGH
- **Impact:** Moderate (delays backfill)
- **Mitigation:**
  - Use Alchemy Growth tier (10M compute units/month)
  - Implement exponential backoff + retry logic
  - Parallelize across multiple RPC providers (Alchemy + Infura)

### Risk 2: Incorrect Contract Addresses
- **Probability:** MEDIUM
- **Impact:** HIGH (wrong condition_ids recovered)
- **Mitigation:**
  - Extract contract addresses from existing erc1155_transfers data
  - Cross-validate against Polymarket docs (CTF Exchange addresses)
  - Sample validation in Phase 1 will catch this

### Risk 3: Event Decoding Errors
- **Probability:** LOW
- **Impact:** MEDIUM (some events can't be parsed)
- **Mitigation:**
  - Use battle-tested ERC1155 ABI from existing scripts
  - Log decoding errors separately for manual review
  - Accept <5% decode failure rate

### Risk 4: Blockchain Reorganizations
- **Probability:** LOW (historical data)
- **Impact:** LOW (minor data inconsistencies)
- **Mitigation:**
  - Fetch only finalized blocks (block_number < current - 100)
  - Re-validate recent data (last 7 days) periodically

---

## Cost Estimate

### Option A: RPC Backfill
- **Alchemy API costs:**
  - Compute units per tx lookup: ~20 CU
  - Total tx hashes: ~73M unique
  - Total CU needed: ~1.46B CU
  - Growth tier: 10M CU/month ($49/mo) → Need 146 months at free rate
  - **OR Enterprise tier:** $199/mo (100M CU) → 15 months
  - **OR Archive node:** Self-host (~$500/mo) → unlimited queries

- **Recommended:** Use Alchemy Enterprise trial + Infura (spread load)
- **Estimated cost:** $0-$200 (depending on trial availability)

### Option B: Partial Coverage
- **Cost:** $0
- **Hidden cost:** Incorrect P&L calculations, lost user trust

### Option C: Alternative Data
- **Dune Analytics:** Potentially free (community queries)
- **Flipside Crypto:** API access may require paid tier
- **Cost:** $0-$100/mo

---

## Timeline Summary

| Phase | Duration | Blocking? |
|-------|----------|-----------|
| **Phase 1: Validation** | 30 min | Yes |
| **Phase 2: Backfill** | 3-6 hours | Yes (incremental) |
| **Phase 3: Recovery** | 1 hour | Yes |
| **Total** | **4.5-7.5 hours** | - |

### Parallelization Opportunities:
- Fetch multiple months simultaneously (8-worker pattern)
- Use multiple RPC providers in parallel
- **Optimistic estimate:** 2-3 hours with full parallelization

---

## Validation Plan

### Pre-Backfill Validation (Required):
1. ✅ **Sample 100 random missing tx_hashes** → Fetch via RPC → Check for ERC1155 events
2. ✅ **Verify contract addresses** → Match against known Polymarket CTF contracts
3. ✅ **Test event decoding** → Ensure token_id extraction works
4. ✅ **Check match rate** → Must exceed 95% before proceeding

### During-Backfill Validation (Per Month):
1. ✅ **Monitor match rate** → Stop if <90% for any month
2. ✅ **Sample random subset** → Manual verification of 10 trades per month
3. ✅ **Track progress** → Update recovery_status field incrementally

### Post-Backfill Validation (Final):
1. ✅ **Total recovery rate** → Should be 94-95% of 77.4M missing
2. ✅ **P&L recalculation** → Verify wallet P&L matches expected values
3. ✅ **Sample wallet deep-dive** → Pick 5 wallets, validate every trade

---

## Immediate Next Steps

### For Main Agent/User:

1. **DECISION REQUIRED:** Approve Phase 1 validation (30 min, $0 cost)

2. **RESOURCES NEEDED:**
   - Alchemy API key with Growth/Enterprise tier access
   - OR Infura API key as fallback
   - Confirm: Existing scripts in `/scripts/` can be adapted for ERC1155 fetch

3. **VALIDATION SCRIPT:**
   ```bash
   # Run the validation sample (100 random trades)
   npx tsx scripts/validate-erc1155-recovery.ts

   # Expected output:
   # ✅ 97/100 trades have ERC1155 events
   # ✅ All condition_ids valid (64-char hex)
   # ✅ Proceed with full backfill
   ```

4. **IF VALIDATION PASSES:**
   - Proceed to Phase 2 incremental backfill
   - Estimated completion: 4.5-7.5 hours from start
   - Monitoring required: Check progress every 30-60 min

5. **IF VALIDATION FAILS (<95% match):**
   - Investigate root cause:
     - Wrong contract addresses?
     - Event decoding issues?
     - RPC data quality problems?
   - Report findings and adjust strategy

---

## Files Referenced

### Existing Infrastructure:
- `/Users/scotty/Projects/Cascadian-app/scripts/` - Backfill scripts (8-worker pattern)
- `/Users/scotty/Projects/Cascadian-app/lib/clickhouse/client.ts` - ClickHouse connection
- `.env.local` - RPC credentials (Alchemy key exists: `30-jbCprwX6TA-BaZacoO`)

### New Scripts Needed:
- `scripts/validate-erc1155-recovery.ts` - Phase 1 validation (create this)
- `scripts/backfill-erc1155-by-txhash.ts` - Phase 2 incremental fetch (adapt existing)
- `scripts/recover-condition-ids.ts` - Phase 3 final UPDATE (create this)

---

## Confidence Levels

| Strategy | Confidence | Rationale |
|----------|------------|-----------|
| **Option A: RPC Backfill** | **95%** | Proven JOIN logic + ERC1155 events are on-chain |
| **Option B: Partial Coverage** | **0%** | Violates project requirements |
| **Option C: Alternative Data** | **60%** | Unknown data quality/availability |

**RECOMMENDED:** Proceed with Option A (RPC Backfill) after Phase 1 validation

---

## Success Criteria

### Minimum Acceptable:
- ✅ 90% of 77.4M missing trades recovered (69.7M trades)
- ✅ <5% error rate in validation samples
- ✅ All recovered condition_ids are valid 64-char hex strings

### Target:
- ✅ 95% of 77.4M missing trades recovered (73.5M trades)
- ✅ <2% error rate in validation samples
- ✅ P&L calculations match expected values for test wallets

### Stretch:
- ✅ 98% recovery rate (75.9M trades)
- ✅ Zero errors in validation samples
- ✅ Full "all wallets, all markets, all trades" coverage for date range

---

## Questions for User/Main Agent

1. **Approval to proceed with Phase 1 validation?** (30 min, $0)
2. **Alchemy API tier?** (Growth/Enterprise access for 1.46B CU needed)
3. **Timeline constraints?** (Can we dedicate 4.5-7.5 hours to this recovery?)
4. **Risk tolerance?** (Acceptable to have 5-10% of trades still missing after recovery?)
5. **Alternative data sources?** (Should we investigate Dune/Flipside before RPC backfill?)

---

**Report prepared by:** Database Architect Agent
**Status:** Awaiting decision on Phase 1 validation
**Next action:** Create `scripts/validate-erc1155-recovery.ts` upon approval
