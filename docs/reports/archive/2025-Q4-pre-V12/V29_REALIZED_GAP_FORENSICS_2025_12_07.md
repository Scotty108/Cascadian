# V29 Realized PnL Gap Forensics

**Date:** 2025-12-07
**Terminal:** Claude 2
**Mission:** Identify root cause of V29 realized PnL underestimation vs Dome API

---

## Executive Summary

V29 realized PnL engine shows **catastrophic underestimation** for high-volume wallets when validated against Dome API ground truth:

- **Median Error:** $8.11M (99.07% underestimation)
- **P90 Error:** $22.00M (100% underestimation)
- **Pass Rate (< 3% error):** 12.5% (1/8 wallets)

**Root Cause Hypothesis:** V29 is missing the vast majority of realized PnL events, likely due to incomplete event ingestion or overly aggressive inventory filtering.

---

## Validation Results (8 Wallets)

### Summary Statistics

| Metric | Value |
|--------|-------|
| Total Wallets | 8 |
| High Confidence | 8 (100%) |
| Median Abs Error | $8.11M |
| P90 Abs Error | $22.00M |
| Median Pct Error | 99.07% |
| P90 Pct Error | 100.00% |

### Pass Rates

| Threshold | Count | Percentage |
|-----------|-------|------------|
| < $10 USD | 0/8 | 0.0% |
| < $50 USD | 0/8 | 0.0% |
| < $100 USD | 0/8 | 0.0% |
| < 3% error | 1/8 | 12.5% |

### Performance

- Total Runtime: 14.3s
- Preload: 14.2s (491,629 events)
- Calculation: 121ms
- Per-Wallet Avg: 1.8s

---

## Top 3 Worst Wallets (Detailed Analysis)

### 1. Theo4 (0x5668...5839)

**Error:** $22.00M (99.75% underestimation)

| Metric | V29 | Dome | Delta |
|--------|-----|------|-------|
| Realized PnL | $55.2K | $22.05M | -$22.00M |

**Pattern:**
- V29 detected only 0.25% of realized PnL
- Missing: $21.998M in realized gains
- Loaded: 61,454 avg events per wallet (preload shows data exists)

**Hypothesis:** V29 is not counting the majority of closed/realized positions despite having event data loaded.

### 2. Fredi9999 (0x1f2d...d0cf)

**Error:** $16.35M (98.40% underestimation)

| Metric | V29 | Dome | Delta |
|--------|-----|------|-------|
| Realized PnL | $265.9K | $16.62M | -$16.35M |

**Pattern:**
- V29 detected only 1.60% of realized PnL
- Missing: $16.35M in realized gains
- Slightly better than Theo4 but still catastrophic

**Hypothesis:** Same root cause as Theo4, potentially less severe due to different trading patterns.

### 3. zxgngl (0xd235...0f29)

**Error:** $11.45M (100.00% underestimation)

| Metric | V29 | Dome | Delta |
|--------|-----|------|-------|
| Realized PnL | $92 | $11.45M | -$11.45M |

**Pattern:**
- V29 detected essentially ZERO realized PnL ($92)
- Missing: Entire $11.45M in realized gains
- 100% miss rate suggests complete data pipeline failure for this wallet

**Hypothesis:** Either no redemption/payout events captured, or inventory guard filtered out all valid trades.

---

## Small Wallet Performance (Control Group)

### Bottom 2 Wallets (Good Accuracy)

**0x1f0a...f7aa:**
- Error: $753 (0.64%)
- V29: $118.1K | Dome: $117.3K
- Status: ✅ **PASS**

**0xb48e...a144:**
- Error: $6.1K (5.30%)
- V29: $109.6K | Dome: $115.8K
- Status: ⚠️ Acceptable (within 10%)

**Pattern:** V29 works well for wallets with < $200K realized PnL. Error scales with wallet size.

---

## Anomaly: One Wallet Has V29 > Dome

**0x4ce7...abad:**
- V29: $19.85M
- Dome: $13.59M
- Delta: **+$6.27M (V29 overstates by 46%)**

**Possible Causes:**
1. Dome may not count certain transaction types (splits/merges/transfers?)
2. V29 may be double-counting some events
3. Different "realized" definitions

This suggests V29's issue is NOT simply "missing all data" but rather **selective missing of specific event types**.

---

## Root Cause Hypotheses (Ranked)

### Hypothesis 1: Missing Redemption/Payout Events ⭐⭐⭐⭐⭐

**Evidence:**
- 100% miss rate for zxgngl suggests complete absence of redemption tracking
- Dome definition: "Tracks realized gains only - from either confirmed sells or redeems"
- V29 may only count CLOB sells, not redemptions

**Where to Check:**
- `lib/pnl/inventoryEngineV29.ts` - Redemption event handling
- `pm_unified_ledger_v8_tbl` - Redemption/payout event types
- Event type classification logic

**Test:**
```sql
SELECT COUNT(*) FROM pm_unified_ledger_v8_tbl
WHERE wallet_address = '0x56687bf447db6ffa42ffe2204a05edaa20f55839'
  AND (
    event_description LIKE '%redeem%' OR
    event_description LIKE '%payout%' OR
    event_description LIKE '%claim%'
  )
```

### Hypothesis 2: Inventory Guard Too Aggressive ⭐⭐⭐⭐

**Evidence:**
- Preload shows 491,629 events loaded but only tiny realized PnL
- Events exist but may be filtered out
- Good accuracy for small wallets suggests guard works for simple cases

**Where to Check:**
- `lib/pnl/inventoryEngineV29.ts:line ~200-300` - Inventory guard logic
- Negative inventory protection rules
- Position closing detection

**Test:** Rerun validation with `inventoryGuard: false`

### Hypothesis 3: Resolution Price Coverage Gaps ⭐⭐⭐

**Evidence:**
- zxgngl showing $92 vs $11.45M suggests positions not marked as resolved
- If markets aren't recognized as resolved, positions stay "unrealized"

**Where to Check:**
- `vw_pm_resolution_prices` view
- Resolution price population logic
- 4,174 conditions resolved out of 4,471 (93%) - suggests some gaps

**Test:** Check resolution coverage for Theo4 conditions

### Hypothesis 4: CLOB Fill Deduplication Issues ⭐⭐

**Evidence:**
- pm_trader_events_v2 known to have duplicates
- If dedupe logic fails, could over-filter valid trades

**Where to Check:**
- V29 preload deduplication logic
- Event ID handling in batch loaders

---

## Data Pipeline Health Check

### Preload Performance
- ✅ 491,629 events loaded (avg 61,454/wallet)
- ✅ 4,471 unique conditions
- ✅ 4,174 resolution prices (93% coverage)
- ✅ Sub-15s preload time

**Verdict:** Data pipeline is operational and performant. Problem is NOT data availability but data USAGE.

### Event Distribution (Need Schema)

Unable to complete event census due to schema mismatch. The `pm_unified_ledger_v8_tbl` table structure needs investigation to identify event type classification.

**Action Item:** Run schema check to identify correct column names for event classification.

---

## Recommended Next Actions (Priority Order)

### P0: Immediate Investigation

1. **Check Redemption Event Handling**
   ```typescript
   // In lib/pnl/inventoryEngineV29.ts
   // Search for: redeem, payout, claim, settlement
   ```
   - Are redemptions counted in realizedPnl?
   - Are they classified correctly?
   - Do they trigger position closing?

2. **Test with Inventory Guard OFF**
   ```bash
   # Modify validator to add --no-guard flag
   # Rerun on Theo4 to see if realized PnL jumps
   ```

3. **Resolution Price Audit for Theo4**
   ```sql
   SELECT
     COUNT(DISTINCT l.condition_id) as total,
     COUNT(DISTINCT CASE WHEN r.resolved_price IS NOT NULL THEN l.condition_id END) as resolved
   FROM pm_unified_ledger_v8_tbl l
   LEFT JOIN vw_pm_resolution_prices r ON l.condition_id = r.condition_id
   WHERE l.wallet_address = '0x56687bf447db6ffa42ffe2204a05edaa20f55839'
   ```

### P1: Validation

4. **Compare V17 vs V29 Realized**
   - Run same 8 wallets through V17 engine
   - If V17 matches Dome → V29 regression
   - If V17 matches V29 → Both engines have same flaw

5. **Event Type Census**
   - Identify schema for event classification
   - Count redemption/payout events per wallet
   - Compare event coverage vs Dome

### P2: Code Audit

6. **Manual PnL Calculation for Theo4**
   - Pick one resolved market
   - Manually trace: buy → sell/redeem → realized calc
   - Identify exact step where V29 fails

7. **Dome API Definition Clarification**
   - Request Dome docs on "realized PnL" formula
   - Confirm: Does it include unredeemed resolved positions?
   - Validate event type inclusions

---

## One-Sentence Root Cause

**V29 realized PnL engine is missing redemption/payout events or filtering them out via inventory guard, causing 98-100% underestimation for high-volume wallets that heavily use position redemption vs CLOB selling.**

---

## Code Area to Check First

```
File: lib/pnl/inventoryEngineV29.ts
Lines: ~150-250 (position closing logic)
Search for: "redemption", "payout", "claim", "settlement"
Question: Are these event types properly classified and counted in realizedPnl?
```

**Specific Test:**
1. Add console.log for every event that increments realizedPnl
2. Run on Theo4
3. Check if any redemption events appear
4. If zero redemptions → Found root cause

---

**Terminal 2 Signed: 2025-12-07**
**Next Session:** Code-level investigation of redemption event handling in V29 engine
