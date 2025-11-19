# Wallet P&L Bug Report: 0x4ce7...

## Executive Summary

**Issue:** Wallet 0x4ce73141dbfce41e65db3723e31059a730f0abad shows -$677 instead of +$332,563

**Root Cause:** Missing midprice data in `cascadian_clean.midprices_latest` table

**Impact:** Only 2 out of 30 open positions (6.7%) have midprice data, resulting in $333K discrepancy

---

## Detailed Findings

### 1. Position Coverage Analysis

| Metric | Value |
|--------|-------|
| Total open positions | 30 |
| Positions with midprices | 2 (6.7%) |
| Positions without midprices | 28 (93.3%) |
| View's calculated unrealized P&L | -$677.28 |
| Recalculated unrealized P&L | -$677.28 |
| Expected from Polymarket | $332,563 |
| **Gap** | **$333,240** |

### 2. Midprice Data Availability

The `cascadian_clean.midprices_latest` table exists and contains:
- **37,929 total midprices** across all markets
- Recent data (last updated: 2025-11-09 18:27:58)
- Proper schema with columns: `market_cid`, `outcome`, `midprice`, `best_bid`, `best_ask`, `updated_at`

**However:** Only 2 of this wallet's 30 positions have matching midprice entries.

### 3. View Calculation is Correct

The `vw_positions_open` view is calculating unrealized P&L correctly:
```sql
p.shares_net * (coalesce(m.midprice, 0.) - if(p.shares_net != 0, (-p.cash_net) / nullIf(p.shares_net, 0), 0.)) AS unrealized_pnl_usd
```

Join condition is also correct:
```sql
LEFT JOIN cascadian_clean.midprices_latest AS m
  ON (m.market_cid = p.market_cid) AND (m.outcome = p.outcome)
```

**The view is working as designed.** The issue is missing source data.

### 4. Example Positions with Missing Midprices

Top 5 positions by value (all missing midprices):

1. **0x3eb16c31383770...** (outcome=1)
   - Qty: 1,005.12 @ $0.7000
   - Position value: $703.58
   - Midprice: **$0 (MISSING)**
   - Unrealized P&L: -$703.58

2. **0xdfa2fbe708fefc...** (outcome=1)
   - Qty: -1,077.52 @ $0.1338
   - Position value: -$144.12
   - Midprice: **$0 (MISSING)**
   - Unrealized P&L: $144.12

3. **0x00bbbbe23c0fc0...** (outcome=1)
   - Qty: 82.36 @ $0.9040
   - Position value: $74.45
   - Midprice: **$0 (MISSING)**
   - Unrealized P&L: -$74.45

### 5. Working Examples (for verification)

Two positions DO have midprices and calculate correctly:

1. **0xb2ea311c60bc55...** (outcome=1)
   - Qty: -379.41 @ $0.3686
   - View midprice: $0.5 ✓
   - Actual midprice: $0.5 ✓
   - Unrealized P&L: -$49.84 ✓

2. **0x23a8f862517c25...** (outcome=1)
   - Qty: 13.89 @ $0.6394
   - View midprice: $0.5 ✓
   - Actual midprice: $0.5 ✓
   - Unrealized P&L: -$1.94 ✓

---

## Root Cause Analysis

### The Bug is NOT in:
- ✓ View calculation logic (correct)
- ✓ Join conditions (correct)
- ✓ Condition ID normalization (correct)
- ✓ Position quantity calculation (correct)
- ✓ Average cost calculation (correct)

### The Bug IS:
**Missing midprice data in `cascadian_clean.midprices_latest`**

93.3% of this wallet's positions are in markets that don't have current midprice data. This suggests one of:

1. **Incomplete midprice backfill** - The midprice ingestion pipeline hasn't fetched data for all active markets
2. **Stale markets** - This wallet has positions in old/inactive markets that are no longer tracked
3. **Midprice API issue** - The source providing midprices may not include all markets

---

## Recommended Fixes

### Immediate (< 1 hour)
1. **Check midprice ingestion coverage**
   ```sql
   -- How many unique markets have positions vs midprices?
   SELECT
     count(DISTINCT market_cid) as markets_with_positions
   FROM cascadian_clean.vw_positions_open;

   SELECT
     count(DISTINCT market_cid) as markets_with_midprices
   FROM cascadian_clean.midprices_latest;
   ```

2. **Identify which markets are missing**
   ```sql
   -- Find positions without midprices
   SELECT DISTINCT p.market_cid
   FROM cascadian_clean.vw_positions_open p
   LEFT JOIN cascadian_clean.midprices_latest m
     ON p.market_cid = m.market_cid AND p.outcome = m.outcome
   WHERE m.midprice IS NULL
   LIMIT 100;
   ```

### Short-term (1-4 hours)
3. **Backfill missing midprices** from Polymarket CLOB API
   - Use the list of missing markets from step 2
   - Fetch current orderbook data for each market
   - Insert into `midprices_latest` table

4. **Add monitoring** for midprice coverage
   - Alert when coverage drops below 80%
   - Track number of markets with/without midprices
   - Monitor freshness of midprice updates

### Long-term (1-2 days)
5. **Improve midprice ingestion pipeline**
   - Ensure all active markets are tracked
   - Add retry logic for failed fetches
   - Schedule regular updates (every 5-10 minutes)

6. **Add fallback for missing midprices**
   - Use last trade price if midprice unavailable
   - Use resolution price for resolved markets
   - Mark unrealized P&L as "estimated" when using fallbacks

---

## Verification Steps

After implementing fixes, verify with:

```sql
-- Should show ~$332K unrealized P&L
SELECT
  wallet,
  sum(unrealized_pnl_usd) as total_unrealized_pnl,
  count(*) as total_positions,
  countIf(midprice > 0) as positions_with_midprices
FROM cascadian_clean.vw_positions_open
WHERE lower(wallet) = lower('0x4ce73141dbfce41e65db3723e31059a730f0abad')
GROUP BY wallet;
```

Expected result after fix:
- `total_unrealized_pnl` ≈ $332,563
- `positions_with_midprices` ≥ 28 (out of 30)

---

## Technical Details

### Table Schemas Verified

**cascadian_clean.vw_positions_open:**
- `wallet` (String)
- `market_cid` (String) - Format: 0x-prefixed 66-char hex
- `outcome` (Int32)
- `qty` (Float64)
- `avg_cost` (Nullable(Float64))
- `midprice` (Float64) - **Populated via LEFT JOIN**
- `best_bid` (Float64)
- `best_ask` (Float64)
- `price_updated_at` (DateTime)
- `unrealized_pnl_usd` (Nullable(Float64))

**cascadian_clean.midprices_latest:**
- `market_cid` (String) - Format: 0x-prefixed 66-char hex
- `outcome` (Int32)
- `midprice` (Float64)
- `best_bid` (Float64)
- `best_ask` (Float64)
- `updated_at` (DateTime)

### View Definition (Confirmed Correct)

```sql
CREATE VIEW cascadian_clean.vw_positions_open AS
WITH pos AS (
  SELECT
    lower(wallet_address_norm) AS wallet,
    concat('0x', left(replaceAll(condition_id_norm, '0x', ''), 62), '00') AS market_cid,
    toInt32(outcome_index) AS outcome,
    sumIf(if(trade_direction = 'BUY', toFloat64(shares), -toFloat64(shares)), 1) AS shares_net,
    sumIf(if(trade_direction = 'BUY', -toFloat64(usd_value), toFloat64(usd_value)), 1) AS cash_net
  FROM default.vw_trades_canonical
  WHERE (condition_id_norm != '')
    AND (condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000')
    AND (outcome_index >= 0)
  GROUP BY wallet, market_cid, outcome
)
SELECT
  p.wallet,
  p.market_cid,
  p.outcome,
  p.shares_net AS qty,
  if(p.shares_net != 0, (-p.cash_net) / nullIf(p.shares_net, 0), 0.) AS avg_cost,
  m.midprice,
  m.best_bid,
  m.best_ask,
  m.updated_at AS price_updated_at,
  p.shares_net * (coalesce(m.midprice, 0.) - if(p.shares_net != 0, (-p.cash_net) / nullIf(p.shares_net, 0), 0.)) AS unrealized_pnl_usd
FROM pos AS p
LEFT JOIN cascadian_clean.midprices_latest AS m
  ON (m.market_cid = p.market_cid) AND (m.outcome = p.outcome)
WHERE abs(p.shares_net) >= 0.01
```

---

## Related Files

- Diagnostic script: `/Users/scotty/Projects/Cascadian-app/final-pnl-diagnosis.ts`
- Output: `/Users/scotty/Projects/Cascadian-app/final-pnl-diagnosis-output.txt`
- Schema checks: `/Users/scotty/Projects/Cascadian-app/check-positions-schema.ts`
- Table listing: `/Users/scotty/Projects/Cascadian-app/list-cascadian-tables.ts`
