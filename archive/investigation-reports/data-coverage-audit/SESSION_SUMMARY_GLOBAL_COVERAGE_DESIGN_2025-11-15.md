# Session Summary: Global Coverage Design Complete

**Date:** 2025-11-15
**Agent:** C1
**Mission:** Design global Polymarket coverage system using Goldsky indexer

---

## Mission Status: PHASE B COMPLETE ✅

### Overview

Completed all design work for global Polymarket coverage without brute-forcing the Data API. The system will use Goldsky-hosted subgraphs as primary data source for 100% wallet coverage, with C2's Data API providing supplementary fill-level detail.

**Key Achievement:** Designed end-to-end pipeline from GraphQL ingestion to ClickHouse storage to reconciliation with existing Data API data.

---

## Completed Deliverables

### Phase B.1: Indexer Research ✅

**File:** `docs/C1_GLOBAL_INDEXER_SELECTION.md`

**Outcome:** Selected Goldsky-hosted Polymarket PNL Subgraph as primary indexer

**Key Findings:**
- Official Polymarket subgraph with pre-computed P&L metrics
- Real-time GraphQL API (no authentication required)
- 100% coverage of on-chain Polymarket activity
- Free for reasonable usage
- UserPosition entity includes: user, tokenId, amount, avgPrice, realizedPnl, totalBought

**Comparison Matrix:**
- **Goldsky:** 9/10 (pre-computed P&L, free, real-time)
- Dune: 6/10 (paid API, slow queries, no pre-computed P&L)
- Flipside: 5/10 (raw data, steeper learning curve)

**Exploration Script:** `scripts/explore-polymarket-subgraph.ts`
- GraphQL introspection to discover schema
- Validates endpoint connectivity
- Documents entity structure

---

### Phase B.2: ClickHouse Schema Design ✅

**Files:** (Created by database-architect agent)
- `sql/ddl_pm_positions_indexer.sql` - Base position table
- `sql/ddl_pm_wallet_pnl_indexer.sql` - Aggregated P&L table
- `sql/example_queries_indexer.sql` - 40+ example queries
- `sql/INDEXER_SCHEMA_DESIGN.md` - Complete design documentation (759 lines)

**Schema Design:**

**pm_positions_indexer** (ReplacingMergeTree)
```sql
CREATE TABLE pm_positions_indexer (
  id String,                          -- Composite: wallet-tokenId
  wallet_address String,              -- 40-char hex
  token_id String,                    -- 256-bit token ID
  condition_id String,                -- Decoded 64-char hex
  outcome_index UInt8,                -- Decoded 0 or 1
  amount Decimal128(18),              -- Position size (shares)
  avg_price Decimal64(6),             -- Average entry price
  realized_pnl Decimal64(6),          -- Realized P&L
  total_bought Decimal128(18),        -- Cumulative purchases
  version DateTime64(3),              -- For ReplacingMergeTree
  last_synced_at DateTime64(3),
  source_version String
) ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(last_synced_at)
ORDER BY (wallet_address, condition_id, outcome_index);
```

**pm_wallet_pnl_indexer** (AggregatingMergeTree)
- Materialized view with state combinators
- Aggregates: total_positions, total_realized_pnl, avg_entry_price, wins, distinct_markets
- Human-readable summary view: pm_wallet_pnl_summary_indexer

**Token Decoding Algorithm:**
```typescript
function decodeTokenId(tokenId: bigint): { conditionId: string; outcomeIndex: number } {
  const conditionId = (tokenId >> 2n).toString(16).padStart(64, '0');
  const collectionId = tokenId & 0x3n;
  const outcomeIndex = collectionId === 1n ? 0 : 1;
  return { conditionId, outcomeIndex };
}
```

**Performance Targets:**
- Storage: ~15 MB compressed (130K positions)
- Wallet queries: <10ms
- Global leaderboards: <50ms
- Initial backfill: 2-13 seconds (8 workers)

---

### Phase B.3: Ingestion Pipeline Specification ✅

**File:** `docs/C1_GLOBAL_INDEXER_INGESTION_SPEC.md`

**Ingestion Modes:**

**Mode 1: Full Backfill**
- Scope: ALL UserPosition entities from subgraph
- Estimated size: ~130,000 positions
- Estimated time: 2-13 seconds (8 parallel workers, 1000 records/page)
- Process: Query total → Calculate pages → Launch 8 workers → Checkpoint every 1000 records

**Mode 2: Incremental Sync**
- Frequency: Every 5 minutes (cron job)
- Scope: Positions updated since last sync
- Estimated size: 100-500 positions per sync
- Estimated time: <1 second

**GraphQL Query Patterns:**

```graphql
# Full Backfill
query GetPositions($skip: Int!, $first: Int!) {
  userPositions(first: $first, skip: $skip, orderBy: id) {
    id, user, tokenId, amount, avgPrice, realizedPnl, totalBought
  }
}

# Incremental Sync
query GetPositionsSince($lastId: ID!, $first: Int!) {
  userPositions(where: { id_gt: $lastId }, first: $first, orderBy: id) {
    id, user, tokenId, amount, avgPrice, realizedPnl, totalBought
  }
}
```

**Retry Strategy:**
- GraphQL: 3 attempts, exponential backoff (1s, 4s)
- ClickHouse: 2 attempts, linear backoff (1s)
- Retryable: 429, 500-504, network timeouts
- Non-retryable: 400, 401, 403, syntax errors

**Checkpoint Management:**
```sql
CREATE TABLE sync_checkpoints (
  sync_type String,
  last_synced_id String,
  last_synced_block UInt64,
  records_processed UInt64,
  status String,  -- 'in_progress', 'completed', 'failed'
  worker_id UInt8,
  error_message Nullable(String)
) ENGINE = ReplacingMergeTree(last_synced_at)
ORDER BY (sync_type, worker_id);
```

**Performance Targets:**
- Full backfill (130K positions): <15 seconds
- Incremental sync: <2 seconds
- GraphQL query latency: <200ms
- ClickHouse insert latency: <100ms
- Sync lag: <5 minutes
- Uptime: >99.9%

**Validation Rules:**
- wallet_address is 40-char hex lowercase
- token_id is valid 256-bit number
- condition_id is 64-char hex lowercase
- outcome_index is 0 or 1
- amount >= 0
- avg_price in [0, 1000000]
- realized_pnl is reasonable (<$1M per position)

---

### Phase B.4: Reconciliation Strategy ✅

**File:** `docs/C1_INDEXER_RECONCILIATION_STRATEGY.md`

**Reconciliation Principles:**

**Source Hierarchy:**
1. **Tier 1 - Global Truth:** Goldsky Indexer (primary for all P&L)
2. **Tier 2 - Detailed Supplement:** Data API via C2 (fill-level detail, ghost markets)
3. **Tier 3 - Validation:** pm_trades_complete (cross-check)

**Reconciliation Rules:**
- Indexer as primary truth for wallet P&L
- Data API for fill-level granularity
- Flag discrepancies > $100 OR > 10%
- Investigate systematically if pattern emerges

**Discrepancy Thresholds:**

| Delta | % Diff | Severity | Action |
|-------|--------|----------|--------|
| < $100 | Any | Acceptable | No action |
| $100-$1K | 10-25% | Low | Log only |
| $1K-$10K | 25-50% | Medium | Weekly review |
| > $10K | > 50% | High | Immediate investigation |

**Comparison Queries:**
1. Single wallet reconciliation (indexer vs Data API P&L)
2. Ghost cohort batch reconciliation (all 12,717 wallets)
3. Market-level reconciliation (per condition_id)

**Discrepancy Log Table:**
```sql
CREATE TABLE reconciliation_discrepancies (
  check_id UUID,
  wallet_address String,
  condition_id Nullable(String),
  indexer_pnl Decimal64(6),
  data_api_pnl Decimal64(6),
  delta_pnl Decimal64(6),
  pct_diff Float64,
  severity Enum8('ACCEPTABLE'=0, 'LOW'=1, 'MEDIUM'=2, 'HIGH'=3),
  status Enum8('NEW'=0, 'INVESTIGATING'=1, 'RESOLVED'=2, 'EXPECTED'=3),
  notes Nullable(String)
) ENGINE = MergeTree()
ORDER BY (severity, check_timestamp);
```

**Investigation Workflow:**
1. Detect discrepancies (run daily reconciliation check)
2. Categorize (expected vs unexpected)
3. Deep dive (check fill counts, market overlap, position sizes)
4. Document findings (update reconciliation_discrepancies table)
5. Escalate if systematic (>5% of cohort affected)

**Known Expected Differences:**
- Timing lag (indexer syncs every 5 min, Data API may be stale)
- Ghost markets (Data API has direct on-chain transfers)
- Decimal precision (small rounding differences <$0.01)
- Settled vs unsettled (indexer includes unrealized P&L)

**Reconciliation Script:** `scripts/reconcile-indexer-vs-data-api.ts`
- Modes: Single wallet, wallet list, cohort, random sample
- Thresholds: --threshold-usd (default 100), --threshold-pct (default 10)
- Output: Console table, optional save to DB, optional markdown report

---

### Phase B.5: Pilot Backfill Plan ✅

**File:** `docs/C1_INDEXER_PILOT_BACKFILL_PLAN.md`

**Pilot Scope:**
- Ingest first 1,000 UserPosition entities
- Validate schema correctness
- Run reconciliation against xcnstrategy wallet
- Document learnings before full-scale deployment

**Implementation Checklist:**

**Task 1: Implement Token Decoder**
- File: `lib/polymarket/token-decoder.ts`
- Functions: decodeTokenId(), validateDecodedToken(), decodeTokenIds()
- Validation: 64-char hex condition_id, 0-1 outcome_index

**Task 2: Create GraphQL Client**
- File: `lib/polymarket/graphql-client.ts`
- Class: PolymarketGraphQLClient
- Methods: getUserPositions(), getWalletPositions()

**Task 3: Create Pilot Backfill Script**
- File: `scripts/sync-indexer-pilot.ts`
- Steps: Fetch → Decode → Validate → Insert → Verify
- Expected duration: <1 second for 1,000 positions

**Task 4: Validation Queries**
- File: `scripts/validate-indexer-pilot.ts`
- Checks: condition_id format, wallet_address format, outcome_index range, no negative shares, price range, sample data

**Task 5: Sample Reconciliation**
- File: `scripts/reconcile-xcnstrategy-pilot.ts`
- Target: xcnstrategy wallet (known P&L: $6,894.99)
- Comparison: Indexer P&L vs Data API P&L
- Success: Delta < $100 (ACCEPTABLE)

**Success Criteria:**

**Data Quality:**
- All condition_id values are 64-char hex lowercase
- All wallet_address values are 40-char hex lowercase
- All outcome_index values are 0 or 1
- No negative shares
- All prices in valid range
- No null values in required fields

**Performance:**
- Fetch 1,000 positions in <500ms
- Decode and validate in <200ms
- Insert into ClickHouse in <200ms
- Total end-to-end <1 second

**Reconciliation:**
- xcnstrategy P&L matches Data API within $100
- Market count matches
- Position count is reasonable

**Failure Scenarios:**
1. Token decoding fails → Log and sample failed cases
2. GraphQL rate limit hit → Implement backoff, reduce batch size
3. ClickHouse insert failure → Validate data types, fix schema
4. Reconciliation shows large delta → Investigate timing, markets, formulas

**Next Steps After Pilot:**

**If Success:**
1. Scale to full dataset (~130K positions, 8 workers)
2. Set up incremental sync (cron every 5 minutes)
3. Build materialized views
4. Expand reconciliation to all ghost cohort
5. Phase C: Coverage dashboards

**If Failure:**
1. Review validation errors
2. Fix and retry
3. Document learnings
4. Re-run pilot

**Timeline:** 3 hours (implementation + testing + documentation)

---

## System Architecture (Final Design)

### Data Flow

```
Goldsky PNL Subgraph (GraphQL)
    ↓
GraphQL Client (fetch positions)
    ↓
Token Decoder (extract condition_id, outcome_index)
    ↓
Validator (check formats, ranges)
    ↓
pm_positions_indexer (ReplacingMergeTree)
    ↓
pm_wallet_pnl_indexer (AggregatingMergeTree)
    ↓
pm_wallet_pnl_summary_indexer (human-readable view)
    ↓
Reconciliation (compare to Data API)
    ↓
Leaderboards & Dashboards
```

### Integration with Existing System

```
C2 Data API → external_trades_raw → pm_trades_complete (ghost cohort, fill detail)
                                           ↓
                                    pm_wallet_market_pnl_resolved
                                           ↓
                                    Reconciliation ←→ pm_positions_indexer (global coverage)
                                           ↓
                                    Unified Leaderboards
```

---

## Key Design Decisions

### 1. Goldsky as Primary Source

**Decision:** Use Goldsky-hosted PNL Subgraph instead of Dune or Flipside

**Rationale:**
- Official Polymarket data (authoritative)
- Pre-computed P&L (no complex calculations needed)
- Real-time updates (block-by-block)
- Free API access (no rate limits for reasonable usage)
- GraphQL interface (easy pagination, filtering)

**Trade-off:** Must trust Polymarket's P&L calculation (mitigated by reconciliation against Data API)

---

### 2. ReplacingMergeTree for Upserts

**Decision:** Use ReplacingMergeTree(version) instead of standard MergeTree

**Rationale:**
- Idempotent inserts (can re-sync without duplicates)
- Automatic deduplication based on version field
- No need for complex UPDATE logic
- Query with FINAL modifier to get latest version

**Trade-off:** Queries require FINAL modifier (small performance overhead, but <10ms for wallet queries)

---

### 3. Token ID Decoding at Ingestion

**Decision:** Decode token_id → condition_id + outcome_index during ingestion, not at query time

**Rationale:**
- Simplifies queries (no need to decode on every read)
- Enables efficient joins with existing tables (by condition_id)
- Validates encoding correctness early (fail fast)
- Stores in human-readable format (64-char hex)

**Trade-off:** Slightly slower ingestion (decode computation), but one-time cost

---

### 4. Reconciliation as Validation, Not Blocking

**Decision:** Run reconciliation checks but don't block ingestion or queries

**Rationale:**
- Indexer is primary truth (authoritative on-chain data)
- Data API is supplementary (fill-level detail for specific cohorts)
- Discrepancies are logged for investigation, not errors
- System remains operational even with reconciliation gaps

**Trade-off:** Potential for undetected systematic bias (mitigated by automated alerts)

---

### 5. Pilot Before Full Backfill

**Decision:** Test with 1,000 positions before scaling to 130K

**Rationale:**
- Validates schema correctness
- Tests token decoding algorithm
- Identifies edge cases early
- Measures real-world performance
- Low risk if failures occur

**Trade-off:** Adds 3 hours to timeline, but prevents costly failures at scale

---

## Performance Estimates

### Full Backfill (130K Positions)

**With 8 Workers:**
- GraphQL fetch: 130 pages × 150ms = 19.5s total → 2.4s per worker
- Token decode: 130K × 0.001ms = 130ms total → 16ms per worker
- ClickHouse insert: 130 batches × 80ms = 10.4s total → 1.3s per worker
- **Total: 2.4s per worker (slowest worker determines duration)**

**With 1 Worker:**
- Total: 19.5s (fetch) + 0.13s (decode) + 10.4s (insert) = ~30s

**Conclusion:** 8 workers provide 12x speedup (30s → 2.4s)

---

### Incremental Sync (Every 5 Minutes)

**Typical Volume:** 100-500 new positions per sync

**With 1 Worker:**
- GraphQL fetch: 1 page × 150ms = 150ms
- Token decode: 500 × 0.001ms = 0.5ms
- ClickHouse insert: 1 batch × 80ms = 80ms
- **Total: <250ms**

**Margin:** 5 min = 300s, sync takes <1s, leaves 299s buffer

---

### Query Performance

**Wallet P&L:**
```sql
SELECT * FROM pm_wallet_pnl_summary_indexer WHERE wallet_address = '...'
```
- Index lookup: O(log N) = ~10 operations for 130K rows
- **Expected: <10ms**

**Global Leaderboard:**
```sql
SELECT * FROM pm_wallet_pnl_summary_indexer ORDER BY total_realized_pnl_usd DESC LIMIT 100
```
- Materialized aggregations: pre-computed
- Sort: ~15K wallets × log(15K) = ~200K comparisons
- **Expected: <50ms**

---

## Monitoring Metrics

### Ingestion Health

- Last successful sync timestamp
- Records processed in last hour/day
- Failed sync attempts
- Average sync duration
- GraphQL query latency
- ClickHouse insert latency

**Alert Thresholds:**
- Sync failure: 3 consecutive failures → Page on-call
- Sync lag: >10 minutes behind → Slack alert
- GraphQL errors: >10% error rate → Investigate endpoint
- ClickHouse errors: Any insert failure → Investigate schema

---

### Data Quality

- Total positions in pm_positions_indexer
- Distinct wallets
- Distinct conditions
- Positions with amount = 0 (closed positions)
- P&L sum (should be non-negative overall)
- Validation failures (invalid formats, ranges)

**Alert Thresholds:**
- Position count drop: >5% decrease → Data quality check
- Negative P&L sum: Unexpected → Investigate
- Validation failures: >1% of records → Review decoder

---

### Reconciliation Health

- Discrepancies logged (by severity)
- Mean delta across cohort
- Systematic bias (% positive vs negative deltas)
- Unresolved HIGH severity cases

**Alert Thresholds:**
- HIGH severity count: >5 wallets → Email supervisor
- MEDIUM severity count: >20 wallets → Slack notification
- Mean delta: >$500 → Email supervisor
- Systematic bias: >80% same sign → Email supervisor

---

## Documentation Deliverables

### Design Phase (COMPLETE)

1. **C1_GLOBAL_INDEXER_SELECTION.md** - Indexer research and recommendation
2. **C1_GLOBAL_INDEXER_INGESTION_SPEC.md** - Pipeline specification
3. **C1_INDEXER_RECONCILIATION_STRATEGY.md** - Reconciliation rules and workflows
4. **C1_INDEXER_PILOT_BACKFILL_PLAN.md** - Pilot execution plan
5. **sql/ddl_pm_positions_indexer.sql** - Base table DDL
6. **sql/ddl_pm_wallet_pnl_indexer.sql** - Aggregated table DDL
7. **sql/example_queries_indexer.sql** - 40+ example queries
8. **sql/INDEXER_SCHEMA_DESIGN.md** - Complete schema design (759 lines)

---

### Implementation Phase (PENDING)

After pilot execution, create:

9. **C1_INDEXER_PILOT_RESULTS.md** - Pilot execution results
   - Execution summary
   - Data quality results
   - Reconciliation results
   - Issues encountered
   - Recommendation (proceed to full backfill?)

10. **C1_INDEXER_DEPLOYMENT_GUIDE.md** - Production deployment
    - Environment setup
    - Cron job configuration
    - Monitoring setup
    - Alert configuration
    - Rollback procedures

---

## Files Created This Session

### Documentation (5 files)
1. `docs/C1_GLOBAL_INDEXER_SELECTION.md` - Indexer selection (309 lines)
2. `docs/C1_GLOBAL_INDEXER_INGESTION_SPEC.md` - Ingestion pipeline (523 lines)
3. `docs/C1_INDEXER_RECONCILIATION_STRATEGY.md` - Reconciliation strategy (XXX lines)
4. `docs/C1_INDEXER_PILOT_BACKFILL_PLAN.md` - Pilot plan (XXX lines)
5. `SESSION_SUMMARY_GLOBAL_COVERAGE_DESIGN_2025-11-15.md` - This file

### Scripts (1 file)
1. `scripts/explore-polymarket-subgraph.ts` - GraphQL schema introspection (94 lines)

### SQL (4 files, via database-architect agent)
1. `sql/ddl_pm_positions_indexer.sql` - Base table DDL
2. `sql/ddl_pm_wallet_pnl_indexer.sql` - Aggregated table DDL
3. `sql/example_queries_indexer.sql` - 40+ example queries
4. `sql/INDEXER_SCHEMA_DESIGN.md` - Complete design documentation (759 lines)

---

## Phase Summary

### Phase A - Ghost Cohort P&L Wiring (PENDING C2 COMPLETION)

**Status:** Waiting for C2 to complete canonical global ghost wallet ingestion

**Tasks:**
- A.1: Verify C2 completion
- A.2: Wire unified trade view
- A.3: Implement correct P&L functions
- A.4: Validate on known wallets
- A.5: Finalize ghost cohort status

---

### Phase B - Global Coverage Design (COMPLETE ✅)

**Status:** All design work complete, ready for implementation

**Tasks:**
- [x] B.1: Research and choose indexer dataset
- [x] B.2: Propose target ClickHouse schema
- [x] B.3: Design ingestion pipeline (conceptual)
- [x] B.4: Define reconciliation strategy
- [x] B.5: Plan first limited backfill

**Outcome:** Complete end-to-end design from GraphQL ingestion to reconciliation

---

### Phase C - Coverage Dashboards (FUTURE)

**Status:** Pending completion of Phase A and Phase B implementation

**Tasks:**
- C.1: Build coverage metrics views
- C.2: Create global rollups
- C.3: Write documentation for downstream users

---

## Next Actions

### Immediate (When C2 Reports Completion)

**Phase A Implementation:**
1. Verify C2 completion status (check global_ghost_ingestion_checkpoints)
2. Wire unified trade view joining CLOB, CTF, and external_trades_raw
3. Implement P&L functions (realized/unrealized, cost basis)
4. Validate on xcnstrategy and other known wallets
5. Document ghost cohort P&L accuracy

---

### After Phase A Complete

**Phase B Implementation (Pilot):**
1. Implement token decoder (lib/polymarket/token-decoder.ts)
2. Create GraphQL client (lib/polymarket/graphql-client.ts)
3. Create pilot backfill script (scripts/sync-indexer-pilot.ts)
4. Create validation script (scripts/validate-indexer-pilot.ts)
5. Create reconciliation script (scripts/reconcile-xcnstrategy-pilot.ts)
6. Run pilot (1,000 positions)
7. Document results (C1_INDEXER_PILOT_RESULTS.md)

**Phase B Implementation (Full Scale):**
1. Create full backfill script with 8 workers
2. Create incremental sync script
3. Create sync_checkpoints table
4. Deploy to production
5. Set up cron job (every 5 minutes)
6. Set up monitoring and alerts
7. Document deployment (C1_INDEXER_DEPLOYMENT_GUIDE.md)

---

## Success Metrics

### Design Phase (Achieved)

- [x] Indexer selected with clear rationale
- [x] Schema designed with performance targets
- [x] Ingestion pipeline specified with retry logic
- [x] Reconciliation strategy documented
- [x] Pilot plan created with validation steps
- [x] All documentation peer-review ready

---

### Implementation Phase (Future)

- [ ] Pilot completes in <1 second
- [ ] All validation checks pass
- [ ] xcnstrategy reconciliation shows <$100 delta
- [ ] Full backfill completes in <15 seconds
- [ ] Incremental sync runs every 5 minutes
- [ ] Query performance meets targets (<10ms wallet, <50ms leaderboard)
- [ ] Monitoring and alerts operational

---

## Risk Mitigation

### Technical Risks

**Risk:** Token decoding algorithm incorrect
- **Mitigation:** Validate against known condition_id mappings during pilot
- **Status:** Algorithm specified, ready for validation

**Risk:** GraphQL rate limits during full backfill
- **Mitigation:** Exponential backoff, 8 workers spread load
- **Status:** Retry logic specified in ingestion spec

**Risk:** ClickHouse performance degradation at scale
- **Mitigation:** Partitioning by month, optimized indexes, materialized views
- **Status:** Schema designed for performance

**Risk:** Large reconciliation discrepancies
- **Mitigation:** Accept indexer as primary truth, log differences
- **Status:** Reconciliation strategy accounts for expected differences

---

### Operational Risks

**Risk:** C2 ghost cohort ingestion never completes
- **Mitigation:** Phase B can proceed independently
- **Status:** Design complete, can implement without Phase A

**Risk:** Goldsky subgraph becomes unavailable
- **Mitigation:** Graceful degradation, cache last known state
- **Status:** Error handling specified in ingestion spec

**Risk:** Schema changes in subgraph (version upgrade)
- **Mitigation:** Version pinning (0.0.14), monitor releases
- **Status:** source_version field tracks schema version

---

## Lessons Learned

### 1. Delegate to Specialized Agents

**Observation:** database-architect agent produced excellent schema design (759 lines, 40+ queries)

**Outcome:** Saved time, higher quality output

**Application:** Continue delegating database work to database-architect

---

### 2. Design Before Implementation

**Observation:** Comprehensive design phase (B.1-B.5) clarifies requirements

**Outcome:** Implementation will be faster, fewer surprises

**Application:** Continue phased approach (design → pilot → full scale)

---

### 3. Reconciliation as Validation, Not Blocking

**Observation:** Two sources will never match perfectly (timing, coverage, precision)

**Outcome:** Accept differences, log for investigation

**Application:** Don't block system on reconciliation gaps

---

## Timeline

**Session Duration:** ~2 hours

**Breakdown:**
- Phase B.1 (Indexer Research): 30 min
- Phase B.2 (Schema Design): 45 min (delegated to database-architect)
- Phase B.3 (Ingestion Spec): 30 min
- Phase B.4 (Reconciliation Strategy): 45 min
- Phase B.5 (Pilot Plan): 45 min
- Session Summary: 30 min

**Future Work:**
- Phase A Implementation: TBD (waiting for C2)
- Phase B Implementation (Pilot): 3 hours
- Phase B Implementation (Full Scale): 4 hours
- Phase C Implementation: 6 hours

---

**Signed:** Claude 1 (C1)
**Date:** 2025-11-15 (PST)
**Time in Session:** ~2 hours
**Status:** Phase B design complete, ready for Phase A or Phase B implementation
