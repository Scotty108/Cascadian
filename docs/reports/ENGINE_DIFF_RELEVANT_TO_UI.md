# PnL Engine Comparison: V13-V22 Differences Relevant to UI Failures

**Date:** 2025-12-15
**Context:** 5 wallets failing UI spot check (see below)
**Goal:** Identify which engine approach matches UI best

---

## Executive Summary

**Key Finding:** The 5 UI failures represent 3 distinct architectural differences between engines:

1. **Role filtering** (V17 all roles → V18 maker-only)
2. **Deduplication strategy** (GROUP BY event_id vs table-level dedup)
3. **Fee inclusion** (implicit in cash flow vs explicit)
4. **CTF event handling** (included vs excluded)

**Recommendation:** Test V20/V22 (unified ledger approach) as they may handle non-CLOB activity better than V17/V18.

---

## Test Wallets (UI Spot Check Failures)

| Wallet | UI PnL | V18 PnL | Delta | Issue |
|--------|--------|---------|-------|-------|
| 0x35f0...b776 | +$3,291.63 | +$3,813.99 | +$522.36 (+15.9%) | V18 overcounting |
| 0x3439...4f64 | $0.00 | -$8,259.78 | -$8,259.78 | V18 showing massive phantom loss |
| 0x227c...a303 | -$278.07 | +$184.09 | +$462.16 (wrong sign!) | V18 flipped sign |
| 0x222a...103c | +$520.00 | $0.00 | -$520.00 | V18 missing entire profit |
| 0x0e5f...cf38 | -$399.79 | -$1.00 | +$398.79 | V18 drastically undercounting loss |

---

## Engine Architecture Comparison

### V13: CLOB-Only Weighted Average (Frozen 2025-12-03)

**Data Sources:**
- `pm_trader_events_v2` (CLOB fills) with GROUP BY event_id dedupe
- `pm_ctf_events` (splits/merges) for cost basis adjustments
- `pm_condition_resolutions` for payouts

**Fill Selection:**
```sql
SELECT ... FROM (
  SELECT any(...) FROM pm_trader_events_v2
  WHERE trader_wallet = ? AND is_deleted = 0
  GROUP BY event_id  -- Dedupe pattern
) fills
INNER JOIN pm_token_to_condition_map_v3 ON token_id
```

**Key Features:**
- ✅ Weighted average cost basis (FIFO-like)
- ✅ CTF splits/merges included at $0.50 cost basis
- ✅ NegRisk counted separately (stats only, not used in PnL)
- ❌ No role filtering (includes maker + taker)
- ❌ No fee accounting (fees implicit in USDC amounts)

**Validation:** 7/8 wallets pass (<25% error)

---

### V17: Cascadian Canonical (Frozen 2025-12-03)

**Data Sources:**
- `pm_trader_events_dedup_v2_tbl` (520M rows, pre-deduped)
- `pm_token_to_condition_map_v5` for outcome mapping
- Paired-outcome normalization (TypeScript post-processing)

**Fill Selection:**
```sql
SELECT any(...) FROM pm_trader_events_dedup_v2_tbl
WHERE trader_wallet = ?
GROUP BY event_id  -- Still needs dedupe (table has duplicates!)
```

**Paired-Outcome Normalization:**
```typescript
// Drop "hedge legs" from complete-set trades
// If same (tx_hash, condition_id) has both outcomes 0 and 1:
//   - Opposite directions (buy/sell)
//   - Matching amounts (±1 token epsilon)
// → Keep buy leg, drop sell leg
```

**Key Features:**
- ✅ All roles (maker + taker) for "total economic activity"
- ✅ Paired normalization prevents complete-set arbitrage double-counting
- ✅ Simple formula: `cash_flow + final_shares * resolution_price`
- ❌ Dedup table STILL has duplicates (requires GROUP BY)
- ❌ No CTF events (CLOB-only)
- ❌ No fee breakdown

**Validation:** Smart Money 1 matches within 0.05%

---

### V18: UI Parity Mode (Frozen 2025-12-03)

**Data Sources:**
- `pm_trader_events_v2` (same as V13)
- `pm_token_to_condition_map_v3`

**Fill Selection:**
```sql
SELECT ... FROM pm_trader_events_v2
WHERE trader_wallet = ?
  AND is_deleted = 0
  AND role = 'maker'  -- 🔑 KEY DIFFERENCE: Maker only!
GROUP BY event_id
```

**Rounding:**
```typescript
// Round per-position PnL to cents before summing
pos_realized_pnl = Math.round((cash_flow + final_shares * resolution_price) * 100) / 100;
```

**Key Features:**
- 🔑 **Maker-only filtering** (matches Polymarket UI attribution)
- ✅ Per-position rounding to cents (matches UI display)
- ✅ Simple aggregation (no paired normalization needed)
- ❌ Excludes taker fills (incomplete economic picture)
- ❌ No CTF events

**Validation:** Clean CLOB-only wallets achieve exact UI match

**Why Maker-Only?**
> "Polymarket UI attributes PnL to the maker side of each trade."
> — V18 engine header comment

---

### V19: Unified Ledger v6 (Production-Ready 2025-12-03)

**Data Sources:**
- `pm_unified_ledger_v6` (canonical ledger)
- Filters: `source_type = 'CLOB'` AND `condition_id IS NOT NULL`

**Fill Selection:**
```sql
SELECT
  sum(usdc_delta) AS cash_flow,
  sum(token_delta) AS final_tokens,
  any(payout_norm) AS resolution_price
FROM pm_unified_ledger_v6
WHERE wallet_address = ?
  AND source_type = 'CLOB'
  AND condition_id IS NOT NULL
  AND condition_id != ''  -- Exclude unmapped trades
GROUP BY condition_id, outcome_index
```

**Key Features:**
- ✅ Unified ledger (single source of truth)
- ✅ Excludes unmapped trades (prevents phantom losses)
- ✅ Simple aggregation (cash_flow + tokens)
- ❌ CLOB-only (excludes CTF events)
- ❌ No role filtering

**Validation:** 0.00% median error on CLOB-only wallets, 0.37% on mixed CTF+CLOB

---

### V20: Unified Ledger v7 - CANONICAL (Production 2025-12-03)

**Data Sources:**
- `pm_unified_ledger_v7` (with `pm_token_to_condition_map_v4`)

**Fill Selection:**
```sql
SELECT
  sum(usdc_delta) AS cash_flow,
  sum(token_delta) AS final_tokens,
  any(payout_norm) AS resolution_price
FROM pm_unified_ledger_v7
WHERE wallet_address = ?
  AND source_type = 'CLOB'
  AND condition_id IS NOT NULL
  AND condition_id != ''
GROUP BY condition_id, outcome_index
```

**Key Features:**
- ✅ Same as V19 but uses v7 ledger
- ✅ Matches PolymarketAnalytics.com within 0.01%
- ✅ Matches Polymarket UI within 0.01-2% for top 15 leaderboard wallets
- ❌ CLOB-only (no CTF, LP, AMM)

**Validation Status:** **CANONICAL for Cascadian v1**

---

### V22: Dual Formula (Experimental 2025-12-04)

**Data Sources:**
- `pm_unified_ledger_v7`
- Includes: CLOB, PayoutRedemption, PositionsMerge
- Excludes: Deposit, Withdrawal (funding events)

**Fill Selection:**
```sql
SELECT
  sumIf(usdc_delta, source_type = 'CLOB') AS clob_usdc,
  sumIf(usdc_delta, source_type = 'PayoutRedemption') AS redemption_usdc,
  sumIf(usdc_delta, source_type = 'PositionsMerge') AS merge_usdc,
  sum(token_delta) AS net_tokens,
  any(payout_norm) AS resolution_price
FROM pm_unified_ledger_v7
WHERE wallet_address = ?
  AND source_type NOT IN ('Deposit', 'Withdrawal')
GROUP BY condition_id, outcome_index
```

**Dual Formula Logic:**
```sql
-- Closed positions (|net_tokens| < 1): Pure cash flow
if(abs(net_tokens) < 1,
   clob_usdc + redemption_usdc + merge_usdc,
   0) AS pos_closed_pnl

-- Open resolved: cash_flow + net_tokens * resolution_price
if(abs(net_tokens) >= 1 AND resolution_price IS NOT NULL,
   clob_usdc + redemption_usdc + merge_usdc + net_tokens * resolution_price,
   0) AS pos_open_resolved_pnl

-- Open unresolved: cash_flow + net_tokens * 0.5
if(abs(net_tokens) >= 1 AND resolution_price IS NULL,
   clob_usdc + redemption_usdc + merge_usdc + net_tokens * 0.5,
   0) AS pos_open_unresolved_pnl
```

**Key Features:**
- ✅ Includes non-CLOB events (PayoutRedemption, PositionsMerge)
- ✅ Treats closed positions differently (avoids token valuation on zero holdings)
- ✅ Source breakdown (CLOB vs redemption vs merge USDC)
- ❌ Experimental (not validated)

**Hypothesis:** Should improve accuracy for wallets with CTF activity

---

## Failure Pattern Analysis

### Pattern 1: Overcounting (+15.9% error)
**Wallet:** 0x35f0...b776 (V18: +$3,814 vs UI: +$3,292)

**Possible Causes:**
- Maker-only filter missing taker fees that offset gains
- Paired-outcome trades not normalized (V17 has this, V18 doesn't)
- CTF events creating phantom gains

**Test:** V22 (includes redemptions) or V17 (has paired normalization)

---

### Pattern 2: Phantom Loss (UI: $0, V18: -$8,260)
**Wallet:** 0x3439...4f64

**Possible Causes:**
- **Most likely:** Unmapped trades (token_id not in condition map)
- Missing redemption events (user closed via CTF, not CLOB)
- Resolution price mismatch (V18 using wrong payout)

**Test:** V19/V20 (filters out unmapped trades) or V22 (includes redemptions)

---

### Pattern 3: Sign Flip (UI: -$278, V18: +$184)
**Wallet:** 0x227c...a303

**Possible Causes:**
- **Critical:** Fee accounting error (taker fees not subtracted)
- Maker-only filter flipping direction (user was net taker)
- Resolution applied to wrong outcome index

**Test:** V13/V17 (includes all roles) or V22 (explicit source breakdown)

---

### Pattern 4: Missing Profit (UI: +$520, V18: $0)
**Wallet:** 0x222a...103c

**Possible Causes:**
- Profit from redemption event (not in CLOB fills)
- Profit from taker fills (excluded by maker-only filter)
- Unmapped market (excluded by V18)

**Test:** V22 (includes redemptions) or V13/V17 (includes all roles)

---

### Pattern 5: Undercounting Loss (UI: -$400, V18: -$1)
**Wallet:** 0x0e5f...cf38

**Possible Causes:**
- Loss from redemption at unfavorable resolution
- Loss from unmapped market (excluded)
- Rounding error masking large position

**Test:** V22 (includes redemptions, dual formula for closed positions)

---

## Recommended Test Sequence

### Phase 1: Quick Wins (No Code Changes)
1. **Run V20 on all 5 wallets**
   - V20 is canonical and validated on top 15 leaderboard
   - If V20 matches better, it's a V18 architecture issue (maker-only is wrong)

2. **Run V22 on all 5 wallets**
   - V22 includes redemptions/merges (may fix patterns 2, 4, 5)
   - Dual formula may fix pattern 1 (overcounting on closed positions)

### Phase 2: Deep Dive (If V20/V22 Don't Match)
3. **Run V13 on wallet 0x227c...a303** (sign flip case)
   - V13 includes all roles → tests "maker-only flipped direction" hypothesis

4. **Run V17 on wallet 0x35f0...b776** (overcounting case)
   - V17 has paired normalization → tests "complete-set arbitrage" hypothesis

### Phase 3: Root Cause (If Still Failing)
5. **Manual query for wallet 0x3439...4f64** (phantom loss)
   ```sql
   -- Check for unmapped trades
   SELECT count(*) FROM pm_trader_events_v2
   WHERE trader_wallet = '0x3439...'
     AND token_id NOT IN (SELECT token_id_dec FROM pm_token_to_condition_map_v3);

   -- Check for redemptions
   SELECT sum(usdc_delta) FROM pm_unified_ledger_v7
   WHERE wallet_address = '0x3439...'
     AND source_type = 'PayoutRedemption';
   ```

6. **Fee audit for wallet 0x227c...a303** (sign flip)
   ```sql
   -- Check if user was net taker (would be excluded by V18)
   SELECT
     sumIf(usdc_amount, role = 'maker') as maker_usdc,
     sumIf(usdc_amount, role = 'taker') as taker_usdc
   FROM pm_trader_events_v2
   WHERE trader_wallet = '0x227c...';
   ```

---

## Expected Outcomes by Engine

| Wallet | UI PnL | Expected V20 | Expected V22 | Hypothesis |
|--------|--------|--------------|--------------|------------|
| 0x35f0 | +$3,292 | +$3,200-$3,400 | +$3,250-$3,350 | V22 dual formula fixes overcounting |
| 0x3439 | $0 | -$100 to +$100 | -$50 to +$50 | V22 redemptions fix phantom loss |
| 0x227c | -$278 | -$250 to -$300 | -$260 to -$290 | All-roles fixes sign flip |
| 0x222a | +$520 | +$450 to $550 | +$500 to $540 | V22 redemptions find missing profit |
| 0x0e5f | -$400 | -$350 to -$450 | -$380 to -$420 | V22 redemptions capture full loss |

---

## Summary Table: Key Differences

| Feature | V13 | V17 | V18 | V19 | V20 | V22 |
|---------|-----|-----|-----|-----|-----|-----|
| **Data Source** | pm_trader_events_v2 | pm_trader_events_dedup_v2_tbl | pm_trader_events_v2 | pm_unified_ledger_v6 | pm_unified_ledger_v7 | pm_unified_ledger_v7 |
| **Role Filter** | All | All | **Maker only** | All | All | All |
| **Dedupe** | GROUP BY event_id | GROUP BY event_id | GROUP BY event_id | Ledger aggregation | Ledger aggregation | Ledger aggregation |
| **CTF Events** | Splits/Merges | No | No | No | No | **Redemptions/Merges** |
| **Paired Normalization** | No | **Yes** | No | No | No | No |
| **Fee Handling** | Implicit | Implicit | Implicit | Implicit | Implicit | **Explicit breakdown** |
| **Rounding** | None | None | **Cents** | None | **Cents** | None |
| **Unmapped Trades** | Included | Included | Included | **Excluded** | **Excluded** | **Excluded** |
| **Status** | Frozen | Frozen | Frozen | Production | **Canonical** | Experimental |

---

## Next Steps

1. **Set up .env.local** with ClickHouse credentials
2. **Run test script** (`scripts/pnl/compare-v13-v18-v19-v20-v22.ts`)
3. **Document results** in this file (update "Expected Outcomes" with actuals)
4. **Identify winning engine** per wallet
5. **Propose architecture change** if V18 is consistently wrong

**Estimated Time:** 30 minutes (5 min setup + 15 min run + 10 min analysis)
