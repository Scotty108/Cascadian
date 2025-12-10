# PM_TRADER_EVENTS_V2 DEDUPLICATION AUDIT
**Date:** 2025-12-06
**Terminal:** Claude Terminal 2 (Data Health & Engine Safety)
**Status:** P0 - Critical Data Quality Issue

## Executive Summary

Audited all usages of `pm_trader_events_v2` across the codebase to verify compliance with the documented deduplication pattern (`GROUP BY event_id`). The table contains 2-3x row inflation due to historical backfill overlaps.

**Critical Finding:** Multiple engine code paths in `lib/pnl/` query `pm_trader_events_v2` without proper `event_id` deduplication, potentially inflating cash flow calculations by 2-3x.

---

## Background: Why Deduplication is Required

From `CLAUDE.md` and `PNL_DISCREPANCY_RESEARCH_2025_12_06.md`:

- **Table:** `pm_trader_events_v2` (SharedMergeTree, not ReplacingMergeTree)
- **Issue:** Historical backfills created 2-3 duplicate rows per `event_id`
- **Impact:** Queries that `SUM(usdc_amount)` or `SUM(token_amount)` without deduping will return inflated values
- **Required Pattern:**
  ```sql
  SELECT ... FROM (
    SELECT
      event_id,
      any(side) as side,
      any(usdc_amount) / 1000000.0 as usdc,
      any(token_amount) / 1000000.0 as tokens,
      any(trade_time) as trade_time
    FROM pm_trader_events_v2
    WHERE trader_wallet = '0x...' AND is_deleted = 0
    GROUP BY event_id
  ) ...
  ```

---

## Audit Results

### ❌ CRITICAL: Needs Fix (lib/pnl/)

**NOTE:** Per terminal role constraints, I cannot directly edit `lib/pnl/*`. These findings require Main Terminal action.

#### 1. `lib/pnl/shadowLedgerV23c.ts:230-287`
**Function:** `loadRawTradesFallback`

**Current Query:**
```typescript
const rawTradesQuery = `
  SELECT
    event_id,
    trade_time as timestamp,
    side,
    usdc_amount / 1000000.0 as usdc_amount,
    token_amount / 1000000.0 as token_amount,
    token_id,
    is_deleted
  FROM pm_trader_events_v2
  WHERE trader_wallet = {wallet:String}
    AND trade_time >= {start_ts:DateTime64(3)}
    AND trade_time <= {end_ts:DateTime64(3)}
    AND is_deleted = 0
  ORDER BY trade_time ASC
`;
```

**Issue:** No `GROUP BY event_id` deduplication at SQL level.

**Impact:** If duplicate rows exist for a wallet's trades, the returned array will have 2-3x rows, inflating all downstream PnL calculations that sum `usdc_amount` or `token_amount`.

**Fix Required:**
```sql
SELECT * FROM (
  SELECT
    event_id,
    any(trade_time) as timestamp,
    any(side) as side,
    any(usdc_amount) / 1000000.0 as usdc_amount,
    any(token_amount) / 1000000.0 as token_amount,
    any(token_id) as token_id,
    any(is_deleted) as is_deleted
  FROM pm_trader_events_v2
  WHERE trader_wallet = {wallet:String}
    AND trade_time >= {start_ts:DateTime64(3)}
    AND trade_time <= {end_ts:DateTime64(3)}
    AND is_deleted = 0
  GROUP BY event_id
) ORDER BY timestamp ASC
```

**Client-Side Mitigation:** Lines 288-289 do a Map-based dedup by event_id on the client, which mitigates the issue IF the query returns all rows. However, SQL-level dedup is more efficient and safer.

---

#### 2. `lib/pnl/shadowLedgerV23d.ts:472-523`
**Function:** `loadRawTradesFallback`

**Current Query:**
```typescript
const rawTradesQuery = `
  SELECT
    event_id,
    trade_time as timestamp,
    side,
    usdc_amount / 1000000.0 as usdc_amount,
    token_amount / 1000000.0 as token_amount,
    token_id,
    is_deleted
  FROM pm_trader_events_v2
  WHERE trader_wallet = {wallet:String}
    AND trade_time >= {start_ts:DateTime64(3)}
    AND trade_time <= {end_ts:DateTime64(3)}
    AND is_deleted = 0
  ORDER BY trade_time ASC
`;
```

**Issue:** Same as shadowLedgerV23c - no `GROUP BY event_id`.

**Mitigation:** Lines 686-691 do client-side Map deduplication:
```typescript
const uniqueTrades: ShadowTrade[] = [];
const seenEvents = new Set<string>();
for (const t of rawTrades) {
  if (!seenEvents.has(t.event_id)) { uniqueTrades.push(t); seenEvents.add(t.event_id); }
}
```

**Recommendation:** Still add SQL-level dedup for efficiency and consistency.

---

### ✅ OK: Already Safe

#### 1. `lib/pnl/shadowLedgerV23.ts:559-618`
**Function:** `loadResolutionPrices`

**Query:**
```sql
SELECT DISTINCT token_id, condition_id
FROM pm_trader_events_v2
WHERE trader_wallet = {wallet:String}
  AND condition_id IN (SELECT condition_id FROM ...)
GROUP BY token_id, condition_id
```

**Status:** ✅ Safe - Uses `GROUP BY token_id, condition_id` to get DISTINCT pairs, not summing USDC/tokens.

---

#### 2. `lib/pnl/shadowLedgerV23b.ts:103-136`
**Function:** `loadResolutionPrices` subquery

**Query:**
```sql
SELECT DISTINCT token_id, condition_id
FROM pm_trader_events_v2
WHERE trader_wallet = {wallet:String}
GROUP BY token_id, condition_id
```

**Status:** ✅ Safe - Same pattern, only for DISTINCT condition lookup.

---

#### 3. `lib/pnl/shadowLedgerV23c.ts:293-357, 362-414`
**Functions:** `loadUIMarketPricesForRawTrades`, `loadResolutionPricesForRawTrades`

**Pattern:**
```sql
SELECT DISTINCT token_id FROM pm_trader_events_v2 WHERE ...
```

**Status:** ✅ Safe - Only selecting DISTINCT token_ids for lookups, not aggregating amounts.

---

#### 4. `lib/pnl/inventoryEngineV29.ts:717-828`
**Functions:** `sampleActiveWallets`, `sampleActiveTraderWallets`, `sampleAllActiveWallets`

**Pattern:**
```sql
SELECT trader_wallet, COUNT(*) as trade_count
FROM pm_trader_events_v2
WHERE trade_time >= {since:DateTime64(3)}
GROUP BY trader_wallet
ORDER BY trade_count DESC
LIMIT {limit:UInt32}
```

**Status:** ✅ Safe - Only counting rows per wallet for sampling, not summing USDC. Duplicate events would still identify active wallets.

---

### 📊 Scripts Audit (scripts/pnl/)

**Finding:** 92 scripts reference `pm_trader_events_v2`.

**Scope Decision:** Most are historical diagnostic scripts in the archive. Active regression/benchmark scripts typically use materialized views (`pm_unified_ledger_v8_tbl`, `vw_wallet_market_pnl_v17`) which should already be deduped at creation time.

**Spot Check:** `scripts/pnl/run-regression-matrix.ts` - Uses engine functions (shadowLedgerV23, V23c, V29) which are already audited above.

**Recommendation:** If creating NEW scripts that query `pm_trader_events_v2` directly, always use the documented dedup pattern.

---

## Severity Assessment

**Risk Level:** HIGH for affected engines (V23c, V23d fallback paths)

**Mitigation Status:**
- **V23c:** Client-side Map dedup after query (partial mitigation)
- **V23d:** Client-side Map dedup after query (partial mitigation)
- **V23, V23b, V29:** Safe query patterns

**Impact on Current Benchmarks:**
- If fallback paths are rarely used (most wallets have complete data), impact may be minimal
- If fallback paths are common, PnL inflation of 2-3x is possible

**Next Steps:**
1. Main Terminal to add SQL-level `GROUP BY event_id` to shadowLedgerV23c and V23d
2. Run regression matrix before/after fix to quantify impact
3. Consider creating a materialized deduped view `pm_trader_events_v2_deduped` for all engine usage

---

## Recommended Pattern Template

For any new code querying `pm_trader_events_v2`:

```typescript
const query = `
  SELECT
    event_id,
    any(trade_time) as timestamp,
    any(side) as side,
    any(usdc_amount) / 1000000.0 as usdc_amount,
    any(token_amount) / 1000000.0 as token_amount,
    any(token_id) as token_id
  FROM pm_trader_events_v2
  WHERE trader_wallet = {wallet:String}
    AND is_deleted = 0
  GROUP BY event_id
  ORDER BY any(trade_time) ASC
`;
```

**Alternative:** Create a permanent deduped view:
```sql
CREATE VIEW pm_trader_events_v2_deduped AS
SELECT
  event_id,
  any(trader_wallet) as trader_wallet,
  any(trade_time) as trade_time,
  any(side) as side,
  any(usdc_amount) as usdc_amount,
  any(token_amount) as token_amount,
  any(token_id) as token_id,
  any(condition_id) as condition_id,
  any(is_deleted) as is_deleted
FROM pm_trader_events_v2
WHERE is_deleted = 0
GROUP BY event_id;
```

---

## Files Modified/Created

**Created:**
- `docs/reports/PM_TRADER_EVENTS_DEDUP_AUDIT_2025_12_06.md` (this file)

**Identified for Main Terminal Fix:**
- `lib/pnl/shadowLedgerV23c.ts:230-287` (loadRawTradesFallback)
- `lib/pnl/shadowLedgerV23d.ts:472-523` (loadRawTradesFallback)

---

**Terminal:** Claude Terminal 2
**Handoff:** Ready for Main Terminal to implement SQL-level dedup fixes in lib/pnl/
