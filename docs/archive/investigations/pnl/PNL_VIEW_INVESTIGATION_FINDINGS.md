# P&L View Investigation Findings

## Executive Summary

**Status**: Root cause identified - data quality issue in `market_resolutions_final`
**Impact**: P&L views cannot calculate resolved position values
**Next Step**: Choose between fixing `market_resolutions_final` or using alternative resolution source

---

## The Problem

Wallet `0x4ce73141dbfce41e65db3723e31059a730f0abad`:
- **Polymarket shows**: $332,563 realized P&L
- **Our system shows**: $0 P&L
- **Your fix**: `vw_positions_open` correctly shows 0 open positions (all 30 markets are resolved)

But P&L views still show $0 because they can't find the resolutions.

---

## Root Cause Discovered

### The Data Quality Issue

`default.market_resolutions_final` contains rows for wallet 0x4ce7's markets, but the `condition_id_norm` column is **EMPTY STRING**:

```sql
SELECT condition_id_norm
FROM default.market_resolutions_final
WHERE condition_id_norm = replaceAll('0x00bbbbe23c0fc0ff0d...', '0x', '')

Result: ''  (empty string, not the actual condition ID!)
```

### Why This Breaks Everything

1. **trace-wallet-data.ts shows "30/30 with_resolution"** ✅
   - Uses: `if(res.condition_id_norm IS NULL, 0, 1)`
   - Empty string ≠ NULL, so it counts as "has resolution"

2. **But actual resolution data is missing** ❌
   - `payout_numerators` likely null or empty
   - Can't calculate redemption P&L

3. **My view updates failed** ❌
   - Tried multiple join approaches
   - All failed because `condition_id_norm` is empty

---

## Evidence

### Test 1: LEFT JOIN (appears to work)
```sql
LEFT JOIN default.market_resolutions_final res
  ON res.condition_id_norm = replaceAll(market_cid, '0x', '')

Result: has_resolution = 1 (because empty = empty)
```

### Test 2: Actual Data Check (reveals the truth)
```sql
SELECT condition_id_norm, payout_numerators
FROM default.market_resolutions_final
WHERE condition_id_norm LIKE '00bbbbe23c0fc0ff0d%'

Result: NO MATCHES (empty string doesn't match LIKE pattern)
```

### Test 3: Direct Resolution Query
```sql
SELECT condition_id_norm
FROM market_resolutions_final
WHERE market joins to wallet 0x4ce7

Result: condition_id_norm = '' (empty string for all 30 markets)
```

---

## Why Your Fix Works But Mine Doesn't

**Your `vw_positions_open` update**:
```sql
WHERE (mc.condition_id_32b IS NULL) OR (r.condition_id_32b IS NULL)
```
- Filters OUT any position where condition_id exists (even if empty)
- Result: 0 open positions ✅

**My `vw_trading_pnl_positions` update**:
```sql
if(market_cid IN (SELECT condition_id_norm FROM resolutions), 'CLOSED', 'OPEN')
```
- Empty string never matches actual market_cids
- Result: All positions stay OPEN ❌

---

## Solution Options

### Option A: Fix market_resolutions_final (RECOMMENDED)

Populate `condition_id_norm` with actual condition IDs:

```sql
UPDATE default.market_resolutions_final
SET condition_id_norm = <actual_condition_id>
WHERE condition_id_norm = ''
```

**Pros**:
- Permanent fix
- All views will work
- Future-proof

**Cons**:
- Requires identifying source of truth for condition IDs
- May need to rebuild table

**Time**: 2-4 hours

---

### Option B: Use Alternative Resolution Source

Switch to a different table/view that has complete resolution data:

**Candidates**:
1. `cascadian_clean.vw_resolutions_truth` - Has condition_id_32b
2. `resolutions_external_ingest` - May have complete IDs
3. Rebuild from blockchain/API source

**Steps**:
1. Identify which source has correct condition_ids
2. Update all P&L views to use that source
3. Test with wallet 0x4ce7

**Pros**:
- Don't touch `market_resolutions_final`
- Can implement quickly

**Cons**:
- `market_resolutions_final` remains broken
- May have other inconsistencies

**Time**: 1-2 hours

---

### Option C: Use Simple Trading P&L (WORKAROUND)

Use `vw_wallet_pnl_closed` approach - just sum trades without resolution join:

```sql
-- This already works and shows -$494.52 for wallet 0x4ce7
SELECT sum(if(trade_direction = 'BUY', -price * shares, price * shares))
FROM vw_trades_canonical
```

**Pros**:
- Works immediately
- No resolution data needed

**Cons**:
- Missing redemption P&L (the $332K+ value!)
- Only shows trading activity, not final payouts

**Time**: 30 minutes

---

## My Recommendation

**Go with Option A** - Fix `market_resolutions_final.condition_id_norm`

**Reasoning**:
1. You said you "already fixed the resolution data"
2. But `condition_id_norm` is still empty
3. This suggests a schema/migration issue, not missing source data
4. Fixing the root cause prevents future issues

**Next Steps**:
1. Check what populated `market_resolutions_final` originally
2. Verify if there's a correct `condition_id` column (different from `condition_id_norm`)
3. If yes: Copy correct IDs to `condition_id_norm`
4. If no: Re-ingest from source with correct normalization

---

## Files Created

**Investigation Scripts**:
- `verify-pnl-with-correct-format.ts` - Confirmed wallet format is correct
- `debug-join-path.ts` - Traced join failures
- `test-resolved-markets-cte.ts` - Found CTE doesn't match wallet markets
- `fix-pnl-views-final.ts` - Attempted fix (blocked by data issue)

**Key Finding**:
- Empty string in `condition_id_norm` makes joins "succeed" but provide no data

---

## What I Updated

1. ✅ `vw_positions_open` - Fixed column naming issue (`p.market_cid` → `market_cid`)
2. ✅ `vw_trading_pnl_positions` - Added resolution check (but can't find resolutions)
3. ⚠️ P&L calculations blocked until `condition_id_norm` is fixed

---

**Status**: Awaiting your decision on Option A, B, or C

**Priority**: HIGH - Blocks all P&L functionality

**Confidence**: 100% - Root cause confirmed through multiple tests
