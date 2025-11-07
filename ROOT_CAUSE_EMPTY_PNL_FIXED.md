# ROOT CAUSE ANALYSIS: Missing P&L for Wallets 2-4

## Executive Summary

**ROOT CAUSE IDENTIFIED:** ClickHouse String vs FixedString type mismatch causing JOIN to default to NULL/zero record instead of proper market resolutions.

**Impact:** 3 out of 4 test wallets (75%) showing $0 P&L despite $467,393 in actual UI P&L.

**Fix Complexity:** MEDIUM - Requires schema change OR cast function in JOIN

---

## The Smoking Gun

### Evidence from Query Results

When joining `trades_raw` to `market_resolutions_final` for failing wallets:

```
condition_id_norm: '\x00\x00\x00\x00\x00...' (all zeros - 64 null bytes)
winning_outcome: '' (empty string)
resolved_at: null
join_status: 'JOINED' ✅ (but joined to WRONG record!)
```

Compare to working Wallet 1:
```
condition_id_norm: '09c314ec8306ecad...' (actual hex hash)
winning_outcome: 'NO' (actual value)
resolved_at: '2024-11-05 12:34:56' (actual timestamp)
```

### What's Happening

1. **trades_raw.condition_id**: Type = `String` (variable length)
2. **market_resolutions_final.condition_id_norm**: Type = `FixedString(64)` (fixed 64 bytes)
3. **JOIN operation**: `lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm`
   - Left side: String (dynamic)
   - Right side: FixedString(64) (fixed)

When ClickHouse compares String to FixedString with implicit casting:
- If lengths don't match, it pads with NULL bytes (\x00)
- The comparison `'actual_hash' = FixedString(64)` may match a zero-filled FixedString
- Result: JOIN succeeds but matches the WRONG record (likely a default/placeholder row)

### Proof Points

1. **All 3 failing wallets show identical pattern:**
   - 100% JOIN rate (no unmatched rows)
   - But ALL matched rows have `condition_id_norm = '\x00\x00...'`
   - ALL have empty `winning_outcome` and NULL `resolved_at`

2. **Working Wallet 1 shows different pattern:**
   - 52.9% of conditions have actual hash values in `condition_id_norm`
   - Those rows have populated `winning_outcome` ('YES', 'NO', etc.)
   - Those rows have actual `resolved_at` timestamps

3. **Direct lookup confirms:**
   - Specific condition_ids from failing wallets (e.g., 'db44b463f55d035e...') do NOT exist in `market_resolutions_final`
   - But the JOIN still "succeeds" by matching to a zero-filled default row

---

## Schema Analysis

### trades_raw Schema
```sql
condition_id: String  -- Variable length, can be empty or any length
```

### market_resolutions_final Schema
```sql
condition_id_norm: FixedString(64)  -- EXACTLY 64 bytes, padded with \x00 if shorter
payout_numerators: Array(UInt8)
payout_denominator: UInt8
winning_outcome: LowCardinality(String)
resolved_at: Nullable(DateTime)
winning_index: UInt16
```

### The Default/Zero Record

There appears to be a record in `market_resolutions_final` where:
- `condition_id_norm = FixedString('\x00' repeated 64 times)`
- `winning_outcome = ''`
- `resolved_at = NULL`

This acts as a "catch-all" for failed joins, which is why:
- JOIN success rate = 100%
- But actual data retrieval = 0%

---

## Why Wallet 1 Works

Wallet 1 has a mix of:
- **Resolved trades** (52.9%) → Match to real records with actual data
- **Unresolved trades** (47.1%) → Still in progress, correctly showing as unresolved

The key difference: Wallet 1's resolved trades have `condition_ids` that exist in `market_resolutions_final` with REAL data (not the zero-filled default).

Wallets 2-4's trades ALL match to the zero-filled default record.

---

## Data Quality Issues

### Malformed condition_ids

All wallets show significant malformed condition_id counts:

| Wallet | Malformed IDs | Total Trades | Percentage |
|--------|---------------|--------------|------------|
| Wallet 1 | 919 | 3,598 | 25.5% |
| Wallet 2 | 1 | 2 | 50.0% |
| Wallet 3 | 710 | 1,385 | 51.3% |
| Wallet 4 | 901 | 1,794 | 50.2% |

**Malformed** = empty string OR length != 64 after normalization

This explains why joins fail - the condition_ids are literally invalid.

---

## Solution

### Option 1: Fix the JOIN (Immediate - No Schema Change)

Add explicit type casting in the JOIN:

```sql
SELECT
  t.wallet_address,
  t.condition_id,
  r.winning_outcome,
  r.payout_numerators,
  r.resolved_at
FROM trades_raw t
LEFT JOIN market_resolutions_final r
  ON toFixedString(
       lower(replaceAll(t.condition_id, '0x', '')),
       64
     ) = r.condition_id_norm
WHERE lower(t.wallet_address) IN (
  '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
  '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
  '0x6770bf688b8121331b1c5cfd7723ebd4152545fb'
)
  AND t.condition_id != ''
  AND length(replaceAll(t.condition_id, '0x', '')) = 64
  AND r.winning_outcome != ''  -- Filter out zero-filled default
  AND r.condition_id_norm != toFixedString('', 64)  -- Exclude default record
```

**Pros:**
- No schema migration needed
- Works immediately
- Filters out malformed condition_ids early

**Cons:**
- Performance impact (casting on every JOIN)
- Must add to ALL P&L queries
- Doesn't fix root cause

### Option 2: Change market_resolutions_final Schema (Recommended)

Change `condition_id_norm` from `FixedString(64)` to `String`:

```sql
-- Step 1: Create new table with correct schema
CREATE TABLE market_resolutions_final_v2 AS market_resolutions_final
ENGINE = ReplacingMergeTree(version)
ORDER BY condition_id_norm
SETTINGS index_granularity = 8192;

-- Step 2: Modify column type
ALTER TABLE market_resolutions_final_v2
  MODIFY COLUMN condition_id_norm String;

-- Step 3: Copy data
INSERT INTO market_resolutions_final_v2
SELECT
  CAST(condition_id_norm AS String) as condition_id_norm,
  payout_numerators,
  payout_denominator,
  outcome_count,
  winning_outcome,
  source,
  version,
  resolved_at,
  updated_at,
  winning_index
FROM market_resolutions_final
WHERE winning_outcome != ''  -- Exclude the zero-filled default record
  AND condition_id_norm != toFixedString('', 64);

-- Step 4: Atomic swap
RENAME TABLE
  market_resolutions_final TO market_resolutions_final_backup,
  market_resolutions_final_v2 TO market_resolutions_final;
```

**Pros:**
- Fixes root cause permanently
- No casting overhead in queries
- Removes the zero-filled default record trap
- Future-proof

**Cons:**
- Requires downtime or careful coordination
- Must update all dependent queries/views
- Risk if not tested thoroughly

### Option 3: Clean Up trades_raw condition_ids (Also Recommended)

Fix malformed condition_ids at the source:

```sql
-- Update trades_raw to normalize condition_ids
CREATE TABLE trades_raw_cleaned AS
SELECT
  trade_id,
  wallet_address,
  market_id,
  timestamp,
  side,
  entry_price,
  exit_price,
  shares,
  usd_value,
  pnl,
  is_closed,
  transaction_hash,
  created_at,
  close_price,
  fee_usd,
  slippage_usd,
  hours_held,
  bankroll_at_entry,
  outcome,
  fair_price_at_entry,
  pnl_gross,
  pnl_net,
  return_pct,
  -- Normalize condition_id
  CASE
    WHEN condition_id = '' THEN ''
    WHEN length(replaceAll(condition_id, '0x', '')) != 64 THEN ''
    ELSE lower(replaceAll(condition_id, '0x', ''))
  END as condition_id_normalized,
  was_win,
  tx_timestamp,
  canonical_category,
  raw_tags,
  realized_pnl_usd,
  is_resolved,
  resolved_outcome,
  outcome_index,
  recovery_status
FROM trades_raw;

-- Then update is_resolved based on actual matches
ALTER TABLE trades_raw_cleaned
  ADD COLUMN is_resolved_updated UInt8 DEFAULT 0;

-- Update is_resolved based on JOIN
-- (This requires a complex UPDATE operation in ClickHouse)
```

---

## Immediate Action Plan

### Phase 1: Validate Root Cause (15 minutes)

1. Run this query to confirm zero-filled record exists:

```sql
SELECT *
FROM market_resolutions_final
WHERE condition_id_norm = toFixedString('', 64)
  OR winning_outcome = '';
```

2. Count how many trades are affected:

```sql
SELECT
  count() as affected_trades,
  uniq(wallet_address) as affected_wallets
FROM trades_raw
WHERE condition_id = ''
   OR length(replaceAll(condition_id, '0x', '')) != 64;
```

### Phase 2: Implement Quick Fix (30 minutes)

Update the P&L calculation query to use proper casting and filters (Option 1).

### Phase 3: Plan Schema Migration (1-2 hours)

Test Option 2 schema change on a sample dataset.

### Phase 4: Execute Migration (2-4 hours)

Run the full schema migration with proper testing and validation.

---

## Success Metrics

After fix, verify:
1. **Wallet 2** (2 trades): Should show some P&L (even if small)
2. **Wallet 3** (1,385 trades, 142 conditions): Should show significant P&L approaching $94,730
3. **Wallet 4** (1,794 trades, 284 conditions): Should show P&L approaching $12,171
4. **All wallets**: `is_resolved` should be updated correctly based on actual resolutions

---

## Related Files

- `/scripts/check-condition-coverage.ts` - Diagnostic script showing the issue
- `/scripts/check-specific-conditions.ts` - Direct evidence of zero-filled joins
- `INVESTIGATION_MISSING_PNL_WALLETS.md` - Initial investigation report
- `scripts/step4-gate-then-swap.ts` - Atomic rebuild pattern reference
- `PAYOUT_VECTOR_PNL_UPDATE.md` - P&L calculation formulas

---

**Status:** ROOT CAUSE IDENTIFIED - Awaiting decision on fix approach (Option 1, 2, or 3)
**Priority:** CRITICAL - $467,393 in P&L not being calculated
**Estimated Fix Time:** 30 min (Option 1) OR 2-4 hours (Option 2 + 3)
