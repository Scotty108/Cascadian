# ERC1155 Recovery - Quick Start Guide

## TL;DR

**Problem:** 77.4M trades (48.53%) have empty condition_id, preventing P&L calculation.

**Discovery:** ALL 77.4M empty trades ALSO have zero market_id (100% correlation) - this is a data quality issue.

**ERC1155 Solution:** Can recover ~200K trades (0.26% of 77.4M) with HIGH confidence.

**Remaining 77.2M:** Require source data re-ingestion or transaction log parsing.

---

## Quick Execute (5-10 Minutes)

```bash
# Run the recovery script
npx ts-node scripts/execute-erc1155-recovery.ts
```

This will:
1. Extract condition_id from ERC1155 token transfers
2. Match to trades via (tx_hash + wallet_address + amount proximity)
3. Validate recovery quality (>85% validation rate required)
4. Atomically swap tables (with 5-second abort window)
5. Backup original table as `trades_raw_before_erc1155_recovery`

**Expected Result:**
- Recovered: ~200,000 trades
- Coverage improvement: 51.47% → 51.60%
- Runtime: 5-10 minutes

---

## What Happens After Recovery

### Immediate Impact
```sql
-- Check improvement
SELECT
  count() as total_trades,
  countIf(condition_id = '') as still_empty,
  countIf(condition_id != '') as filled,
  100.0 * filled / total_trades as pct_filled
FROM trades_raw;

-- Expected:
-- total_trades:  159,574,259
-- still_empty:    77,235,673 (down from 77,435,673)
-- filled:         82,338,586 (up from 82,138,586)
-- pct_filled:     51.60% (up from 51.47%)
```

### Rollback (If Needed)
```sql
-- If something goes wrong, rollback immediately:
RENAME TABLE
  trades_raw TO trades_raw_failed_recovery,
  trades_raw_before_erc1155_recovery TO trades_raw;
```

---

## The Bigger Problem: 77.2M Unrecoverable Trades

### Why ERC1155 Can't Fix Everything

**ERC1155 Coverage:**
- Total empty trades: 77,435,673
- ERC1155 tx overlap: ~204,116 (0.26%)
- Unrecoverable: 77,231,557 (99.74%)

**Root Cause:**
All 77.4M empty trades have:
- `condition_id = ''`
- `market_id = '0x0000000000000000000000000000000000000000000000000000000000000000'`
- `trade_id` contains "undefined" (e.g., `0xabc...xyz-undefined-maker`)

This indicates a **data ingestion quality issue** where market context was lost during import.

---

## Recovery Options for Remaining 77.2M

### Option 1: Re-ingest from Source (BEST)
**Effort:** 4-8 hours
**Recovery Rate:** 95%+
**Requires:** Access to historical CLOB API data

```bash
# Check if source data is available
# Look for CLOB backfill scripts in /scripts/

# If available, re-run with fixed ingestion:
npm run backfill:clob:historical -- --start-date=2024-03-09 --validate-market-id
```

### Option 2: Parse Transaction Logs (COMPLEX)
**Effort:** 16-24 hours
**Recovery Rate:** 60-70%
**Requires:** Blockchain API access, ABI decoding expertise

```sql
-- Extract market context from transaction input data
-- This requires custom parsing logic for Polymarket contracts
```

### Option 3: Statistical Inference (RISKY)
**Effort:** 8-12 hours
**Recovery Rate:** 30-50%
**Requires:** No external data

```sql
-- Use co-occurring trades in same transaction to infer missing values
-- LOW CONFIDENCE approach
```

### Option 4: Mark as Unrecoverable (CLEAN)
**Effort:** 1 hour
**Recovery Rate:** 0%
**Impact:** Exclude 48% of trades from P&L

```sql
ALTER TABLE trades_raw ADD COLUMN is_recoverable Bool DEFAULT true;

UPDATE trades_raw
SET is_recoverable = false
WHERE condition_id = ''
  AND trade_id LIKE '%undefined%';

-- Then exclude from P&L views:
CREATE VIEW trades_pnl_ready AS
SELECT * FROM trades_raw
WHERE is_recoverable = true AND condition_id != '';
```

---

## Decision Tree

```
Do you have historical CLOB API access?
├─ YES → Option 1: Re-ingest (BEST)
└─ NO → Do you need 95%+ P&L coverage?
    ├─ YES → Option 2: Transaction log parsing (COMPLEX)
    └─ NO → Option 4: Mark as unrecoverable (CLEAN)
```

---

## Testing P&L Impact

### Before Recovery
```sql
-- Check Wallet 2 trades
SELECT
  count() as total_trades,
  countIf(condition_id = '') as empty_condition,
  countIf(condition_id != '') as filled
FROM trades_raw_before_erc1155_recovery
WHERE wallet_address = '0x[wallet_2_address]';
```

### After Recovery
```sql
-- Same query on current trades_raw
SELECT
  count() as total_trades,
  countIf(condition_id = '') as empty_condition,
  countIf(condition_id != '') as filled,
  -- Check if recovered trades exist
  countIf(condition_id_recovery_method = 'erc1155') as recovered
FROM trades_raw
WHERE wallet_address = '0x[wallet_2_address]';
```

### P&L Calculation Test
```sql
-- Test if P&L can now be calculated
SELECT
  t.wallet_address,
  count() as total_trades,
  countIf(m.condition_id IS NOT NULL) as resolvable_trades,
  sum(
    CASE
      WHEN m.winning_index IS NOT NULL
      THEN t.shares * (arrayElement(m.payout_numerators, m.winning_index + 1) / m.payout_denominator) - t.usd_value
      ELSE 0
    END
  ) as estimated_pnl
FROM trades_raw t
LEFT JOIN market_resolutions_final m ON (
  lower(replaceAll(t.condition_id, '0x', '')) = lower(replaceAll(m.condition_id, '0x', ''))
)
WHERE t.wallet_address = '0x[wallet_2_address]'
GROUP BY t.wallet_address;

-- Expected for Wallet 2: ~$360,492 (±5%)
```

---

## Files Reference

**Analysis Documents:**
- `/Users/scotty/Projects/Cascadian-app/ERC1155_RECOVERY_FINAL_ANALYSIS.md` - Complete analysis (20+ pages)
- `/Users/scotty/Projects/Cascadian-app/ERC1155_RECOVERY_QUICK_START.md` - This file

**Executable Scripts:**
- `/Users/scotty/Projects/Cascadian-app/scripts/execute-erc1155-recovery.ts` - Run this to execute recovery

**Skills Used:**
- **IDN** (ID Normalization) - Normalize condition_id to 64 hex chars, lowercase, no 0x
- **JD** (Join Discipline) - Match on normalized ids only, (tx_hash + wallet)
- **CAR** (ClickHouse Array Rule) - Use 1-based indexing with ROW_NUMBER
- **AR** (Atomic Rebuild) - CREATE + RENAME pattern, never UPDATE in place

---

## Next Steps

1. **NOW:** Execute ERC1155 recovery (scripts/execute-erc1155-recovery.ts)
2. **THEN:** Investigate source data availability for remaining 77.2M trades
3. **FINALLY:** Choose recovery strategy for remaining trades (Options 1-4)

---

## Support

**If recovery fails:**
1. Check ClickHouse logs for errors
2. Verify ERC1155 table has data: `SELECT count() FROM erc1155_transfers`
3. Check validation gates in script output
4. Rollback if needed (see "Rollback" section above)

**If P&L still broken after recovery:**
- Only 200K trades are recovered (0.26% of empty)
- Remaining 77.2M need different recovery method
- See ERC1155_RECOVERY_FINAL_ANALYSIS.md for options

---

**Last Updated:** 2025-11-07
**Database Architect:** Complete analysis with IDN, JD, CAR, AR skills
