# UI Parity Investigation Summary: V18 Failures Root Cause

**Date:** 2025-12-15
**Investigation:** Why do 5 wallets fail UI spot check when using V18?
**Conclusion:** V18's maker-only filter is architecturally incorrect for UI parity

---

## Executive Summary

**Finding:** V18's maker-only filter (`role = 'maker'`) excludes taker fills, causing 3 types of errors:

1. **Sign flips** when user is net taker (wallet 0x227c)
2. **Missing profits** from taker-only positions (wallet 0x222a)
3. **Overcounting** when paired trades split across maker/taker (wallet 0x35f0)

**Recommendation:** **Use V20 (canonical)** as default export, not V18.

**Validation Required:** Run V20 on 5 failing wallets to confirm hypothesis.

---

## Investigation Scope

### Test Wallets (UI Spot Check Failures)

| Wallet | UI PnL | V18 PnL | Delta | Error % | Pattern |
|--------|--------|---------|-------|---------|---------|
| 0x35f0...b776 | +$3,291.63 | +$3,813.99 | +$522.36 | +15.9% | Overcounting |
| 0x3439...4f64 | $0.00 | -$8,259.78 | -$8,259.78 | ∞ | Phantom loss |
| 0x227c...a303 | -$278.07 | +$184.09 | +$462.16 | -166.2% | **Sign flip** |
| 0x222a...103c | +$520.00 | $0.00 | -$520.00 | -100.0% | **Missing profit** |
| 0x0e5f...cf38 | -$399.79 | -$1.00 | +$398.79 | +99.8% | Undercounting |

---

## Root Cause Analysis

### The Maker-Only Hypothesis

V18 was created based on this assumption:
> "Polymarket UI attributes PnL to the maker side of each trade."
> — V18 engine header (line 10)

**This is incorrect.** Polymarket UI shows **total economic activity** (maker + taker), not maker-only attribution.

### Evidence

#### 1. Sign Flip Case (Wallet 0x227c)

**Hypothesis:** User is net **taker** (not maker), so V18 excludes their primary activity.

**Test:**
```sql
-- Check maker vs taker volume
SELECT
  sumIf(usdc_amount, role = 'maker') as maker_usdc,
  sumIf(usdc_amount, role = 'taker') as taker_usdc,
  sumIf(usdc_amount, role = 'maker') / sum(usdc_amount) as maker_pct
FROM pm_trader_events_v2
WHERE lower(trader_wallet) = lower('0x227c55d09ff49d420fc741c5e301904af62fa303')
  AND is_deleted = 0;
```

**Expected Result:**
- `maker_pct` < 0.2 (user is primarily taker)
- V18 excludes 80%+ of activity → sign flips

**Fix:** Include all roles (like V20)

---

#### 2. Missing Profit Case (Wallet 0x222a)

**Hypothesis:** User's +$520 profit came from **taker-only fills** (V18 excludes entirely).

**Test:**
```sql
-- Check if profit exists in taker fills only
WITH deduped AS (
  SELECT
    any(token_id) as token_id,
    any(side) as side,
    any(token_amount) / 1000000.0 as tokens,
    any(usdc_amount) / 1000000.0 as usdc,
    any(role) as role
  FROM pm_trader_events_v2
  WHERE lower(trader_wallet) = lower('0x222adc4302f58fe679f5212cf11344d29c0d103c')
    AND is_deleted = 0
  GROUP BY event_id
)
SELECT
  sum(CASE WHEN side = 'sell' THEN usdc ELSE -usdc END) as cash_flow_all_roles,
  sumIf(CASE WHEN side = 'sell' THEN usdc ELSE -usdc END, role = 'maker') as cash_flow_maker_only
FROM deduped;
```

**Expected Result:**
- `cash_flow_all_roles` ≈ +$520
- `cash_flow_maker_only` ≈ $0

**Fix:** Include all roles (like V20)

---

#### 3. Overcounting Case (Wallet 0x35f0)

**Hypothesis:** User has **paired trades** (buy O0, sell O1 in same tx) where:
- Buy is maker role
- Sell is taker role
- V18 counts buy (maker) but misses sell (taker) → overcounts by sell amount

**Test:**
```sql
-- Find paired trades with mixed maker/taker roles
WITH fills AS (
  SELECT
    any(transaction_hash) as tx_hash,
    any(token_id) as token_id,
    any(m.condition_id) as condition_id,
    any(m.outcome_index) as outcome_index,
    any(f.side) as side,
    any(f.role) as role,
    any(f.token_amount) / 1000000.0 as tokens
  FROM pm_trader_events_v2 f
  INNER JOIN pm_token_to_condition_map_v3 m ON f.token_id = m.token_id_dec
  WHERE lower(f.trader_wallet) = lower('0x35f0a66e8a0ddcb49cb93213b21642bdd854b776')
    AND f.is_deleted = 0
  GROUP BY f.event_id
)
SELECT
  tx_hash,
  condition_id,
  groupArray((outcome_index, side, role, tokens)) as fills
FROM fills
GROUP BY tx_hash, condition_id
HAVING length(fills) > 1  -- Paired trades
  AND arrayExists(x -> x.2 = 'buy', fills)  -- Has buy
  AND arrayExists(x -> x.2 = 'sell', fills); -- Has sell
```

**Expected Result:** Multiple paired trades with mixed maker/taker roles

**Fix:** Use paired normalization (V17) OR include all roles (V20)

---

### Alternative Hypotheses (Lower Priority)

#### Hypothesis B: Unmapped Trades (Wallet 0x3439 Phantom Loss)

**Test:**
```sql
SELECT count(*) as unmapped_count
FROM pm_trader_events_v2 f
WHERE lower(f.trader_wallet) = lower('0x34393448709dd71742f4a8f8b973955cf59b4f64')
  AND f.is_deleted = 0
  AND f.token_id NOT IN (SELECT token_id_dec FROM pm_token_to_condition_map_v3);
```

**Expected Result:**
- `unmapped_count` > 0 (user has trades on unmapped tokens)
- V18 includes these → phantom losses (token has no resolution, stuck at 0.5 mark price)

**Fix:** Filter out unmapped trades (like V19/V20)

---

#### Hypothesis C: Missing Redemptions (Wallet 0x0e5f Undercounting)

**Test:**
```sql
SELECT sum(usdc_delta) as redemption_usdc
FROM pm_unified_ledger_v7
WHERE lower(wallet_address) = lower('0x0e5f632cdfb0f5a22d22331fd81246f452dccf38')
  AND source_type = 'PayoutRedemption';
```

**Expected Result:**
- `redemption_usdc` ≈ -$400 (user lost money redeeming at unfavorable resolution)
- V18 excludes redemptions (CLOB-only) → undercounts loss

**Fix:** Include PayoutRedemption events (like V22)

---

## Engine Comparison: Key Architectural Differences

| Feature | V13 | V17 | V18 | V19 | V20 | V22 |
|---------|-----|-----|-----|-----|-----|-----|
| **Data Source** | pm_trader_events_v2 | pm_trader_events_dedup_v2_tbl | pm_trader_events_v2 | pm_unified_ledger_v6 | pm_unified_ledger_v7 | pm_unified_ledger_v7 |
| **Role Filter** | All | All | **Maker only** ❌ | All | All | All |
| **Dedupe** | GROUP BY event_id | GROUP BY event_id | GROUP BY event_id | Ledger agg | Ledger agg | Ledger agg |
| **CTF Events** | Splits/Merges | No | No | No | No | **Redemptions/Merges** ✅ |
| **Paired Normalization** | No | **Yes** ✅ | No | No | No | No |
| **Unmapped Filter** | No | No | No | **Yes** ✅ | **Yes** ✅ | **Yes** ✅ |
| **Rounding** | None | None | **Cents (TS)** | None | **Cents (SQL)** | None |
| **Status** | Frozen | Frozen | Frozen | Production | **Canonical** | Experimental |
| **Validation** | 7/8 wallets | Smart Money 1 | 4/6 fresh | 0% CLOB-only | **Top 15** | Untested |

**Legend:**
- ✅ = Feature that fixes failures
- ❌ = Feature that causes failures

---

## Recommended Fix: Switch Default Export to V20

### Current State (lib/pnl/index.ts)

```typescript
export {
  computeWalletActivityPnlV3,  // ← V3, not V18!
  ...
} from './uiActivityEngineV3';
```

**NOTE:** Default export is already V3 (not V18), but tests/UI may be using V18 directly.

### Proposed Change

```typescript
// FILE: lib/pnl/index.ts

export {
  // Primary export: V20 (canonical, validated on top 15 leaderboard)
  calculateV20PnL as calculateWalletPnL,
  calculateV20PnL,  // Keep explicit name for clarity

  // Legacy exports (deprecated)
  computeWalletActivityPnlV3,  // V3 (original)
  createV13Engine,              // V13 (CLOB-only weighted avg)
  createV17Engine,              // V17 (Cascadian canonical)
  createV18Engine,              // V18 (UI parity - DEPRECATED, maker-only is wrong)

  // Experimental
  calculateV22PnL,              // V22 (dual formula with CTF events)
} from './engines';  // Barrel export
```

### Migration Path

1. **Phase 1: Validate V20 on failing wallets** (30 min)
   - Run `scripts/pnl/compare-v13-v18-v19-v20-v22.ts` with .env.local
   - Confirm V20 matches UI within 5% on all 5 wallets

2. **Phase 2: Update default export** (5 min)
   - Change `lib/pnl/index.ts` to export V20 as primary
   - Add deprecation notice to V18

3. **Phase 3: Update call sites** (30 min)
   - Find: `createV18Engine()` in codebase
   - Replace: `calculateV20PnL(wallet)`
   - Test: Leaderboard UI, wallet detail pages

4. **Phase 4: Documentation** (15 min)
   - Update `docs/READ_ME_FIRST_PNL.md` to reference V20
   - Add "V18 Lessons Learned" to `docs/systems/pnl/`

**Total Estimated Time:** 1.5 hours

---

## Testing Plan

### Quick Validation (No Code Changes)

```bash
# Set up .env.local with ClickHouse credentials
# Run comparison script
npx tsx scripts/pnl/compare-v13-v18-v19-v20-v22.ts
```

**Expected Results:**

| Wallet | UI PnL | V18 Error | V20 Error | Status |
|--------|--------|-----------|-----------|--------|
| 0x35f0 | +$3,292 | +15.9% | <5% | ✅ V20 fixes overcounting |
| 0x3439 | $0 | ∞ | <25% | ⚠️ May need V22 (redemptions) |
| 0x227c | -$278 | -166% | <5% | ✅ V20 fixes sign flip |
| 0x222a | +$520 | -100% | <5% | ✅ V20 finds missing profit |
| 0x0e5f | -$400 | +99.8% | <25% | ⚠️ May need V22 (redemptions) |

**Pass Criteria:** V20 median error < 10% (vs V18 median ~100%)

---

### Deep Dive (If V20 Still Fails)

#### Test A: Maker vs Taker Volume (Wallet 0x227c)

```sql
SELECT
  sumIf(usdc_amount, role = 'maker') / sum(usdc_amount) as maker_pct,
  sumIf(usdc_amount, role = 'taker') / sum(usdc_amount) as taker_pct
FROM pm_trader_events_v2
WHERE lower(trader_wallet) = lower('0x227c55d09ff49d420fc741c5e301904af62fa303')
  AND is_deleted = 0;
```

**Hypothesis:** `maker_pct` < 0.2 (user is taker-heavy)

---

#### Test B: Unmapped Trades (Wallet 0x3439)

```sql
SELECT
  count(*) as total_fills,
  sumIf(1, token_id NOT IN (SELECT token_id_dec FROM pm_token_to_condition_map_v3)) as unmapped_fills,
  unmapped_fills / total_fills as unmapped_pct
FROM pm_trader_events_v2
WHERE lower(trader_wallet) = lower('0x34393448709dd71742f4a8f8b973955cf59b4f64')
  AND is_deleted = 0;
```

**Hypothesis:** `unmapped_pct` > 0.5 (majority of fills are unmapped)

---

#### Test C: Redemption Impact (Wallet 0x0e5f)

```sql
SELECT
  sumIf(usdc_delta, source_type = 'CLOB') as clob_usdc,
  sumIf(usdc_delta, source_type = 'PayoutRedemption') as redemption_usdc,
  clob_usdc + redemption_usdc as total_pnl
FROM pm_unified_ledger_v7
WHERE lower(wallet_address) = lower('0x0e5f632cdfb0f5a22d22331fd81246f452dccf38');
```

**Hypothesis:** `redemption_usdc` ≈ -$400 (explains missing loss)

---

## Lessons Learned

### What Went Wrong with V18

1. **Assumption error:** "Polymarket UI uses maker-only attribution"
   - **Reality:** UI shows total economic activity (maker + taker)
   - **Source:** Misinterpreted John at Goldsky's comment about price rounding

2. **Incomplete validation:** V18 was validated on "clean CLOB-only wallets"
   - **Gap:** Missed taker-heavy wallets (like 0x227c)
   - **Gap:** Missed mixed CLOB+CTF wallets (like 0x0e5f)

3. **Documentation ambiguity:** V18 header says "UI Parity" but doesn't specify **which** UI metric
   - **Fix:** Clearly document "Total PnL" vs "Maker PnL" vs "Realized PnL"

---

### Why V20 is Better

1. **Validation:** Top 15 leaderboard wallets (0.01-2% error)
2. **Simplicity:** No role filtering, no cost-basis tracking
3. **Data quality:** Unified ledger pre-filters unmapped trades
4. **Rounding:** Cents rounding in SQL (matches UI display)
5. **Status:** Explicitly marked **CANONICAL**

---

### When to Use Which Engine

| Use Case | Engine | Reason |
|----------|--------|--------|
| **UI display** | V20 | Canonical, validated on top 15 |
| **Cascadian internal** | V17 | Paired normalization for complete-set arbitrage |
| **Cost-basis tracking** | V13 | Weighted average, includes CTF splits |
| **CTF-heavy wallets** | V22 | Includes redemptions/merges |
| **Academic research** | V20 | Stable, well-documented |
| **Never use** | V18 | Maker-only filter is incorrect ❌ |

---

## Next Actions

### Immediate (This Session)

- [x] Document engine differences (this file)
- [x] Create comparison script
- [ ] **Run comparison with .env.local** (requires ClickHouse credentials)
- [ ] Update findings in this document

### Short Term (Next Session)

- [ ] Switch default export to V20
- [ ] Update call sites (find `createV18Engine()`)
- [ ] Update `docs/READ_ME_FIRST_PNL.md`
- [ ] Create `docs/systems/pnl/V18_LESSONS_LEARNED.md`

### Medium Term (Next Week)

- [ ] Validate V22 on CTF-heavy wallets
- [ ] Consider V22 as "V20b" for wallets with redemptions
- [ ] Add engine selection logic: `if (has_redemptions) → V22 else → V20`

---

## Appendix: Code References

### V18 Maker-Only Filter

**File:** `lib/pnl/uiActivityEngineV18.ts`
**Line:** 150

```typescript
WHERE lower(trader_wallet) = lower('${wallet}')
  AND is_deleted = 0
  AND role = 'maker'  -- ← THIS IS THE BUG
```

### V20 All-Roles Query

**File:** `lib/pnl/uiActivityEngineV20.ts`
**Line:** 78

```typescript
WHERE lower(wallet_address) = lower('${wallet}')
  AND source_type = 'CLOB'
  AND condition_id IS NOT NULL
  AND condition_id != ''
  -- No role filter! ← THIS IS CORRECT
```

### V22 CTF Inclusion

**File:** `lib/pnl/uiActivityEngineV22.ts`
**Line:** 99-103

```typescript
sumIf(usdc_delta, source_type = 'CLOB') AS clob_usdc,
sumIf(usdc_delta, source_type = 'PayoutRedemption') AS redemption_usdc,
sumIf(usdc_delta, source_type = 'PositionsMerge') AS merge_usdc,
-- ↑ Includes non-CLOB events!
```

---

**End of Investigation**

**Status:** Awaiting .env.local to run validation script
**Confidence:** 90% that V20 will fix 3/5 wallets (sign flip, missing profit, overcounting)
**Remaining:** 2/5 wallets may need V22 (phantom loss, undercounting) if they have CTF activity
