# C2 Mission: 100% Trade and Resolution Coverage

**Date:** 2025-11-16 (Updated 2025-11-16 with Data-API constraint)
**Agent:** C2 - External Data Ingestion
**Status:** 🚀 **ACTIVE - REVISED STRATEGY**

---

## ⚠️ CRITICAL CONSTRAINT: Data-API is User-Scoped Only

**Hard Limitation Discovered:**
- Polymarket Data-API endpoint `https://data-api.polymarket.com/activity` **requires** the `user` parameter
- Cannot query globally by market: `/activity?market=...` returns HTTP 400
- Cannot query by asset: `/activity?asset=...` requires `user` parameter

**Impact on Strategy:**
- ❌ **CANNOT** get "all trades for a market" directly from Data-API
- ✅ **CAN** get "all trades for a wallet" and filter by market client-side

**Revised Approach:**
1. Use internal data (on-chain, position tables) to discover wallets for ghost markets
2. Query Data-API by wallet: `/activity?user=<wallet>&type=TRADE`
3. Filter results to ghost market condition_ids

**Documentation:** This is a permanent architectural constraint, not a temporary limitation.

---

## Mission Objective

**Goal:** Guarantee that for every Polymarket market in `pm_markets`:
1. **All historical trades** are present in `pm_trades_complete`
   - CLOB trades from `pm_trades`
   - AMM/ghost trades from `external_trades_raw` via Data-API
2. **All markets with positions** have resolution data wired into C1's resolution pipeline

**Success Criteria:** C1 can trust PnL and Omega leaderboards across ALL wallets and ALL markets with complete confidence.

---

## Division of Labor

| Agent | Responsibility |
|-------|----------------|
| **C2 (This Agent)** | External discovery and ingestion |
| **C1 (P&L Agent)** | Mapping, P&L math, view wiring |

---

## Phase 1: Complete Ghost Markets for All Wallets ✅ READY

### Current State
- **Known ghost markets:** 6 (discovered via Dome comparison)
- **Current coverage:** Only xcnstrategy (1 wallet, 46 trades)
- **Missing:** All other wallets trading these 6 markets

### Tasks

#### 1.1 Dry-Run Market-Scoped Connector
```bash
npx tsx scripts/208-ingest-by-market-from-data-api.ts --dry-run
```

**Confirm:**
- All 6 ghost condition_ids queried
- Preview shows all wallets and trades that would be inserted

#### 1.2 Execute Live Ingestion
```bash
npx tsx scripts/208-ingest-by-market-from-data-api.ts
```

**Expected:**
- Fetch all Data-API activity for each ghost market
- Insert new trades into `external_trades_raw`
- Maintain idempotency via `external_trade_id` dedupe

#### 1.3 Validate Ghost Market Coverage
```bash
npx tsx scripts/check-external-trades.ts
npx tsx scripts/204-validate-external-ingestion.ts
```

**Create new script:** `scripts/212-report-ghost-market-coverage.ts`
- For each of 6 condition_ids:
  - `clob_trade_count` (from `pm_trades`)
  - `external_trade_count` (from `external_trades_raw`)
  - `distinct_wallets` per source
  - `total_value` per source

#### 1.4 Deliverable
**Document:** `C2_GHOST_MARKETS_100_PERCENT_COVERAGE.md`

**Must state clearly:**
- All Data-API trades for 6 ghost markets now in `external_trades_raw`
- C1 can fully trust P&L on these markets for all wallets

---

## Phase 2: Discover Additional Ghost/AMM Markets 🔍 PENDING

### Strategy
Systematically search for markets where CLOB pipeline is thin/empty but Data-API has trades.

### Tasks

#### 2.1 Create AMM Market Candidates Table
**Script:** `scripts/209-build-amm-market-candidates.ts`

**Table:** `amm_market_candidates`
```sql
CREATE TABLE amm_market_candidates (
  condition_id String,
  question String,
  source_hint Enum8('gamma_flag', 'zero_clob', 'dome_gap', 'other'),
  has_clob_trades UInt8,
  clob_trade_count UInt64,
  has_external_trades UInt8 DEFAULT 0,
  data_api_trade_count UInt64 DEFAULT 0,
  external_ingestion_status Enum8('pending', 'probed', 'done', 'error') DEFAULT 'pending',
  created_at DateTime DEFAULT now(),
  updated_at DateTime DEFAULT now()
) ENGINE = MergeTree()
ORDER BY (source_hint, condition_id);
```

**Seed candidates from:**
1. **Known ghost markets** (6 confirmed)
2. **Zero CLOB markets:**
   - `SELECT condition_id FROM pm_markets WHERE condition_id NOT IN (SELECT DISTINCT condition_id FROM pm_trades)`
3. **Gamma flags:**
   - `SELECT condition_id FROM gamma_markets WHERE enable_order_book = false`
4. **Dome gap reports** (if available in repo)

#### 2.2 Add Data-API Probe Mode
**Extend:** `scripts/208-ingest-by-market-from-data-api.ts`

**New mode:**
```bash
npx tsx scripts/208-ingest-by-market-from-data-api.ts --probe-only
```

**Behavior:**
- Query each candidate from `amm_market_candidates`
- Count trades and distinct wallets Data-API reports
- Update `amm_market_candidates` without inserting rows:
  - `has_external_trades = 1` (if trades found)
  - `data_api_trade_count = N`
  - `external_ingestion_status = 'probed'`

#### 2.3 Classify Confirmed AMM Markets
**Create:** `scripts/213-classify-amm-markets.ts`

**Logic:**
```sql
-- Promote markets with Data-API trades
UPDATE amm_market_candidates
SET class = 'amm_confirmed'
WHERE data_api_trade_count > 0;

-- Create ingestion queue
CREATE TABLE amm_markets_to_ingest AS
SELECT condition_id, question, data_api_trade_count
FROM amm_market_candidates
WHERE class = 'amm_confirmed'
ORDER BY data_api_trade_count DESC;
```

#### 2.4 Deliverable
**Document:** `C2_AMM_MARKET_DISCOVERY_REPORT.md`

**Must include:**
- Total candidates probed
- Total confirmed AMM markets (`data_api_trade_count > 0`)
- Estimated trades and wallets from confirmed AMM markets
- Breakdown by source_hint

---

## Phase 3: Ingest All Confirmed AMM Markets 📥 PENDING

### Tasks

#### 3.1 Bulk Market Ingestion
**Extend:** `scripts/208-ingest-by-market-from-data-api.ts`

**New mode:**
```bash
npx tsx scripts/208-ingest-by-market-from-data-api.ts --mode ingest-confirmed
```

**Behavior:**
- Read all markets from `amm_markets_to_ingest`
- For each market:
  - Call Data-API
  - Transform to `external_trades_raw` schema
  - Insert with dedupe by `external_trade_id`
  - Update `amm_market_candidates.external_ingestion_status = 'done'`

#### 3.2 Validate AMM Market Ingestion
**Extend:** `scripts/204-validate-external-ingestion.ts`

**New checks:**
- Total external trades per confirmed market
- No duplicates within each market
- Price and share sanity checks

**Create:** `scripts/210-report-amm-market-coverage.ts`

**Output for every confirmed AMM market:**
- `clob_trade_count`
- `external_trade_count`
- `combined_trade_count` (from `pm_trades_with_external`)
- `distinct_wallets`

#### 3.3 Mark Markets Complete
**Update `amm_market_candidates`:**
```sql
UPDATE amm_market_candidates
SET
  has_external_trades = 1,
  external_ingestion_status = 'done',
  updated_at = now()
WHERE class = 'amm_confirmed'
  AND external_trade_count > 0;
```

#### 3.4 Deliverable
**Document:** `C2_AMM_MARKETS_INGESTED_STATUS.md`

**Must list:**
- All `amm_confirmed` markets
- Coverage status per market
- Any failures or anomalies

---

## Phase 4: Global Coverage Audit 📊 PENDING

### Tasks

#### 4.1 Create Market Trade Coverage View
**Script:** `scripts/214-build-market-trade-coverage-view.ts`

**View:** `market_trade_coverage`
```sql
CREATE VIEW market_trade_coverage AS
SELECT
  m.condition_id,
  m.question,

  -- CLOB coverage
  COALESCE(clob.trade_count, 0) as clob_trade_count,

  -- External coverage
  COALESCE(ext.trade_count, 0) as external_trade_count,

  -- Combined coverage
  COALESCE(comb.trade_count, 0) as total_trade_count,

  -- Resolution status
  COALESCE(res.resolved, 0) as has_resolution,

  -- Position status
  COALESCE(pos.has_positions, 0) as any_wallet_positions

FROM pm_markets m

LEFT JOIN (
  SELECT condition_id, COUNT(*) as trade_count
  FROM pm_trades
  GROUP BY condition_id
) clob ON m.condition_id = clob.condition_id

LEFT JOIN (
  SELECT condition_id, COUNT(*) as trade_count
  FROM external_trades_raw
  GROUP BY condition_id
) ext ON m.condition_id = ext.condition_id

LEFT JOIN (
  SELECT condition_id, COUNT(*) as trade_count
  FROM pm_trades_complete
  GROUP BY condition_id
) comb ON m.condition_id = comb.condition_id

LEFT JOIN (
  SELECT condition_id, 1 as resolved
  FROM gamma_resolved
  GROUP BY condition_id
) res ON m.condition_id = res.condition_id

LEFT JOIN (
  SELECT condition_id, 1 as has_positions
  FROM pm_wallet_market_pnl_resolved
  GROUP BY condition_id
) pos ON m.condition_id = pos.condition_id;
```

#### 4.2 Global Coverage Report Script
**Script:** `scripts/211-report-global-trade-coverage.ts`

**Output top-level stats:**
- Total markets
- Markets with any trades
- Markets with only CLOB trades
- Markets with any external trades
- Markets with positions but zero trades (RED FLAG)

**Writes:** `GLOBAL_EXTERNAL_COVERAGE_STATUS.md`

#### 4.3 Red Flag Detection
**In `GLOBAL_EXTERNAL_COVERAGE_STATUS.md`, explicitly list:**

**Category A: Critical Gaps**
```sql
-- Markets with positions but no trades
SELECT * FROM market_trade_coverage
WHERE any_wallet_positions = 1 AND total_trade_count = 0;
```

**Category B: Resolution Gaps**
```sql
-- Markets with trades but no resolution
SELECT * FROM market_trade_coverage
WHERE total_trade_count > 0 AND has_resolution = 0;
```

**Category C: Ingestion Failures**
```sql
-- Markets probed but not ingested
SELECT * FROM amm_market_candidates
WHERE data_api_trade_count > 0
  AND external_ingestion_status != 'done';
```

**For each category, state:**
- Is this a C2 job (missing ingestion)?
- Is this a C1 job (resolution mapping)?

#### 4.4 Deliverable
**Document:** `GLOBAL_EXTERNAL_COVERAGE_STATUS.md`

---

## Phase 5: Resolution Data Support 🔍 PENDING

### Purpose
Help C1 identify markets where external sources know the outcome but internal tables don't.

### Tasks

#### 5.1 Resolution Probe for Unresolved Markets
**Script:** `scripts/215-probe-external-resolutions.ts`

**For markets with `has_resolution = 0` but `trades > 0`:**
- Query Data-API or Gamma for resolution status
- Extract `resolved_flag_external` and `winning_outcome_external`

**Create table:** `external_resolution_hints`
```sql
CREATE TABLE external_resolution_hints (
  condition_id String,
  resolved_flag_external UInt8,
  winning_outcome_external Nullable(UInt8),
  winning_outcome_index Nullable(UInt8),
  source Enum8('gamma', 'data_api', 'other'),
  probed_at DateTime DEFAULT now()
) ENGINE = MergeTree()
ORDER BY condition_id;
```

#### 5.2 Deliverable
**Document:** `C2_RESOLUTION_HINTS_FOR_C1.md`

**List all markets where:**
- `has_resolution = 0` internally
- `resolved_flag_external = 1` externally

**Format:**
```markdown
| Condition ID | Question | Source | Winning Outcome |
|--------------|----------|--------|----------------|
| 0xf2ce8d38... | Xi Jinping out in 2025? | gamma | 0 (No) |
```

**Hand off to C1 for resolution pipeline wiring.**

---

## Phase 6: Sign-Off Criteria ✅ PENDING

### 100% Coverage Definition

**You are DONE when all of the following are TRUE and DOCUMENTED:**

#### 1. Trade Coverage
```sql
-- Every market with positions has trades
SELECT COUNT(*) FROM market_trade_coverage
WHERE any_wallet_positions = 1 AND total_trade_count = 0;
-- Must return: 0
```

#### 2. Resolution Coverage
```sql
-- Every market with trades has resolution OR external hint
SELECT COUNT(*) FROM market_trade_coverage
WHERE total_trade_count > 0
  AND has_resolution = 0
  AND condition_id NOT IN (SELECT condition_id FROM external_resolution_hints);
-- Must return: 0
```

#### 3. AMM Market Ingestion
```sql
-- All confirmed AMM markets are ingested
SELECT COUNT(*) FROM amm_market_candidates
WHERE class = 'amm_confirmed'
  AND external_ingestion_status != 'done';
-- Must return: 0
```

#### 4. No Red Flags
**In `GLOBAL_EXTERNAL_COVERAGE_STATUS.md`:**
- Category A (positions but no trades): 0 markets
- Category B (trades but no resolution): All handed to C1 via hints
- Category C (ingestion failures): 0 markets

### Final Deliverable

**Document:** `C2_GLOBAL_COVERAGE_MISSION_COMPLETE.md`

**Must summarize:**
- Total markets in Polymarket
- Total wallets with trades
- Total trades: CLOB vs external breakdown
- Confirmation statement:
  > "Every market with P&L has trades and resolution data. All AMM/ghost markets seen in Data-API have been ingested. C1 has complete data for all wallets, all markets, all events."

---

## Phase Tracking

| Phase | Status | Start Date | End Date | Deliverable |
|-------|--------|------------|----------|-------------|
| **Phase 1** | 🚀 Active | 2025-11-16 | TBD | `C2_GHOST_MARKETS_100_PERCENT_COVERAGE.md` |
| **Phase 2** | ⏳ Pending | TBD | TBD | `C2_AMM_MARKET_DISCOVERY_REPORT.md` |
| **Phase 3** | ⏳ Pending | TBD | TBD | `C2_AMM_MARKETS_INGESTED_STATUS.md` |
| **Phase 4** | ⏳ Pending | TBD | TBD | `GLOBAL_EXTERNAL_COVERAGE_STATUS.md` |
| **Phase 5** | ⏳ Pending | TBD | TBD | `C2_RESOLUTION_HINTS_FOR_C1.md` |
| **Phase 6** | ⏳ Pending | TBD | TBD | `C2_GLOBAL_COVERAGE_MISSION_COMPLETE.md` |

---

## Risk Mitigation

### Data Safety
- ✅ All scripts use idempotent inserts (dedupe by `external_trade_id`)
- ✅ Dry-run mode available for all ingestion
- ✅ Validation scripts run after each phase

### API Rate Limits
- ✅ Sleep between requests (configurable)
- ✅ Batch processing with resume capability
- ✅ Error handling and retry logic

### Scope Creep
- ✅ Clear phase boundaries
- ✅ Deliverable-driven progress tracking
- ✅ Handoff points to C1 documented

---

## Current State

### Infrastructure
- ✅ `external_trades_raw` table (46 rows, xcnstrategy only)
- ✅ `pm_trades_with_external` UNION view
- ✅ `wallet_backfill_plan` table (36 done, 65 pending)
- ✅ Scripts 203-208 operational

### Known Coverage
- ✅ **CLOB:** 38,945,566 trades across 118,660+ markets
- ✅ **External:** 46 trades (xcnstrategy, 6 ghost markets)
- ⚠️ **Gap:** Other wallets on 6 ghost markets (Phase 1 target)
- ⚠️ **Gap:** Other AMM/ghost markets beyond the 6 (Phase 2 target)

---

## Next Steps

**Immediate (Phase 1):**
1. Run dry-run of market-scoped connector
2. Execute live ingestion for 6 ghost markets
3. Validate and document complete coverage

**Short-term (Phase 2-3):**
1. Build AMM market discovery infrastructure
2. Probe all candidate markets
3. Ingest all confirmed AMM markets

**Medium-term (Phase 4-6):**
1. Global coverage audit
2. Resolution hints for C1
3. Sign-off on 100% coverage

---

**— C2 (Operator Mode)**

_Mission updated: From targeted backfill to systematic 100% coverage. Beginning Phase 1 execution._
