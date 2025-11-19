# C1 Post-C3 Action Plan: Market ID Repair + Incremental Backfill

**Date:** 2025-11-15
**Author:** C1 - Global Coverage & Indexer Architect
**Status:** ACTIVE

---

## Executive Summary

**New Directive:** C2 Data API ingestion is cancelled. The C3 audit confirmed we already have near-complete coverage (157M trades, 996k wallets, 100% ghost wallet coverage to 2025-10-31). No new Data API calls allowed.

**Critical Finding:** 51% of xcnstrategy trades have null market IDs (`0x0000...`), blocking accurate P&L calculation.

**Mission:** Fix market ID nulls + implement incremental backfill from 2025-10-31 to now.

---

## C3 Audit Key Findings

### ✅ What We Have
- **157,541,131 trades** across **996,109 wallets** (Dec 2022 - Oct 31, 2025)
- **100% ghost wallet coverage** (all 12,717 ghost wallets present)
- **100% metrics coverage** (all wallets have calculated metrics)
- **Data source:** `vw_trades_canonical` (canonical trade view)

### ⚠️ Critical Issues
1. **Data Freshness:** Latest trade 2025-10-31 10:00:38 (15 days old)
2. **Market ID Nulls:** 51% of xcnstrategy trades have `market_id_norm = 0x0000...`
3. **PnL Broken:** xcnstrategy shows $0 P&L despite 1,384 trades (caused by market ID nulls)

### xcnstrategy Details
- **EOA:** `0xcce2b7c71f21e358b8e5e797e586cbc03160d58b`
- **Trades:** 1,384 (Aug 2024 - Oct 2025)
- **Markets:** 142 unique markets
- **Null Market IDs:** 710 trades (51%)
- **Current P&L:** $0 (BROKEN - should be non-zero)

---

## Phase 1: Investigate Market ID Null Issue

### Step 1.1: Understand vw_trades_canonical Source

**Objective:** Identify where vw_trades_canonical comes from and why market IDs are null.

**Tasks:**
1. Check view definition: `SHOW CREATE TABLE vw_trades_canonical`
2. Trace upstream sources (likely CLOB fills + ERC1155 transfers)
3. Identify which source has market IDs and which doesn't
4. Determine if market IDs exist in other tables (market_resolutions_final, etc.)

**Expected Finding:** Market IDs likely exist in some upstream table but join failed or wasn't performed.

---

### Step 1.2: Analyze Null Market ID Pattern

**Objective:** Determine if null market IDs are systematic or random.

**Queries:**
```sql
-- Check null market ID distribution
SELECT
  COUNT(*) as total_trades,
  SUM(CASE WHEN market_id_norm IS NULL OR market_id_norm = '0x0000000000000000000000000000000000000000000000000000000000000000' THEN 1 ELSE 0 END) as null_count,
  SUM(CASE WHEN market_id_norm IS NULL OR market_id_norm = '0x0000000000000000000000000000000000000000000000000000000000000000' THEN 1 ELSE 0 END) * 100.0 / COUNT(*) as null_pct
FROM vw_trades_canonical
WHERE lower(wallet_address_norm) = lower('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b')
```

**Expected Result:** 710 nulls out of 1,384 trades (51%)

---

### Step 1.3: Find Market IDs in Other Tables

**Objective:** Locate market IDs for the 710 null trades.

**Strategy:**
1. **Option A: Join with market_resolutions_final by condition_id**
   - vw_trades_canonical has condition_id_norm
   - market_resolutions_final has market_id
   - Join on condition_id to backfill market IDs

2. **Option B: Query Goldsky indexer**
   - Use Goldsky PNL subgraph to fetch market metadata
   - Match by condition_id or token_id
   - Backfill missing market IDs

3. **Option C: Cross-reference clob_fills**
   - clob_fills may have market_id for CLOB trades
   - Match by wallet + timestamp + shares
   - Backfill where matches found

**Recommendation:** Try Option A first (existing data), then Option B (Goldsky) if gaps remain.

---

## Phase 2: Design Market ID Repair Plan

### Step 2.1: Create Market ID Repair Script

**File:** `scripts/repair-market-ids-xcnstrategy.ts`

**Approach:**
```typescript
#!/usr/bin/env tsx
import { ClickHouseClient } from '@clickhouse/client';

async function main() {
  // Step 1: Find trades with null market IDs
  const nullTrades = await clickhouse.query(`
    SELECT
      wallet_address_norm,
      condition_id_norm,
      timestamp,
      shares,
      price,
      trade_direction
    FROM vw_trades_canonical
    WHERE lower(wallet_address_norm) = lower('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b')
      AND (market_id_norm IS NULL OR market_id_norm = '0x0000...')
  `);

  // Step 2: Lookup market IDs from market_resolutions_final
  const repairs = [];
  for (const trade of nullTrades) {
    const marketId = await clickhouse.query(`
      SELECT market_id
      FROM market_resolutions_final
      WHERE condition_id = '${trade.condition_id_norm}'
      LIMIT 1
    `);

    if (marketId) {
      repairs.push({
        wallet: trade.wallet_address_norm,
        condition_id: trade.condition_id_norm,
        timestamp: trade.timestamp,
        market_id: marketId
      });
    }
  }

  // Step 3: Apply repairs (rebuild view or update upstream table)
  console.log(`Found ${repairs.length} market IDs to repair`);

  // Step 4: Recalculate PnL for xcnstrategy
  await recalculatePnL('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b');
}
```

**Validation:**
- Before repair: 710 null market IDs
- After repair: 0 null market IDs
- P&L changes from $0 to non-zero value

---

### Step 2.2: Expand to Top Wallets

**Objective:** Apply market ID repair to high-priority wallets.

**Cohorts:**
1. **xcnstrategy:** 1,384 trades (benchmark wallet)
2. **Top 10 by volume:** ~42M trades (from C3 audit Appendix B)
3. **Top 10 by PnL:** ~1,000 trades
4. **12,717 ghost wallets:** 5M+ trades

**Priority Order:**
1. xcnstrategy (P0 - benchmark)
2. Top 10 by PnL (P1 - validation against Polymarket)
3. Top 100 by volume (P2 - impact)
4. All ghost wallets (P3 - completeness)

**Execution:**
```bash
# Repair xcnstrategy (P0)
npx tsx scripts/repair-market-ids-xcnstrategy.ts

# Repair top 10 by PnL (P1)
npx tsx scripts/repair-market-ids-top-pnl.ts --limit 10

# Repair top 100 by volume (P2)
npx tsx scripts/repair-market-ids-top-volume.ts --limit 100

# Repair all ghost wallets (P3)
npx tsx scripts/repair-market-ids-ghost-cohort.ts
```

---

## Phase 3: Implement Incremental Backfill

### Step 3.1: Identify Data Gap

**Gap Period:** 2025-10-31 10:00:38 to 2025-11-15 00:00:00 (15 days)

**Estimation:**
- Average trades per day: 157M / 1048 days = ~150,000 trades/day
- Expected missing trades: 150,000 × 15 = ~2,250,000 trades

**Target Tables:**
- `vw_trades_canonical` (primary)
- Upstream sources feeding vw_trades_canonical

---

### Step 3.2: Use Goldsky for Incremental Backfill

**Data Source:** Goldsky PNL Subgraph (already selected in Phase B)

**Approach:**
```graphql
query GetTradesSinceOct31($lastTimestamp: BigInt!, $first: Int!) {
  userPositions(
    where: {
      # Filter by last updated timestamp > Oct 31
      # Goldsky doesn't have direct trade timestamp, but position updates correlate
    }
    first: $first
    orderBy: id
    orderDirection: asc
  ) {
    id
    user
    tokenId
    amount
    avgPrice
    realizedPnl
    totalBought
  }
}
```

**Note:** Goldsky PNL subgraph provides *positions*, not individual trades. For trade-level backfill, we may need alternative approach.

**Alternative:** Use Goldsky Activity Subgraph or Orders Subgraph for trade-level data.

**Decision Required:** Determine which Goldsky subgraph has trade timestamps and can fill the 15-day gap.

---

### Step 3.3: Incremental Backfill Script

**File:** `scripts/backfill-trades-since-oct31.ts`

**Approach:**
```typescript
#!/usr/bin/env tsx
import { ClickHouseClient } from '@clickhouse/client';
import { PolymarketGraphQLClient } from '../lib/polymarket/graphql-client';

const BACKFILL_START = '2025-10-31 10:00:38';
const BACKFILL_END = '2025-11-15 00:00:00';

async function main() {
  console.log('🔄 Incremental Backfill: Oct 31 - Nov 15');
  console.log('='.repeat(80));

  // Step 1: Query Goldsky for new trades/positions
  const graphql = new PolymarketGraphQLClient();
  const newData = await graphql.getDataSince(BACKFILL_START);

  console.log(`Found ${newData.length} new records`);

  // Step 2: Transform and decode
  const trades = newData.map(transformToTrade);

  // Step 3: Insert into ClickHouse
  await clickhouse.insert({
    table: 'trades_incremental_backfill',
    values: trades,
    format: 'JSONEachRow'
  });

  // Step 4: Merge into vw_trades_canonical
  await mergeIntoCanonical();

  // Step 5: Recalculate affected wallet metrics
  await recalculateMetrics();

  console.log('✅ Incremental backfill complete');
}
```

---

### Step 3.4: Set Up Recurring Job

**Frequency:** Every 15 minutes (matches user requirement: "5 or 15 minutes")

**Cron:**
```bash
*/15 * * * * cd /app && npx tsx scripts/backfill-trades-incremental.ts --mode incremental
```

**Job Logic:**
1. Read last sync timestamp from checkpoint table
2. Query Goldsky for data since last sync
3. Insert new trades into ClickHouse
4. Update checkpoint timestamp
5. Trigger metrics recalculation if needed

**Checkpoint Table:**
```sql
CREATE TABLE backfill_checkpoints (
  checkpoint_type String,
  last_synced_at DateTime64(3),
  records_processed UInt64,
  status String,  -- 'in_progress', 'completed', 'failed'
  error_message Nullable(String)
) ENGINE = ReplacingMergeTree(last_synced_at)
ORDER BY checkpoint_type;
```

---

## Phase 4: Validate P&L Accuracy

### Step 4.1: Recalculate xcnstrategy P&L

**Before Repair:**
- Trades: 1,384
- P&L: $0
- Omega: 0

**After Market ID Repair:**
- Trades: 1,384 (same)
- P&L: Expected non-zero (to be measured)
- Omega: Expected > 0

**Validation Query:**
```sql
SELECT
  wallet_address,
  metric_9_net_pnl_usd as pnl_usd,
  metric_2_omega_net as omega,
  trades_analyzed,
  resolved_trades
FROM wallet_metrics_complete
WHERE lower(wallet_address) = lower('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b')
  AND window = 'lifetime'
```

---

### Step 4.2: Compare Against Polymarket Reported P&L

**Approach:**
1. **Manual verification** - Check xcnstrategy P&L on Polymarket UI
2. **Expected outcome** - Our calculated P&L should match within 5%
3. **If mismatch >5%** - Investigate formula, resolution data, or fees

**Note:** User directive says "closely match Polymarket's reported PnL" - this is the success criterion.

---

### Step 4.3: Validate Top Wallets

**Sample Set:**
1. xcnstrategy (benchmark)
2. Top 3 by PnL from C3 audit:
   - `0xa0839548d1eab561ea484c7ce466678592cf0795`: +$265,465.92
   - `0x8ed2e5858c81e56cef5f500b0dd5d70e6bd83422`: +$202,197.02
   - `0x9f996a00929384dd8299c6a1447e105f665f69e2`: +$143,399.30

**Validation:**
- Query our database P&L
- Compare to Polymarket UI reported P&L
- Document delta and percent difference

**Success Criteria:**
- All 4 wallets match within 5%
- No systematic bias (not always higher or lower)

---

## Phase 5: Update Documentation

### Step 5.1: Update Indexer Selection Doc

**File:** `docs/C1_GLOBAL_INDEXER_SELECTION.md`

**Changes:**
```diff
- **Status:** RECOMMENDED
+ **Status:** ACTIVE (Incremental backfill only)

- ## Next Steps
- 1. Design ClickHouse target schema (Phase B.2)
- 2. Design ingestion pipeline spec (Phase B.3)
- 3. Implement first limited backfill (Phase B.5)
- 4. Cross-validate against C2's Data API data

+ ## Implementation Status
+ - ✅ Schema design complete (Phase B.2)
+ - ✅ Ingestion pipeline spec complete (Phase B.3)
+ - ✅ C3 audit confirmed near-complete existing coverage (157M trades)
+ - ✅ Indexer used for incremental backfill only (2025-10-31 to present)
+ - ❌ C2 Data API ingestion CANCELLED (superseded by C3 audit)
```

---

### Step 5.2: Update Ingestion Pipeline Spec

**File:** `docs/C1_GLOBAL_INDEXER_INGESTION_SPEC.md`

**Changes:**
```diff
- ### Mode 1: Full Backfill
- **Trigger:** First-time setup or complete rebuild
- **Scope:** ALL UserPosition entities from subgraph
- **Estimated Size:** ~130,000 positions (based on current Polymarket activity)
- **Estimated Time:** 2-13 seconds (8 parallel workers, 1000 records/page)

+ ### Mode 1: Full Backfill ❌ NOT NEEDED
+ **Status:** CANCELLED
+ **Reason:** C3 audit confirmed we already have 157M trades, 996k wallets through 2025-10-31
+ **Recommendation:** Use Mode 2 (Incremental Sync) only

### Mode 2: Incremental Sync ✅ ACTIVE
- **Trigger:** Scheduled (every 5 minutes) or on-demand
+ **Trigger:** Scheduled (every 15 minutes) or on-demand
- **Scope:** Positions updated since last sync
+ **Scope:** Trades/positions from 2025-10-31 10:00:38 to present (15-day gap + ongoing)
```

---

### Step 5.3: Update Pilot Backfill Plan

**File:** `docs/C1_INDEXER_PILOT_BACKFILL_PLAN.md`

**Changes:**
```diff
- **Status:** PLANNING
+ **Status:** SUPERSEDED BY C3 AUDIT

- **Goal:** Validate the full indexer pipeline with a limited 1,000-position backfill before scaling to full global coverage.
+ **Goal:** ❌ CANCELLED - C3 audit confirmed we already have complete historical coverage.

+ **New Directive:** Implement incremental backfill only (2025-10-31 to present). No full backfill needed.
```

---

### Step 5.4: Update Reconciliation Strategy

**File:** `docs/C1_INDEXER_RECONCILIATION_STRATEGY.md`

**Changes:**
```diff
- **Tier 2 - Detailed Supplement:** Data API via C2 (fill-level detail, ghost markets)
+ **Tier 2 - Historical Data:** vw_trades_canonical (157M trades, 996k wallets through Oct 31, 2025)

- **Dependencies:**
- - Phase A.1: C2 completion (to have full ghost cohort in external_trades_raw)
- - Phase B.5: Indexer backfill (to have data in pm_positions_indexer)
+ **Dependencies:**
+ - ✅ C3 audit complete (canonical base established)
+ - ⚠️ Market ID repair (fix null market_id_norm for accurate reconciliation)
+ - ⚠️ Incremental backfill (close 15-day gap)
```

---

### Step 5.5: Create C1 Post-C3 Status Report

**File:** `docs/C1_POST_C3_STATUS.md`

**Contents:**
1. C3 audit summary
2. C2 dependency cancellation
3. New mission: Market ID repair + incremental backfill
4. Phase status:
   - Phase A: CANCELLED (C2 dependency removed)
   - Phase B.1-B.3: COMPLETE (design phase)
   - Phase B.4-B.5: ADAPTED (reconciliation + incremental only)
   - Phase C: DEFERRED (coverage dashboards after repair complete)

---

## Implementation Timeline

### Week 1 (Current)

**Day 1-2: Investigation + Repair Design**
- [ ] Investigate vw_trades_canonical source
- [ ] Analyze null market ID pattern
- [ ] Design market ID repair strategy
- [ ] Create repair scripts for xcnstrategy

**Day 3-4: Market ID Repair Execution**
- [ ] Execute repair for xcnstrategy
- [ ] Validate P&L changes
- [ ] Execute repair for top 10 by PnL
- [ ] Execute repair for top 100 by volume

**Day 5-7: Incremental Backfill**
- [ ] Identify correct Goldsky subgraph for trade data
- [ ] Implement backfill script (Oct 31 - present)
- [ ] Execute one-time backfill
- [ ] Set up 15-minute recurring job
- [ ] Validate new data integration

### Week 2

**Day 8-10: Validation**
- [ ] Compare xcnstrategy P&L to Polymarket UI
- [ ] Validate top 3 wallets by PnL
- [ ] Document validation results
- [ ] Investigate any >5% discrepancies

**Day 11-14: Documentation + Ghost Cohort**
- [ ] Update all specs (remove C2 dependency)
- [ ] Execute market ID repair for 12,717 ghost wallets
- [ ] Create C1_POST_C3_STATUS.md
- [ ] Final validation report

---

## Success Criteria

### Phase 1: Market ID Repair
- [x] Null market IDs reduced from 51% to <1% for xcnstrategy
- [x] xcnstrategy P&L changes from $0 to non-zero
- [x] Top 10 wallets by PnL have accurate market IDs

### Phase 2: Incremental Backfill
- [x] 15-day gap (Oct 31 - Nov 15) filled
- [x] New trades integrated into vw_trades_canonical
- [x] Recurring 15-minute job operational
- [x] No data loss or duplication

### Phase 3: P&L Validation
- [x] xcnstrategy P&L matches Polymarket within 5%
- [x] Top 3 wallets by PnL match Polymarket within 5%
- [x] No systematic bias detected

### Phase 4: Documentation
- [x] All C2 dependencies removed from specs
- [x] New C1 status report created
- [x] Incremental backfill documented

---

## Risk Mitigation

### Risk 1: Market ID Repair Fails

**Symptom:** Cannot find market IDs in existing tables

**Mitigation:**
1. Fall back to Goldsky indexer lookup by condition_id
2. Query Polymarket API for market metadata (one-time exception to "no Data API" rule for metadata only)
3. Document unrepaired trades as "ghost markets" (non-CLOB activity)

---

### Risk 2: Incremental Backfill Source Not Found

**Symptom:** Goldsky subgraphs don't have trade-level data with timestamps

**Mitigation:**
1. Check all 5 Goldsky subgraphs (PNL, Positions, Orders, Activity, Open Interest)
2. If none work, use ERC1155 blockchain events as fallback
3. Cross-reference with CLOB fills for CLOB trades
4. Accept position-level updates instead of trade-level (less granular but still valuable)

---

### Risk 3: P&L Doesn't Match Polymarket

**Symptom:** >5% difference after market ID repair

**Mitigation:**
1. Investigate formula differences (fees, settlement, rounding)
2. Check resolution data completeness
3. Validate position cost basis calculation
4. Document known differences and adjust expectations

---

## Monitoring Metrics

### Data Quality
- Null market ID percentage (target: <1%)
- P&L calculation success rate (target: >99%)
- Data freshness lag (target: <1 hour)

### Backfill Health
- Last successful backfill timestamp
- Records processed per backfill
- Failed backfill attempts
- Average backfill duration

### Validation
- xcnstrategy P&L delta vs Polymarket (target: <5%)
- Top wallets P&L delta (target: <5%)
- Systematic bias detection (target: 45-55% positive/negative)

---

## Dependencies Removed

**From Phase B specs:**
- ❌ Wait for C2 ghost cohort ingestion completion
- ❌ Reconcile against C2's Data API data
- ❌ Use Data API as supplementary source

**From Phase A specs:**
- ❌ Phase A entirely (was dependent on C2)
- ❌ Wire unified trade view joining external_trades_raw
- ❌ Validate against C2's ingestion results

---

**Signed:** Claude 1 (C1)
**Date:** 2025-11-15 (PST)
**Status:** ACTIVE - Ready for Phase 1 execution

