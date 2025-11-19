# Payout Vector Blockchain Backfill - Execution Plan

**Status:** Ready for execution
**Created:** 2025-11-08
**Effort:** 2-4 hours execution + 30 min validation

---

## Executive Summary

**Problem:** 92% of market resolutions (206K conditions) are missing payout vectors, blocking P&L calculation for 75.6M trades ($8.7B volume).

**Solution:** Query Polygon ConditionalTokens contract to fetch missing `payout_numerators` and `payout_denominator` for each condition_id.

**Impact:** Enables P&L calculation for 91.98% more trades, increasing coverage from 8% to 95%+.

**Timeline:** 1.5-3 hours with 8 workers @ 80 RPC calls/sec

---

## 1. Data Source Identified

### ConditionalTokens Contract (Polygon)

**Contract Address:** `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045`
**Network:** Polygon (Matic)
**RPC Endpoint:** Alchemy (`ALCHEMY_POLYGON_RPC_URL`)

### Contract Methods

**Function 1: Get Payout Denominator**
```solidity
function payoutDenominator(bytes32 conditionId) external view returns (uint256)
```
- **Signature:** `0x4d61dd2c`
- **Returns:** Denominator for payout fraction (typically 1 for standard markets)

**Function 2: Get Payout Numerators**
```solidity
function payoutNumerators(bytes32 conditionId, uint256 index) external view returns (uint256)
```
- **Signature:** `0x8f27e1fc`
- **Returns:** Numerator for outcome at `index` (1 = winner, 0 = loser)
- **Must call once per outcome** (binary markets = 2 calls, multi-outcome = N calls)

### Example for Binary Market

**Condition:** `ed22fdc615d758738862f4361b414e1f00720c08a1e59f95d77fc5d77217dfab`
**Winning outcome:** "No" (index 1)

```javascript
// Call 1: Get denominator
eth_call({
  to: "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045",
  data: "0x4d61dd2c" + "ed22fdc615d758738862f4361b414e1f00720c08a1e59f95d77fc5d77217dfab"
})
// Returns: 0x0000000000000000000000000000000000000000000000000000000000000001 (1)

// Call 2: Get numerator for outcome 0
eth_call({
  to: "0x4D97DCd97eEC945f40cF65F87097ACe5EA0476045",
  data: "0x8f27e1fc" + "ed22fdc615d758738862f4361b414e1f00720c08a1e59f95d77fc5d77217dfab" + "0000000000000000000000000000000000000000000000000000000000000000"
})
// Returns: 0x0000000000000000000000000000000000000000000000000000000000000000 (0)

// Call 3: Get numerator for outcome 1
eth_call({
  to: "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045",
  data: "0x8f27e1fc" + "ed22fdc615d758738862f4361b414e1f00720c08a1e59f95d77fc5d77217dfab" + "0000000000000000000000000000000000000000000000000000000000000001"
})
// Returns: 0x0000000000000000000000000000000000000000000000000000000000000001 (1)

// Result: payout_numerators = [0, 1], payout_denominator = 1
// P&L formula: shares * (1/1) - cost_basis (for "No" holders)
```

---

## 2. RPC Strategy

### Parallelization Approach

**Workers:** 8 parallel workers
**RPC Rate:** 80 calls/sec total (10 calls/sec per worker)
**Rate Limiting:** 100ms sleep between calls (configurable via `RPC_SLEEP` env var)

### RPC Call Estimates

**Conditions to backfill:** ~206,000 unique condition_ids
**Calls per condition:**
- Binary markets (80% estimated): 3 calls (1 denominator + 2 numerators)
- Multi-outcome markets (20% estimated): 4-6 calls (1 denominator + 3-5 numerators)

**Total calls:** 206K × 3 avg = **618,000 RPC calls**

**Timeline:**
- @ 80 calls/sec: 618K / 80 = **2.1 hours**
- With retries and overhead: **2.5-3 hours**

### Alchemy Rate Limits

**Alchemy Tier:** Growth plan
**Rate Limit:** 100 requests/sec
**Our Usage:** 80 calls/sec (20% buffer)
**Cost:** Free tier covers ~2.5M calls/month (618K is well within limits)

---

## 3. Implementation Script

**Location:** `/Users/scotty/Projects/Cascadian-app/scripts/backfill-payout-vectors-blockchain.ts`

### Features

**Apply Skills:**
- **IDN** (ID Normalization): Normalize condition_id to lowercase 64-char hex
- **AR** (Atomic Rebuild): CREATE TABLE AS SELECT + RENAME pattern
- **GATE** (Quality Gate): Validate coverage >= 95% threshold
- **PNL** (P&L Formula): Enable payout vector formula for 75.6M trades

**Architecture:**
1. **Fetch Phase**: Query ClickHouse for conditions with missing payout data
2. **RPC Phase**: Parallel workers call ConditionalTokens contract methods
3. **Staging Phase**: Insert results into `market_resolutions_payout_backfill` table
4. **Merge Phase**: Atomic swap with original `market_resolutions_final` table
5. **Validation Phase**: Verify coverage increased to 95%+

**Error Handling:**
- Retry logic for RPC timeouts
- Checkpoint progress every 500 inserts
- Continue on failure (log and skip unresolvable conditions)
- Graceful worker shutdown on SIGINT

**Monitoring:**
- Progress reports every 1000 conditions
- Success/failure counters
- Elapsed time tracking
- Coverage metrics

---

## 4. Execution Plan

### Pre-flight Checklist

**Environment Variables (`.env.local`):**
```bash
ALCHEMY_POLYGON_RPC_URL=https://polygon-mainnet.g.alchemy.com/v2/YOUR_API_KEY
CLICKHOUSE_HOST=https://your-clickhouse-host:8443
CLICKHOUSE_PASSWORD=your_password
CLICKHOUSE_DATABASE=default

# Optional tuning
WORKER_COUNT=8           # Default: 8 workers
RPC_SLEEP=100           # Default: 100ms between calls
```

**ClickHouse Access:**
- Verify connection to ClickHouse Cloud
- Ensure `market_resolutions_final` table exists
- Check current coverage: Should be ~8% with payout data

**RPC Access:**
- Test Alchemy endpoint is responding
- Verify API key is valid
- Check rate limits

### Execution Steps

**Step 1: Dry Run (5 minutes)**
```bash
npx tsx scripts/backfill-payout-vectors-blockchain.ts
```
- Validates environment variables
- Shows estimated RPC calls and timeline
- No data changes

**Step 2: Execute Backfill (2-3 hours)**
```bash
npx tsx scripts/backfill-payout-vectors-blockchain.ts --execute
```
- Creates staging table `market_resolutions_payout_backfill`
- Fetches 206K conditions from ClickHouse
- Queries ConditionalTokens contract for each condition
- Inserts payout data to staging table
- Performs atomic swap
- Validates coverage

**Step 3: Monitor Progress**
```bash
# Progress logged to console
# Expected output:
[Progress] 10.5% | Success: 21,630 | Failures: 184
[Progress] 25.8% | Success: 53,148 | Failures: 402
...
[Worker 1] ✅ Complete: 25,750 successful fetches
[Worker 2] ✅ Complete: 25,750 successful fetches
...
```

**Step 4: Validate Results (5 minutes)**
```sql
-- Check coverage
SELECT
  COUNT(*) as total_resolutions,
  SUM(CASE WHEN length(payout_numerators) > 0 AND payout_denominator > 0 THEN 1 ELSE 0 END) as has_payout,
  (has_payout / total_resolutions * 100) as coverage_pct
FROM market_resolutions_final

-- Expected result:
-- total_resolutions: 224,396
-- has_payout: ~213,000 (95%)
-- coverage_pct: 95.0%
```

### Rollback Plan

If backfill fails or produces incorrect data:

**Option 1: Abort before atomic swap**
- Kill script (Ctrl+C)
- Staging table `market_resolutions_payout_backfill` will remain
- Original `market_resolutions_final` untouched
- Can re-run with fixed parameters

**Option 2: Restore from backup (if atomic swap completed)**
```sql
-- ClickHouse keeps old table as market_resolutions_final_old until explicitly dropped
RENAME TABLE
  market_resolutions_final TO market_resolutions_final_failed,
  market_resolutions_final_old TO market_resolutions_final
```

---

## 5. Integration & Validation

### Post-Backfill Tasks

**Task 1: Verify P&L Coverage (5 minutes)**
```sql
-- Apply PNL + CAR (ClickHouse Array Rule) skills
SELECT
  COUNT(*) as total_trades,
  SUM(CASE WHEN
    r.condition_id_norm IS NOT NULL
    AND length(r.payout_numerators) > 0
    AND r.payout_denominator > 0
  THEN 1 ELSE 0 END) as pnl_calculable,
  (pnl_calculable / total_trades * 100) as coverage_pct
FROM trades_raw t
LEFT JOIN market_resolutions_final r
  ON lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
WHERE t.condition_id != ''

-- Expected: coverage_pct should be ~92-95% (up from 8%)
```

**Task 2: Spot Check Sample Markets (10 minutes)**
```sql
-- Verify a known resolved market has correct payout data
SELECT
  condition_id_norm,
  winning_index,
  winning_outcome,
  payout_numerators,
  payout_denominator
FROM market_resolutions_final
WHERE condition_id_norm = 'ed22fdc615d758738862f4361b414e1f00720c08a1e59f95d77fc5d77217dfab'

-- Expected for "No" winner (index 1):
-- payout_numerators: [0, 1]
-- payout_denominator: 1
```

**Task 3: Test P&L Calculation (10 minutes)**
```sql
-- Apply PNL skill with sample wallet
SELECT
  wallet_address,
  COUNT(*) as trades,
  SUM(shares) as total_shares,
  SUM(usd_value) as total_cost,
  SUM((shares * arrayElement(r.payout_numerators, r.winning_index + 1) / r.payout_denominator) - usd_value) as realized_pnl
FROM trades_raw t
INNER JOIN market_resolutions_final r
  ON lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
WHERE wallet_address = '0x8e9eedf20dfa70956d49f608a205e402d9df38e4'
  AND t.condition_id != ''
  AND length(r.payout_numerators) > 0
GROUP BY wallet_address

-- Should return: Non-zero P&L value (validate against known wallet performance)
```

### Success Criteria (Apply GATE skill)

**Coverage Gate:**
- ✅ Payout coverage >= 95% of resolutions
- ✅ Can calculate P&L for >= 92% of trades with condition_id

**Data Quality Gate:**
- ✅ No payout_denominator = 0 (except genuinely unresolved markets)
- ✅ payout_numerators array length matches outcome_count
- ✅ Sum of payout_numerators equals payout_denominator (for resolved markets)

**Performance Gate:**
- ✅ P&L queries complete in < 5 seconds for single wallet
- ✅ No degradation in query performance vs existing 8% coverage

---

## 6. Recovery Rate Estimate

### Expected Outcomes

**Best Case (95-98% recovery):**
- All resolved markets on blockchain have payout data
- Minor failures due to network errors (retry resolves)
- Final coverage: 95-98% of resolutions

**Realistic Case (92-95% recovery):**
- Some markets resolved off-chain (e.g., early beta markets)
- Some markets with exotic payout structures
- Final coverage: 92-95% of resolutions

**Worst Case (85-90% recovery):**
- Significant portion of markets pre-date ConditionalTokens contract
- Network instability during backfill
- Final coverage: 85-90% of resolutions
- **Mitigation:** Re-run backfill for failed conditions, or use API fallback

### Fallback Strategy

If blockchain recovery < 90%, use **Option B: Reconstruct from Winning Outcome**

```sql
-- For binary markets with known winner but missing payout:
CREATE OR REPLACE VIEW market_resolutions_complete AS
SELECT
  condition_id_norm,
  winning_index,
  winning_outcome,
  -- Reconstruct binary market payouts (Apply PNL skill)
  CASE
    WHEN length(payout_numerators) > 0 THEN payout_numerators
    WHEN outcome_count = 2 AND winning_index = 0 THEN [1, 0]
    WHEN outcome_count = 2 AND winning_index = 1 THEN [0, 1]
    ELSE payout_numerators
  END as payout_numerators,
  CASE
    WHEN payout_denominator > 0 THEN payout_denominator
    WHEN outcome_count = 2 THEN 1
    ELSE payout_denominator
  END as payout_denominator
FROM market_resolutions_final
```

This adds another 3-5% coverage for binary markets where blockchain call failed.

---

## 7. Effort Estimate

### Time Breakdown

| Phase | Duration | Notes |
|-------|----------|-------|
| **Setup & Validation** | 15 min | Verify environment, test RPC connection |
| **Dry Run** | 5 min | Confirm configuration and estimates |
| **Backfill Execution** | 2-3 hours | Main blockchain query phase |
| **Atomic Swap** | 2 min | Table merge and rename |
| **Post-Validation** | 15 min | Coverage checks, spot testing |
| **P&L Integration** | 30 min | Update queries, test dashboard |
| **TOTAL** | **3-4 hours** | End-to-end with monitoring |

### Resource Requirements

**Human Time:**
- Initial setup: 15 minutes
- Monitoring: Check progress every 30 min (4-6 check-ins)
- Validation: 30 minutes

**Compute Resources:**
- RPC calls: 618K calls (~$0 on Alchemy free tier)
- ClickHouse storage: +50MB for staging table
- CPU: Minimal (network I/O bound)

---

## 8. Post-Backfill Benefits

### Immediate Impact

**P&L Coverage:** 8% → 95%+
- **Before:** 6.6M trades, $1.55B volume
- **After:** 82.2M trades, $10.3B volume
- **Increase:** +75.6M trades, +$8.7B volume

**Dashboard Enhancement:**
- Wallet P&L now accurate for 95% of users
- Market-level P&L available
- Historical performance tracking enabled

**Data Quality:**
- Single source of truth for payout vectors
- Blockchain-verified resolution data
- Reduced dependency on API data

### Downstream Dependencies

**Enables:**
1. ✅ Wallet ranking by realized P&L
2. ✅ Smart money detection (profit-based metrics)
3. ✅ Market performance analysis
4. ✅ Strategy backtesting with accurate returns
5. ✅ User portfolio tracking

**Unblocks:**
- ERC1155 backfill (needs payout data for validation)
- Wallet metrics calculation (omega ratio, Sharpe ratio)
- Market resolution verification

---

## 9. Risk Assessment

### Technical Risks

**Risk 1: RPC Rate Limiting**
- **Probability:** Low
- **Impact:** Medium (increases execution time)
- **Mitigation:** Built-in 100ms sleep between calls, configurable via `RPC_SLEEP`

**Risk 2: ClickHouse Write Failures**
- **Probability:** Low
- **Impact:** Medium (data loss for batch)
- **Mitigation:** Use staging table, atomic swap, keep old table until validation

**Risk 3: Network Instability**
- **Probability:** Medium
- **Impact:** Low (script continues from last checkpoint)
- **Mitigation:** Batch inserts every 500 rows, log failures, can re-run

**Risk 4: Incorrect Payout Data**
- **Probability:** Low
- **Impact:** High (incorrect P&L calculations)
- **Mitigation:** Spot check known markets, validate against API data, user reports

### Data Quality Risks

**Risk 1: Unresolved Markets**
- **Description:** Some condition_ids may not be resolved on-chain yet
- **Mitigation:** `payoutDenominator` returns 0 for unresolved markets, script skips these

**Risk 2: Exotic Market Structures**
- **Description:** Non-standard payout structures (e.g., scalar markets)
- **Mitigation:** Fetch actual numerators from contract (no assumptions)

**Risk 3: Historical Markets**
- **Description:** Very old markets may predate ConditionalTokens contract
- **Mitigation:** Fallback to reconstruction for binary markets, manual review for others

---

## 10. Next Steps

### Immediate (After Backfill)

1. **Update P&L Queries** (30 min)
   - Modify existing queries to use new payout data
   - Remove 8% coverage disclaimer from dashboard
   - Add coverage metrics to admin panel

2. **Rebuild Wallet Metrics** (1-2 hours)
   - Recalculate omega scores with full P&L data
   - Update smart money rankings
   - Refresh dashboard cache

3. **Document Changes** (15 min)
   - Update `RESOLUTION_ANALYSIS_FINAL_REPORT.md` with new coverage numbers
   - Add blockchain backfill to `CLAUDE.md` completed tasks
   - Create changelog entry

### Short-Term (Next Week)

4. **ERC1155 Recovery** (2-5 hours)
   - Backfill empty condition_ids for 78.7M trades
   - Increases coverage from 51% to 95%+ of all trades
   - Uses existing scripts: `scripts/phase2-full-erc1155-backfill-*.ts`

5. **P&L Dashboard V2** (4-8 hours)
   - Build comprehensive wallet P&L view
   - Market-level performance analytics
   - Historical trend charts

6. **Smart Money System V2** (8-12 hours)
   - Profit-based ranking (now possible with full P&L)
   - Win rate and consistency metrics
   - Alpha detection (vs market average)

---

## Appendix: Technical Reference

### ConditionalTokens Contract

**Documentation:** https://docs.gnosis.io/conditionaltokens/
**Polygon Explorer:** https://polygonscan.com/address/0x4D97DCd97eC945f40cF65F87097ACe5EA0476045

### Payout Vector Format

**Standard Binary Market:**
```
winning_index: 1
payout_numerators: [0, 1]
payout_denominator: 1

// Interpretation:
// Outcome 0 ("Yes") payout: 0/1 = 0 (losers get nothing)
// Outcome 1 ("No") payout: 1/1 = 1 (winners get full payout)
```

**Multi-Outcome Market (3 outcomes, outcome 2 wins):**
```
winning_index: 2
payout_numerators: [0, 0, 1]
payout_denominator: 1

// Interpretation:
// Outcome 0 payout: 0/1 = 0
// Outcome 1 payout: 0/1 = 0
// Outcome 2 payout: 1/1 = 1 (winner takes all)
```

**Partial Payouts (rare):**
```
// Example: Market partially resolved (50/50 split due to ambiguity)
winning_index: 0 (arbitrary, both win)
payout_numerators: [1, 1]
payout_denominator: 2

// Interpretation:
// Outcome 0 payout: 1/2 = 0.5 (50% payout)
// Outcome 1 payout: 1/2 = 0.5 (50% payout)
```

### P&L Calculation Formula (Apply PNL + CAR skills)

```sql
-- For a single trade
realized_pnl = (
  shares * arrayElement(payout_numerators, winning_index + 1) / payout_denominator
) - cost_basis

-- Example: Bought 100 shares of "No" for $60, "No" won
-- shares = 100
-- cost_basis = 60
-- winning_index = 1 (for "No")
-- payout_numerators = [0, 1]
-- payout_denominator = 1

realized_pnl = (100 * arrayElement([0,1], 1+1) / 1) - 60
             = (100 * 1 / 1) - 60
             = 100 - 60
             = $40 profit
```

---

**Report Created:** 2025-11-08
**Script Location:** `/Users/scotty/Projects/Cascadian-app/scripts/backfill-payout-vectors-blockchain.ts`
**Execution Command:** `npx tsx scripts/backfill-payout-vectors-blockchain.ts --execute`
**Estimated Completion:** 2025-11-08 (same day, 3-4 hour runtime)
