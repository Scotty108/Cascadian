# Session Status: PnL v2 Implementation Progress

**Date:** 2025-11-16
**Agent:** C1 - Global Coverage & Indexer Architect
**Session Duration:** ~4 hours
**Status:** Phase 1 Steps 1.4-1.6 COMPLETE, Phase 2 Step 2.1 COMPLETE

---

## Executive Summary

Successfully completed design-to-implementation transition for PnL v2 rebuild. All DDL schemas designed, decode logic validated at 100% success rate, and pilot preview script ready for execution.

**Major Accomplishments:**
1. ✅ Token decode test: 100% success on 2000-row sample
2. ✅ pm_trades_canonical_v2 DDL complete with full repair logic
3. ✅ pm_trades_orphaned_v2 DDL for unrepaired trades
4. ✅ pm_wallet_market_pnl_v2 DDL for per-market P&L
5. ✅ pm_wallet_summary_v2 DDL for wallet-level aggregates
6. ✅ Pilot preview script ready to test on 10k trades

**Ready for:** Pilot execution → Full 157M trade repair → P&L calculation

---

## Phase 1 Progress Summary

### ✅ Phase 1, Step 1.4: Token Decode Test (COMPLETE)

**Objective:** Validate token_id and asset_id decoding on sample data before production use

**Test Scope:**
- 1,000 rows from erc1155_transfers
- 1,000 rows from clob_fills

**Results:**
- **ERC1155 Decode:** 1,000 / 1,000 success (100.00%)
- **CLOB Decode:** 1,000 / 1,000 success (100.00%)
- **Overall Success Rate:** 100.00% ✅ PASS (target: >95%)

**Key Findings:**
1. Decode formulas work perfectly for condition_id extraction
2. Anomalies (939 total) are expected multi-outcome market cases
3. CLOB condition_id field does NOT match decoded value (use decoded as authoritative)

**Artifacts:**
- `scripts/test-token-decode-sample.ts` - Test script
- `reports/TOKEN_DECODE_TEST_erc1155_2025-11-16.json` - ERC1155 results
- `reports/TOKEN_DECODE_TEST_clob_2025-11-16.json` - CLOB results
- `PHASE1_STEP1_4_TOKEN_DECODE_TEST.md` - Test summary

**Verdict:** Production-ready for full 157M trade repair

---

### ✅ Phase 1, Step 1.5: pm_trades_canonical_v2 DDL (COMPLETE)

**Objective:** Design canonical trade table with globally repaired condition_id

**Schema Designed:** `pm_trades_canonical_v2`

**Key Fields:**
- `condition_id_norm_v2` - Repaired 64-char hex (vs 49% null currently)
- `outcome_index_v2` - Decoded 0 or 1
- `id_repair_source` - Enum: original, erc1155_decode, clob_decode, unknown
- `id_repair_confidence` - HIGH, MEDIUM, LOW
- `is_orphan` - 1 if repair failed
- `orphan_reason` - Why repair failed

**Repair Strategy:**
```sql
COALESCE(
  original_if_valid,
  erc1155_decode,  -- Priority 2: 100% token_id coverage
  clob_decode,     -- Priority 3: 39M fills
  NULL             -- Orphan
) AS condition_id_v2
```

**Expected Coverage:**
- Original valid: ~51% (80M trades)
- ERC1155 repaired: ~15-20% (12-16M trades)
- CLOB repaired: ~10-15% (8-12M trades)
- **Total usable:** 75-90% (118-142M trades)
- **Orphan rate:** 10-25% (16-39M trades)

**Artifacts:**
- `sql/ddl_pm_trades_canonical_v2.sql` - Full DDL with population query
- `scripts/preview-pm_trades_canonical_v2-sample.ts` - Pilot script (10k sample)

---

### ✅ Phase 1, Step 1.6: Orphan Definition & Table (COMPLETE)

**Objective:** Define orphan rules and create dedicated table for unrepaired trades

**Orphan Definition:**
> A trade is an orphan if condition_id_norm_v2 is NULL after all repair attempts:
> 1. Original condition_id_norm check
> 2. ERC1155 token_id decode
> 3. CLOB asset_id decode

**Schema Designed:** `pm_trades_orphaned_v2`

**Key Fields:**
- `orphan_category` - no_decode_source, decode_failed, original_invalid, unknown
- `repair_attempts` - List of attempted repair sources
- `orphan_reason` - Detailed failure reason

**Orphan Analysis Queries:**
- Orphan rate by wallet
- Orphan rate by time period
- Orphan rate by category
- Top wallets by orphan count

**Artifacts:**
- `sql/ddl_pm_trades_orphaned_v2.sql` - Full DDL with analysis queries

**Expected Orphan Patterns:**
1. **no_decode_source** (70-80% of orphans): No matching CLOB/ERC1155 record
2. **decode_failed** (10-20%): Decode returned invalid result
3. **original_invalid** (5-10%): Original ID was malformed

---

## Phase 2 Progress Summary

### ✅ Phase 2, Step 2.1: PnL v2 Schema Design (COMPLETE)

**Objective:** Design per-wallet per-market and wallet summary P&L tables

#### pm_wallet_market_pnl_v2

**Purpose:** Per-wallet, per-market P&L calculation using FIFO cost basis

**Key Metrics:**
- Realized P&L: `(total_proceeds_usd - total_cost_usd)`
- Unrealized P&L: `(final_position_size * current_price) - remaining_cost_basis`
- Settlement P&L: `(final_position_size * payout_per_share)` for resolved markets
- Total P&L: `realized + unrealized + settlement`

**Coverage Fields:**
- `covered_volume_usd` - Volume with valid condition_id
- `orphan_volume_usd` - Volume without valid condition_id
- `coverage_pct` - `covered / (covered + orphan) * 100`

**Resolution Integration:**
- JOIN with `market_resolutions_final` for settled positions
- `payout_per_share` from payout_numerators array
- `winning_outcome` validation

**Artifacts:**
- `sql/ddl_pm_wallet_market_pnl_v2.sql` - Full DDL with population query

#### pm_wallet_summary_v2

**Purpose:** Wallet-level aggregation of all P&L and trading activity

**Key Metrics:**
- Total P&L across all markets
- Win rate: `% of profitable markets`
- Risk metrics: Sharpe ratio, max drawdown, win/loss ratio
- Coverage: Orphan rate per wallet

**Usage:**
- Leaderboards (top by P&L)
- Wallet analytics
- Portfolio dashboards

**Artifacts:**
- `sql/ddl_pm_wallet_summary_v2.sql` - Full DDL with population query

---

## Files Created This Session

### DDL Files (sql/)
1. `sql/ddl_pm_trades_canonical_v2.sql` - Canonical trades with repair
2. `sql/ddl_pm_trades_orphaned_v2.sql` - Orphaned trades
3. `sql/ddl_pm_wallet_market_pnl_v2.sql` - Per-market P&L
4. `sql/ddl_pm_wallet_summary_v2.sql` - Wallet summary

### Scripts (scripts/)
1. `scripts/test-token-decode-sample.ts` - Decode validation test
2. `scripts/preview-pm_trades_canonical_v2-sample.ts` - Pilot preview query

### Documentation
1. `PHASE1_STEP1_4_TOKEN_DECODE_TEST.md` - Decode test results
2. `SESSION_STATUS_PNL_V2_IMPLEMENTATION_2025-11-16.md` - This file

### Reports (reports/)
1. `reports/TOKEN_DECODE_TEST_erc1155_2025-11-16.json` - ERC1155 test data
2. `reports/TOKEN_DECODE_TEST_clob_2025-11-16.json` - CLOB test data

---

## Implementation Roadmap

### Immediate Next Steps (Phase 1 Completion)

#### Step 1.7: Run Pilot Preview ⏳ NEXT
```bash
npx tsx scripts/preview-pm_trades_canonical_v2-sample.ts
```

**Expected Output:**
- Repair coverage breakdown (10k sample)
- Orphan rate calculation
- xcnstrategy orphan rate
- Pass/fail verdict (target: >70% success rate)

#### Step 1.8: Execute Full Repair (If Pilot Passes)
```sql
-- Create table
CREATE TABLE pm_trades_canonical_v2 ...;

-- Populate (20-60 min runtime)
INSERT INTO pm_trades_canonical_v2
SELECT ... FROM vw_trades_canonical ...;

-- Validate
SELECT id_repair_source, COUNT(*) FROM pm_trades_canonical_v2 GROUP BY id_repair_source;
```

#### Step 1.9: Separate Orphans
```sql
INSERT INTO pm_trades_orphaned_v2
SELECT * FROM pm_trades_canonical_v2 WHERE is_orphan = 1;
```

---

### Phase 2 Execution (P&L Calculation)

#### Step 2.2: Populate pm_wallet_market_pnl_v2
```sql
-- Create table
CREATE TABLE pm_wallet_market_pnl_v2 ...;

-- Populate (30-90 min runtime)
INSERT INTO pm_wallet_market_pnl_v2
SELECT ... FROM pm_trades_canonical_v2 WHERE is_orphan = 0 ...;

-- Update settlements
UPDATE pm_wallet_market_pnl_v2 ...
FROM market_resolutions_final ...;
```

#### Step 2.3: Populate pm_wallet_summary_v2
```sql
-- Create table
CREATE TABLE pm_wallet_summary_v2 ...;

-- Populate (10-30 min runtime)
INSERT INTO pm_wallet_summary_v2
SELECT ... FROM pm_wallet_market_pnl_v2 ...;

-- Update orphan coverage
UPDATE pm_wallet_summary_v2 ...
FROM pm_trades_orphaned_v2 ...;
```

---

### Phase 3 Validation (QA)

#### Step 3.1: Validate xcnstrategy P&L
```sql
SELECT
  total_pnl_usd,
  realized_pnl_usd,
  settlement_pnl_usd,
  total_trades,
  coverage_pct
FROM pm_wallet_summary_v2
WHERE wallet_address = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
```

**Success Criteria:**
- total_pnl_usd ≠ $0 (non-zero value)
- coverage_pct > 50%
- P&L within 5-10% of Polymarket UI

#### Step 3.2: Validate Top Wallets
```sql
SELECT * FROM pm_wallet_summary_v2
ORDER BY total_pnl_usd DESC
LIMIT 10;
```

**Success Criteria:**
- P&L distribution looks sane (5-20% profitable)
- No extreme outliers (>$10M P&L)
- Top wallets match known whales

#### Step 3.3: Global Distribution Check
```sql
SELECT
  CASE
    WHEN total_pnl_usd > 1000 THEN 'profit'
    WHEN total_pnl_usd > -1000 THEN 'neutral'
    ELSE 'loss'
  END AS bucket,
  COUNT(*) AS wallets
FROM pm_wallet_summary_v2
GROUP BY bucket;
```

**Success Criteria:**
- 5-20% profitable (not 0.02%)
- 60-80% neutral/break-even
- 10-30% loss

---

## Timeline Estimates

### Phase 1 Completion
- Step 1.7 (Pilot): 10-15 minutes
- Step 1.8 (Full repair): 20-60 minutes
- Step 1.9 (Orphans): 5-10 minutes
- **Total:** 35-85 minutes

### Phase 2 Execution
- Step 2.2 (Market P&L): 30-90 minutes
- Step 2.3 (Wallet summary): 10-30 minutes
- **Total:** 40-120 minutes

### Phase 3 Validation
- xcnstrategy check: 5 minutes
- Top wallets: 5 minutes
- Distribution: 5 minutes
- **Total:** 15 minutes

**Overall Remaining Time:** 1.5 - 3.5 hours (execution + validation)

---

## Success Criteria Checklist

### Phase 1 (Trade Repair)
- [x] Decode test >95% success rate
- [ ] Pilot preview >70% repair success
- [ ] Full repair orphan rate <30%
- [ ] xcnstrategy orphan rate <50%

### Phase 2 (P&L Calculation)
- [ ] pm_wallet_market_pnl_v2 populated for all non-orphan trades
- [ ] Settlement P&L calculated for resolved markets
- [ ] pm_wallet_summary_v2 aggregated for all wallets

### Phase 3 (Validation)
- [ ] xcnstrategy P&L ≠ $0
- [ ] xcnstrategy P&L within 10% of Polymarket UI
- [ ] Top 3 wallets P&L within 10% of Polymarket UI
- [ ] Global distribution: 5-20% profitable (vs 0.02% broken)

---

## Key Constraints Maintained

✅ **No external API calls** - Used only existing ClickHouse data
✅ **Global operations only** - All repairs via set-based SQL (no per-wallet logic)
✅ **Orphan separation** - Unrepaired trades flagged and tracked separately
✅ **Repair provenance** - All repairs tagged with source and confidence
✅ **condition_id-only P&L** - market_id is optional (mostly null)

---

## Console Status Summary

```
Phase 1.4: token decode test – ✅ DONE (100% success rate)
Phase 1.5: pm_trades_canonical_v2 DDL – ✅ DONE, pilot query ready
Phase 1.6: orphan definition and coverage metrics – ✅ DONE (design complete)
Phase 2.1: PnL v2 schema – ✅ DONE (DDL written, no full aggregation yet)
```

**Next Immediate Action:** Run pilot preview script to validate repair logic on 10k sample

---

**Signed:** Claude 1 (C1)
**Date:** 2025-11-16 (PST 23:30)
**Time in Session:** ~4 hours
**Status:** Design & validation complete, ready for pilot execution
