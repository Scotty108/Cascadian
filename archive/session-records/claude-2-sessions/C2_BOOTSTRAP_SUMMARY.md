# C2 Bootstrap Summary
**Date:** 2025-11-15
**Agent:** C2 - External Data Ingestion
**Mission:** Ingest AMM/Ghost Market trades for 6 markets with zero CLOB coverage

---

## Context from C1's Investigation

### Current P&L Gap

| Metric | Value |
|--------|-------|
| **Dome P&L** | $87,030.51 |
| **ClickHouse P&L** | $42,789.76 |
| **Remaining Gap** | **$44,240.75** (50.8%) |

**Progress so far:**
- Original gap: $84,941.33
- **Recovered 47.9%** ($40,700.58) via resolution sync in Phase 2A/2B
- Remaining gap: 6 AMM-only "ghost markets" with zero data in our pipeline

---

## The 6 Ghost Markets (AMM-Only, Zero CLOB Coverage)

### 1. Will Satoshi move any Bitcoin in 2025?
- **Condition ID:** `0x293fb49f43b12631ec4ad0617d9c0efc0eacce33416ef16f68521427daca1678`
- **Dome Stats:**
  - Trades: 1
  - Shares: 1,000.00
  - Avg Price: 0.947
- **Our Data:** NOT FOUND (0 trades in pm_trades, pm_markets, clob_fills)
- **Gamma API:** enable_order_book = `undefined` (AMM-only)

### 2. Xi Jinping out in 2025?
- **Condition ID:** `0xf2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1`
- **Dome Stats:**
  - Trades: 14 ⭐ **Highest volume of 6 ghost markets**
  - Shares: 19,999.99
  - Avg Price: 0.930
- **Our Data:** NOT FOUND
- **Gamma API:** Returns "Will Joe Biden get Coronavirus before the election?" (condition_id mismatch issue)
- **Note:** C1 investigated this market in depth (Task 2 of Phase 2B)

### 3. Will Trump sell over 100k Gold Cards in 2025?
- **Condition ID:** `0xbff3fad6e9c96b6e3714c52e6d916b1ffb0f52cdfdb77c7fb153a8ef1ebff608`
- **Dome Stats:**
  - Trades: 3
  - Shares: 2,789.14
  - Avg Price: 0.991
- **Our Data:** NOT FOUND

### 4. Will Elon cut the budget by at least 10% in 2025?
- **Condition ID:** `0xe9c127a8c35f045d37b5344b0a36711084fa20c2fc1618bf178a5386f90610be`
- **Dome Stats:**
  - Trades: 1
  - Shares: 100.00
  - Avg Price: 0.987
- **Our Data:** NOT FOUND

### 5. Will a US ally get a nuke in 2025?
- **Condition ID:** `0xce733629b3b1bea0649c9c9433401295eb8e1ba6d572803cb53446c93d28cd44`
- **Dome Stats:**
  - Trades: 1
  - Shares: 1.00
  - Avg Price: 0.964
- **Our Data:** NOT FOUND

### 6. Will China unban Bitcoin in 2025?
- **Condition ID:** `0xfc4453f83b30fdad8ac707b7bd11309aa4c4c90d0c17ad0c4680d4142d4471f7`
- **Dome Stats:**
  - Trades: 1
  - Shares: 1.00
  - Avg Price: 0.954
- **Our Data:** NOT FOUND

---

## Aggregate Stats for 6 Ghost Markets

| Metric | Value |
|--------|-------|
| **Total Trades** | 21 |
| **Total Shares** | 23,890.13 |
| **Estimated P&L Impact** | ~$20-30K (portion of $44K gap) |

**Target Wallet:**
- **EOA:** `0xcce2b7c71f21e358b8e5e797e586cbc03160d58b` (xcnstrategy)
- **Proxy:** `0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723` (also has zero data)

---

## Summary of C1's Prior Investigation Phases

### Phase 1: Polymarket API Attempt (BLOCKED)
**Date:** 2025-11-15
**Status:** ❌ BLOCKED on authentication

**What C1 tried:**
- Attempted to fetch trades from Polymarket CLOB API (`/trades`, `/events` endpoints)
- All 6 condition_ids returned "Will Joe Biden get Coronavirus" in Gamma API (condition_id mismatch mystery)
- CLOB API requires authentication (401 Unauthorized)

**Findings:**
- Cannot use CLOB API without auth keys
- Gamma API has condition_id mapping issues for these markets
- Recommended pivot to alternative data sources

**Files Created:**
- `PHASE1_AMM_PROOF_BLOCKER_REPORT.md`
- `scripts/113-fetch-amm-trades-from-api.ts` (skeleton only)

---

### Phase 1B: Blockchain Investigation (INCOMPLETE)
**Date:** 2025-11-15
**Status:** ⚠️ Data not found in our blockchain tables

**What C1 tried:**
- Checked if ghost markets appear in `erc1155_transfers`
- Looked for AMM contract activity in blockchain data

**Findings:**
- Ghost markets NOT in our `erc1155_transfers` table
- No token_id mapping in `ctf_token_map` to query blockchain data
- Suggests markets were never indexed into our mapping tables

**Conclusion:** Our blockchain ingestion also missed these AMM markets

**Files Created:**
- `PHASE1B_BLOCKCHAIN_INVESTIGATION_COMPLETE.md`

---

### Phase 1C: Data Source Options (READY TO EXECUTE)
**Date:** 2025-11-15
**Status:** ✅ Three options identified, awaiting execution

**Options Evaluated:**

**Option 1: Polymarket Subgraph (RECOMMENDED)**
- GraphQL endpoint, no authentication required
- Official Polymarket data
- 1-2 hour implementation
- **Fastest path to validation**

**Option 2: Dune Analytics**
- SQL-queryable, can export CSV
- Free tier available
- 2-4 hour implementation
- ⚠️ May not have AMM data

**Option 3: Dome API**
- Direct source of truth
- Unknown if API access available
- Would require contacting Dome support

**Recommendation:** Start with Polymarket Subgraph (Option 1)

**Files Created:**
- `PHASE1C_DATA_SOURCE_OPTIONS_GUIDE.md`
- Scripts templated but not executed:
  - `scripts/121-import-subgraph-trades.ts`
  - `scripts/122-import-dune-csv.ts`

---

### Phase 2A: Resolution Sync (SUCCESS)
**Date:** 2025-11-15
**Status:** ✅ COMPLETE - 8 markets synced

**What C1 did:**
- Synced resolution status for 8 markets from `gamma_resolved` → `pm_markets`
- 4/8 markets had xcnstrategy trades → added to P&L
- 4/8 markets had zero trades → correctly excluded

**P&L Impact:**
- Added $40,700.58 in realized P&L
- Recovered 47.9% of original $84K gap
- **Huge win!**

**Files Created:**
- `RESOLUTION_SYNC_INVESTIGATION_SUMMARY.md`
- `scripts/111-sync-resolution-status-8-markets.ts`

---

### Phase 2B: Deep Dive on Xi Jinping Market (FINDINGS)
**Date:** 2025-11-15
**Status:** ✅ ROOT CAUSE IDENTIFIED

**What C1 investigated:**
- Deep dive on condition_id `0xf2ce8d...` (Xi Jinping / Biden Coronavirus)
- Checked all tables: pm_markets, pm_trades, clob_fills, gamma_resolved, ctf_token_map
- Queried Polymarket Gamma API

**Critical Discovery:**
```json
{
  "enable_order_book": undefined  // DEFAULTS TO FALSE
  "clob_token_ids": undefined     // NO CLOB DATA
}
```

**Root Cause:** Market is AMM-only (not CLOB)
- Our pipeline is CLOB-centric (Goldsky → clob_fills → pm_trades)
- AMM trades go through different mechanism
- **We have NO AMM ingestion path**

**Recommendation:**
- Phase 1 (Immediate): Use Polymarket Data API to backfill AMM trades for xcnstrategy
- Phase 2 (Long-term): Build AMM contract indexing from blockchain

**Files Created:**
- `PHASE2B_MISSION_COMPLETE_SUMMARY.md`
- `scripts/108-source-coverage-matrix-14-markets.ts`
- `scripts/110-investigate-resolution-status-8-markets.ts`

---

## Current State of ClickHouse Tables

### Core Trade Tables (C1's Domain)
- **`clob_fills`** - 38.9M rows, Aug 21+ only, CLOB-only
- **`pm_trades`** - VIEW over clob_fills + pm_asset_token_map
- **`pm_wallet_market_pnl_resolved`** - VIEW, automatically updated when markets resolve
- **`pm_wallet_pnl_summary`** - VIEW, wallet-level aggregates

### Missing Infrastructure for AMM
- ❌ No `pm_trades_amm` or similar
- ❌ No AMM ingestion scripts
- ❌ No external data source connectors
- ❌ No UNION view combining CLOB + AMM

**This is C2's job to build.**

---

## C2's Mission Scope

### What C2 Must Build

1. **`external_trades_raw` table** - Generic landing zone for non-CLOB trades
   - Accept data from: Dome, Dune, Polymarket Subgraph, Data API
   - Schema: wallet, condition_id, side, shares, price, timestamp, source, etc.

2. **`pm_trades_with_external` view** - UNION of CLOB + external
   - Combines `pm_trades` + projection from `external_trades_raw`
   - C1 can switch PnL views to use this unified source

3. **At least ONE working connector** - Fetch trades and populate `external_trades_raw`
   - Target: xcnstrategy wallet, 6 ghost markets
   - Start with most accessible source (likely Polymarket Subgraph or Dune)
   - Validate against Dome's reported stats (21 trades, 23,890.13 shares)

### What C2 Must NOT Do

- ❌ Modify C1's Phase 1/2 scripts
- ❌ Re-ingest CLOB fills or rewrite clob pipeline
- ❌ Change PnL formulas or calculations
- ❌ Touch `pm_wallet_market_pnl_resolved` or `pm_wallet_pnl_summary` (C1 will update these)

### Success Criteria

1. **`external_trades_raw` table exists** with clean schema
2. **21 trades ingested** for xcnstrategy across 6 ghost markets
3. **23,890.13 shares match** Dome's reported volumes
4. **Validation script** shows P&L gap reduction
5. **Handoff doc** tells C1 how to adopt `pm_trades_with_external`

---

## Recommended Execution Path (Based on C1's Findings)

### Phase 1 (Immediate - 1-2 hours)
**Use Polymarket Subgraph** (C1's recommended Option 1)
- No auth required
- Official Polymarket data
- GraphQL interface
- Fastest validation

### Phase 2 (Backup - 2-4 hours if Phase 1 fails)
**Use Dune Analytics**
- SQL queryable
- Can export CSV
- Free tier available

### Phase 3 (Long-term - days/weeks)
**Build blockchain AMM indexing**
- Source of truth
- Scalable to all wallets
- No API dependencies

---

## External Data Sources - Status Matrix

| Source | Auth Required | Has AMM Data | C1 Tried | Status |
|--------|---------------|--------------|----------|--------|
| **Polymarket CLOB API** | ✅ Yes (blocked) | ❌ No | ✅ Yes | ❌ BLOCKED |
| **Polymarket Gamma API** | ❌ No | ⚠️ Metadata only | ✅ Yes | ⚠️ Condition_id mismatch |
| **Polymarket Subgraph** | ❌ No | ✅ Yes (likely) | ❌ Not yet | 🎯 **RECOMMENDED** |
| **Dune Analytics** | ❌ No (free tier) | ✅ Yes (likely) | ❌ Not yet | ✅ Viable backup |
| **Dome API** | ❓ Unknown | ✅ Yes (confirmed) | ❌ Not yet | ❓ Requires outreach |
| **Our erc1155_transfers** | N/A | ✅ Should have | ✅ Checked | ❌ Markets not indexed |

---

## Files Inherited from C1

**Relevant for C2:**
- `DOME_COVERAGE_INVESTIGATION_REPORT.md` - Full breakdown of 14 missing markets
- `PHASE1_AMM_PROOF_BLOCKER_REPORT.md` - API authentication blockers
- `PHASE1C_DATA_SOURCE_OPTIONS_GUIDE.md` - Three viable options with templates
- `PHASE2B_MISSION_COMPLETE_SUMMARY.md` - AMM root cause identified

**Do NOT modify:**
- C1's Phase 1/2 implementation scripts (scripts/108-122)
- Core table schemas (pm_trades, pm_wallet_market_pnl_resolved, etc.)
- PnL calculation logic

---

## Next Steps for C2

### Immediate (Phase 0 - Complete)
- ✅ Read C1's investigation reports
- ✅ Extract 6 ghost markets and Dome stats
- ✅ Create this bootstrap summary

### Phase 1 (Next - ~30 minutes)
- Define `external_trades_raw` table schema
- Create migration script `scripts/201-create-external-trades-table.ts`
- Document schema in `EXTERNAL_TRADES_SCHEMA.md`

### Phase 2 (~30 minutes)
- Create `pm_trades_with_external` UNION view
- Script: `scripts/202-create-pm-trades-with-external-view.ts`
- Document in `EXTERNAL_TRADES_PIPELINE.md`

### Phase 3 (1-2 hours)
- Implement ONE working connector (Polymarket Subgraph recommended)
- Script: `scripts/203-ingest-[source]-trades.ts`
- Include dry-run mode
- Target: xcnstrategy + 6 ghost markets only

### Phase 4 (30 minutes)
- Run sanity checks (trade count, share volume vs Dome)
- Compute provisional P&L impact
- Write `C2_HANDOFF_FOR_C1.md`

**Total Estimated Time:** 3-4 hours for full mission

---

**Agent:** C2 - External Data Ingestion
**Terminal:** Claude 2
**Status:** Bootstrap Complete, Ready for Phase 1

_Always run backfills with maximum workers without hitting rate limits, with save/crash/stall protection enabled._

_— C2_
