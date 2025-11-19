# ERC1155 Condition ID Recovery - FINAL ANALYSIS

## Database Architect: Root Cause & Recovery Strategy

**Date:** 2025-11-07
**Status:** CRITICAL DATA QUALITY ISSUE IDENTIFIED
**Scope:** 77.4M trades (48.53% of 159M total) with BOTH empty condition_id AND zero market_id

---

## Executive Summary

### The Real Problem (Not What Was Initially Stated)

**Problem Statement Revision:**
- Original: "77.4M trades have empty condition_id but market_id exists"
- **ACTUAL:** 77.4M trades have BOTH empty condition_id AND zero market_id (100% correlation)
- These trades have trade_id containing "undefined" (e.g., "0xabc...xyz-undefined-maker")
- This is a **data ingestion quality issue**, not a simple missing JOIN problem

**Root Cause Analysis:**
1. These 77.4M trades came from a data source that did NOT provide market_id or condition_id
2. The transaction_hash exists, but blockchain ERC1155 data only covers ~204K of these transactions (0.26% coverage)
3. The pm_trades table (CLOB fills) has only 537 rows and ZERO overlap with empty trades
4. The condition_market_map table has 152K mappings but requires market_id as input (which we don't have)

**Implication:**
ERC1155 recovery will only fix ~200K trades (0.26% of 77.4M), leaving **77.2M trades unrecoverable** via this method.

---

## Phase 1: Data Investigation Results

### What We Know

**trades_raw Statistics:**
```
Total trades:              159,574,259
Empty condition_id:         77,435,673 (48.53%)
Has condition_id:           82,138,586 (51.47%)

Of the 77.4M empty condition_id trades:
- Zero market_id:           77,435,673 (100.00%)
- Non-zero market_id:                0 (0.00%)
```

**ERC1155 Transfer Coverage:**
```
Total ERC1155 transfers:    206,112
Unique tx_hashes:            83,683
Overlap with empty trades:  204,116 transfers (99.0%)
```

**Cardinality Patterns:**
```
Trades per transaction_hash (empty condition_id):
  2 trades:  26M transactions (82.5%)
  3 trades:  3.5M transactions (11.1%)

ERC1155 transfers per tx_hash:
  2 transfers: 66,520 transactions (79.5%)
  3 transfers:  9,856 transactions (11.8%)
```

**Sample Empty Trade:**
```json
{
  "trade_id": "0xec8f...8e55-undefined-maker",
  "wallet_address": "0x0000...a168",
  "market_id": "0x0000000000000000000000000000000000000000000000000000000000000000",
  "condition_id": "",
  "transaction_hash": "0xec8f...8e55",
  "side": "NO",
  "shares": 2.5,
  "usd_value": 5,
  "timestamp": "2024-03-09 17:41:07"
}
```

**Key Observations:**
1. Trade_id contains "undefined" → suggests missing order_id during ingestion
2. Market_id is all zeros → data source didn't provide market metadata
3. Transaction_hash exists → blockchain event was captured, but market context was lost

---

## Phase 2: ERC1155 Recovery Strategy (LIMITED SCOPE)

### What ERC1155 CAN Recover

**Coverage:** ~200K trades (0.26% of 77.4M empty)

**Method:** Extract condition_id from ERC1155 token_id field using:
```
condition_id = substring(lower(replaceAll(token_id, '0x', '')), 1, 64)
```

**Matching Strategy:**
1. Match on (transaction_hash + wallet_address)
2. Deduplicate using ROW_NUMBER ranking by amount proximity
3. Validate against market_resolutions_final

### SQL Implementation - ERC1155 Recovery ONLY

```sql
-- ========================================
-- ERC1155 Condition ID Recovery
-- ========================================
-- SCOPE: Recovers ~200K trades (0.26% of empty)
-- RUNTIME: ~5 minutes
-- CONFIDENCE: HIGH (95%) for matched rows
-- ========================================

-- Step 1: Build ERC1155 recovery mapping
CREATE TABLE erc1155_condition_recovery AS
WITH erc1155_extracted AS (
  SELECT
    tx_hash,
    log_index,
    to_address as wallet_address,
    -- IDN: ID Normalization - extract first 64 hex chars as condition_id
    substring(lower(replaceAll(token_id, '0x', '')), 1, 64) as condition_id_extracted,
    -- Normalize token value to shares (convert from wei)
    toDecimal128(value, 0) / 1000000.0 as token_amount_shares,
    block_timestamp
  FROM erc1155_transfers
  WHERE
    -- Filter out zero/null token addresses
    token_id != '0x0000000000000000000000000000000000000000000000000000000000000040'
    AND token_id != ''
    -- Only process transfers TO wallets (receiving tokens)
    AND to_address != '0x0000000000000000000000000000000000000000'
),

trades_empty AS (
  SELECT
    transaction_hash,
    wallet_address,
    trade_id,
    shares,
    usd_value,
    timestamp
  FROM trades_raw
  WHERE condition_id = ''
),

-- JD: Join Discipline - match on normalized tx_hash + wallet
matched_with_ranking AS (
  SELECT
    t.transaction_hash,
    t.wallet_address,
    t.trade_id,
    t.shares as trade_shares,
    e.condition_id_extracted,
    e.token_amount_shares,
    -- Calculate amount proximity for ranking
    abs(t.shares - e.token_amount_shares) as amount_diff,
    -- CAR: ClickHouse Array Rule - ROW_NUMBER for deduplication
    ROW_NUMBER() OVER (
      PARTITION BY t.transaction_hash, t.wallet_address, t.trade_id
      ORDER BY
        abs(t.shares - e.token_amount_shares) ASC,  -- Closest amount match first
        e.log_index ASC                              -- Earlier log if tie
    ) as match_rank
  FROM trades_empty t
  INNER JOIN erc1155_extracted e ON (
    lower(t.transaction_hash) = lower(e.tx_hash) AND
    lower(t.wallet_address) = lower(e.wallet_address)
  )
)

-- Take only best match per trade
SELECT
  transaction_hash,
  wallet_address,
  trade_id,
  condition_id_extracted as recovered_condition_id,
  trade_shares,
  token_amount_shares,
  amount_diff,
  'erc1155' as recovery_method,
  now() as recovered_at
FROM matched_with_ranking
WHERE match_rank = 1;

-- ========================================
-- GATE 1: Validate recovery quality
-- ========================================
SELECT
  count() as total_recovered,
  -- Validate against market_resolutions_final
  countIf(recovered_condition_id IN (
    SELECT DISTINCT lower(replaceAll(condition_id, '0x', ''))
    FROM market_resolutions_final
  )) as validated_against_resolutions,
  100.0 * validated_against_resolutions / total_recovered as validation_pct,
  -- Amount matching quality
  avg(amount_diff) as avg_amount_diff,
  quantile(0.50)(amount_diff) as median_amount_diff,
  quantile(0.95)(amount_diff) as p95_amount_diff,
  -- Amount diff should be LOW (< 1.0 shares) for high confidence
  countIf(amount_diff < 1.0) as close_amount_matches,
  100.0 * close_amount_matches / total_recovered as pct_close_matches
FROM erc1155_condition_recovery;

-- EXPECTED RESULTS:
-- total_recovered:            ~200,000
-- validation_pct:             >90%
-- avg_amount_diff:            <5.0
-- pct_close_matches:          >80%

-- STOP IF:
-- validation_pct < 85% → ERC1155 data quality issue
-- pct_close_matches < 70% → Amount matching not reliable

-- ========================================
-- GATE 2: Check for duplicates
-- ========================================
SELECT
  count() as total_recoveries,
  uniq(transaction_hash, wallet_address, trade_id) as unique_trades,
  count() - unique_trades as duplicates
FROM erc1155_condition_recovery;

-- DUPLICATES MUST BE 0
-- If duplicates > 0, ROW_NUMBER ranking failed → STOP AND DEBUG

-- ========================================
-- Step 2: Apply recovery (ATOMIC REBUILD)
-- ========================================
-- AR: Atomic Rebuild - CREATE + RENAME pattern

CREATE TABLE trades_raw_erc1155_recovered AS
SELECT
  -- All original fields
  t.trade_id,
  t.wallet_address,
  t.market_id,
  t.timestamp,
  t.side,
  t.entry_price,
  t.exit_price,
  t.shares,
  t.usd_value,
  t.pnl,
  t.is_closed,
  t.transaction_hash,
  t.created_at,
  t.close_price,
  t.fee_usd,
  t.slippage_usd,
  t.hours_held,
  t.bankroll_at_entry,
  t.outcome,
  t.fair_price_at_entry,

  -- Apply recovery: use recovered condition_id if available, otherwise keep original
  COALESCE(r.recovered_condition_id, t.condition_id) as condition_id,

  -- Track recovery metadata
  r.recovery_method as condition_id_recovery_method,
  r.recovered_at as condition_id_recovered_at
FROM trades_raw t
LEFT JOIN erc1155_condition_recovery r ON (
  t.transaction_hash = r.transaction_hash AND
  t.wallet_address = r.wallet_address AND
  t.trade_id = r.trade_id
);

-- ========================================
-- GATE 3: Verify recovery results
-- ========================================
SELECT
  count() as total_trades,
  countIf(condition_id = '') as still_empty,
  countIf(condition_id != '') as now_filled,
  100.0 * countIf(condition_id != '') / count() as pct_filled,
  countIf(condition_id_recovery_method = 'erc1155') as recovered_via_erc1155
FROM trades_raw_erc1155_recovered;

-- EXPECTED RESULTS:
-- total_trades:          159,574,259
-- still_empty:           ~77,235,673 (reduced by ~200K)
-- pct_filled:            ~51.60% (up from 51.47%)
-- recovered_via_erc1155: ~200,000

-- ========================================
-- Step 3: Atomic swap (if gates pass)
-- ========================================
RENAME TABLE
  trades_raw TO trades_raw_before_erc1155_recovery,
  trades_raw_erc1155_recovered TO trades_raw;

-- ========================================
-- Post-deployment validation
-- ========================================
SELECT
  'After ERC1155 Recovery' as status,
  count() as total_trades,
  countIf(condition_id = '') as empty_condition_id,
  100.0 * countIf(condition_id != '') / count() as pct_filled
FROM trades_raw;
```

---

## Phase 3: The 77.2M Unrecoverable Trades Problem

### Why 77.2M Trades Cannot Be Recovered via ERC1155

**ERC1155 Limitation:**
- ERC1155 transfers only cover on-chain token movements
- CLOB (Central Limit Order Book) trades are matched OFF-chain
- Settlement happens in batches, not per-trade
- Many trades don't generate individual ERC1155 events

**Data Source Analysis:**
```
Empty condition_id trades:    77,435,673
ERC1155 tx overlap:              204,116
Coverage:                          0.26%
Unrecoverable:                77,231,557 (99.74%)
```

### What Are These 77.2M Trades?

Based on the trade_id pattern `{tx_hash}-undefined-{maker/taker}`:

1. **Missing Order ID:** The "undefined" suggests the order_id field was null during ingestion
2. **CLOB Fills:** These are likely off-chain order book matches that settled on-chain in batches
3. **Data Pipeline Gap:** The ingestion process captured the transaction but lost market context

### Options for Recovering the Remaining 77.2M

**Option 1: Re-ingest from Source (RECOMMENDED)**
- **Action:** Re-run the CLOB fill backfill with fixed ingestion logic
- **Pros:** Gets accurate market_id and condition_id from source API
- **Cons:** Requires access to historical CLOB API data
- **Estimated Effort:** 4-8 hours (backfill + validation)
- **Recovery Rate:** 95%+ (if source data still available)

**Option 2: Reverse-Engineer from Transaction Logs**
- **Action:** Parse transaction input data to extract market/condition context
- **Pros:** Uses blockchain as source of truth
- **Cons:** Complex ABI decoding, may not have all context
- **Estimated Effort:** 16-24 hours (research + implementation)
- **Recovery Rate:** 60-70% (limited by transaction data completeness)

**Option 3: Statistical Inference from Co-Occurring Trades**
- **Action:** Use trades with condition_id in same tx to infer missing values
- **Pros:** No external data needed
- **Cons:** Low confidence (40-60%), high false positive risk
- **Estimated Effort:** 8-12 hours
- **Recovery Rate:** 30-50% (high uncertainty)

**Option 4: Accept Data Loss**
- **Action:** Mark these 77.2M trades as "unresolvable" and exclude from P&L
- **Pros:** Clean separation of known vs unknown
- **Cons:** 48% of trade data unusable for P&L calculation
- **Estimated Effort:** 1 hour (add flag column)
- **Recovery Rate:** 0%

---

## Phase 4: Recommended Action Plan

### Immediate Actions (Next 30 Minutes)

**1. Execute ERC1155 Recovery (What We CAN Fix)**
- Run the SQL in Phase 2 to recover ~200K trades
- This is low-risk, high-confidence
- Takes 5-10 minutes to execute + validate

**2. Document the Real Problem**
- The remaining 77.2M trades require different recovery methods
- Set realistic expectations with stakeholders

### Short-Term Actions (Next 24 Hours)

**3. Investigate Source Data Availability**
```sql
-- Check if we have historical CLOB data
SELECT
  min(timestamp) as earliest_trade,
  max(timestamp) as latest_trade,
  count() as total_trades,
  uniq(wallet_address) as unique_wallets
FROM trades_raw
WHERE condition_id = '';

-- Date range: 2024-03-09 onwards (from sample data)
-- If CLOB API has historical data for this period, re-ingestion is viable
```

**4. Test Transaction Log Parsing**
```sql
-- Sample transaction hashes from empty trades
SELECT DISTINCT transaction_hash
FROM trades_raw
WHERE condition_id = ''
LIMIT 100;

-- Use these to test Etherscan/blockchain API parsing
-- Check if transaction input data contains market/condition references
```

### Medium-Term Solution (Next Week)

**5. Implement Chosen Recovery Strategy**

**If Source Data Available (Option 1):**
```bash
# Re-run CLOB backfill with fixed logic
npm run backfill:clob:historical -- --start-date=2024-03-09 --validate-market-id
```

**If Source Data Unavailable (Option 2):**
```sql
-- Build transaction parser
CREATE TABLE transaction_log_recovery AS
SELECT
  t.transaction_hash,
  t.trade_id,
  -- Parse transaction input data
  extractMarketIdFromTxInput(tx_input) as parsed_market_id,
  extractConditionIdFromTxInput(tx_input) as parsed_condition_id
FROM trades_raw t
LEFT JOIN ethereum_transactions tx ON t.transaction_hash = tx.hash
WHERE t.condition_id = '';
```

**If All Else Fails (Option 4):**
```sql
-- Mark unrecoverable trades
ALTER TABLE trades_raw ADD COLUMN is_recoverable Bool DEFAULT true;

UPDATE trades_raw
SET is_recoverable = false
WHERE condition_id = ''
  AND trade_id LIKE '%undefined%';

-- Exclude from P&L views
CREATE VIEW trades_pnl_ready AS
SELECT * FROM trades_raw
WHERE is_recoverable = true AND condition_id != '';
```

---

## Phase 5: Impact on P&L Calculation

### Current State

**Without Recovery:**
- Usable trades: 82.1M (51.47%)
- Unusable trades: 77.4M (48.53%)

**After ERC1155 Recovery:**
- Usable trades: 82.3M (51.60%)
- Still unusable: 77.2M (48.40%)

### Wallet 2 P&L Test

**To verify if recovery helps Wallet 2:**
```sql
-- Check if Wallet 2 trades are in the recoverable set
SELECT
  count() as total_wallet2_trades,
  countIf(condition_id = '') as empty_condition,
  countIf(
    condition_id = '' AND
    transaction_hash IN (SELECT tx_hash FROM erc1155_transfers)
  ) as recoverable_via_erc1155
FROM trades_raw
WHERE wallet_address = '0x[wallet_2_address]';

-- If recoverable_via_erc1155 > 0, ERC1155 recovery will improve Wallet 2 P&L
-- If recoverable_via_erc1155 = 0, Wallet 2's missing trades require other methods
```

---

## Conclusion & Next Steps

### Summary

1. **ERC1155 Recovery:** Can fix ~200K trades (0.26% of problem) with HIGH confidence
2. **Remaining 77.2M:** Require source data re-ingestion or transaction log parsing
3. **Recommended Path:** Execute ERC1155 recovery NOW, then pursue source data investigation

### Decision Required from User

**Question 1:** Should we execute the ERC1155 recovery script now? (Fixes 200K trades, 5-10 min runtime)

**Question 2:** Do you have access to historical CLOB API data for re-ingestion?
- If YES: Option 1 (re-ingest) is best path forward
- If NO: Should we pursue Option 2 (transaction log parsing) or Option 4 (mark as unrecoverable)?

**Question 3:** What is the priority for Wallet 2 P&L accuracy?
- If HIGH: We need to check if Wallet 2's trades are in the recoverable set
- If MEDIUM: ERC1155 recovery may be sufficient for now

### Files Created

1. `/Users/scotty/Projects/Cascadian-app/ERC1155_RECOVERY_FINAL_ANALYSIS.md` (this file)
2. `/Users/scotty/Projects/Cascadian-app/ERC1155_RECOVERY_STRATEGY_ANALYSIS.md` (initial exploration - superseded by this file)

### Next Recommended Action

**Execute the ERC1155 recovery script (Phase 2 SQL)** - this is the "quick win" that can be done immediately with high confidence.

**Then investigate** the source of the remaining 77.2M trades to determine the best recovery strategy.

---

**Database Architect Analysis Complete**
Applied skills: **IDN** (ID normalization), **JD** (join discipline), **CAR** (ClickHouse arrays), **AR** (atomic rebuild)

**Status:** AWAITING USER DECISION
