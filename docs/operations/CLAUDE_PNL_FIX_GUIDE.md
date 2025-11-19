# Claude Guide: Fix P&L System (The Right Way)

**Status:** Phases 1-2 completed but exposed wrong blocker
**Real Problem:** ID normalization + NULL handling, NOT missing midprices
**Do NOT:** Backfill midprices yet (delisted markets return empty orderbooks)

---

## The Real Issue

We built three-layer P&L views but made critical errors:

1. **ID Truncation Bug:** Truncated condition_ids to "market_ids" by replacing last 2 chars with "00" without proving this mapping is correct
2. **NULL Coalescing Bug:** Coalesced missing midprices to $0, making unrealized P&L negative instead of marking as AWAITING
3. **Dirty Resolutions:** Used warehouse data with empty payout vectors
4. **No Join Validation:** Never proved joins work on a single wallet before going system-wide

Result: $333K gap is NOT from missing midprices—it's from broken joins + NULL handling.

---

## The Fix (6 Steps)

### Step 1: Freeze Identifiers ⚠️ CRITICAL

**Problem:** We're deriving market_id by truncating condition_id, but this mapping is unproven.

**Action:** Build canonical ID mapping table

```typescript
// Create mapping table
CREATE TABLE cascadian_clean.token_condition_market_map (
  token_id_erc1155 String,          -- Full ERC1155 token ID
  condition_id_32b String,          -- 32-byte condition ID (normalized)
  market_id_cid String,             -- Market-level CID
  created_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(created_at)
ORDER BY (token_id_erc1155);

// Populate from trades
INSERT INTO cascadian_clean.token_condition_market_map
SELECT DISTINCT
  token_id,                                                           -- From ERC1155 transfers
  lower(replaceAll(condition_id, '0x', '')) as condition_id_32b,     -- Normalize
  concat('0x', left(lower(replaceAll(condition_id, '0x', '')), 62), '00') as market_id_cid
FROM default.vw_trades_canonical
WHERE condition_id != '' AND token_id != '';
```

**Validation Query:**
```sql
-- Should show consistent mapping (1 token → 1 condition → 1 market)
SELECT
  count(DISTINCT token_id_erc1155) as tokens,
  count(DISTINCT condition_id_32b) as conditions,
  count(DISTINCT market_id_cid) as markets
FROM cascadian_clean.token_condition_market_map;
```

**Files to Create:**
- `step1-build-id-mapping.ts`

---

### Step 2: Build "Truth" Resolutions View 🎯 HIGH PRIORITY

**Problem:** warehouse has empty payout vectors; resolutions_src_api has no payouts

**Action:** Create vw_resolutions_truth with strict filtering

```sql
CREATE OR REPLACE VIEW cascadian_clean.vw_resolutions_truth AS
SELECT
  cid_hex as condition_id_32b,
  winning_index,
  payout_numerators,
  payout_denominator,
  resolved_at,
  'blockchain' as source
FROM cascadian_clean.resolutions_by_cid
WHERE payout_denominator > 0
  AND length(payout_numerators) > 0
  AND arraySum(payout_numerators) = payout_denominator  -- Sum must equal denominator
  AND winning_index >= 0
  AND (resolved_at IS NULL OR resolved_at <= now())
```

**Validation Queries:**
```sql
-- Should show 176 rows (current resolutions_by_cid count)
SELECT count(*) FROM cascadian_clean.vw_resolutions_truth;

-- Should show all valid payouts
SELECT
  condition_id_32b,
  payout_numerators,
  payout_denominator,
  arraySum(payout_numerators) as sum_check
FROM cascadian_clean.vw_resolutions_truth
LIMIT 10;
```

**Files to Create:**
- `step2-build-truth-resolutions.ts`

---

### Step 3: Prove Join Correctness on One Wallet 🔍 VALIDATION

**Problem:** Never validated joins work before building system-wide views

**Action:** Create diagnostic script for audit wallet (0x4ce73141dbfce41e65db3723e31059a730f0abad)

```typescript
// For each of wallet's 30 positions, show:
// - token_id_erc1155
// - condition_id_32b (from mapping)
// - market_id_cid (from mapping)
// - found_in_resolutions (yes/no)
// - has_valid_payout (yes/no)

SELECT
  p.token_id,
  m.condition_id_32b,
  m.market_id_cid,
  CASE WHEN r.condition_id_32b IS NOT NULL THEN 'YES' ELSE 'NO' END as found_in_resolutions,
  CASE WHEN r.payout_denominator > 0 THEN 'YES' ELSE 'NO' END as has_valid_payout,
  r.payout_numerators,
  r.payout_denominator
FROM (
  SELECT DISTINCT token_id, condition_id_norm
  FROM default.vw_trades_canonical
  WHERE lower(wallet_address_norm) = lower('0x4ce73141dbfce41e65db3723e31059a730f0abad')
    AND condition_id_norm != ''
) p
LEFT JOIN cascadian_clean.token_condition_market_map m
  ON lower(replaceAll(p.condition_id_norm, '0x', '')) = m.condition_id_32b
LEFT JOIN cascadian_clean.vw_resolutions_truth r
  ON m.condition_id_32b = r.condition_id_32b
ORDER BY has_valid_payout DESC, found_in_resolutions DESC;
```

**Expected Output:**
```
30 positions total
X with found_in_resolutions = YES (proves mapping works)
Y with has_valid_payout = YES (proves resolutions_truth has data)
```

**If Y = 0:** Test wallet has no settled positions (expected - markets still open)
**If X = 0:** Mapping is broken (MUST FIX before continuing)

**Files to Create:**
- `step3-validate-wallet-joins.ts`

---

### Step 4: Fix P&L Layering and NULL Handling 🛠️ IMPLEMENTATION

**Problem:** Coalescing missing midprices to $0 makes unrealized P&L negative

**Action:** Rebuild three views with proper NULL handling

#### Layer 1: vw_wallet_pnl_closed (No Changes Needed)
```sql
-- Already correct - trading P&L only
-- Keep as-is
```

#### Layer 2: vw_wallet_pnl_all (FIX NULL HANDLING)
```sql
CREATE OR REPLACE VIEW cascadian_clean.vw_wallet_pnl_all AS
WITH positions AS (
  SELECT
    lower(wallet_address_norm) AS wallet,
    condition_id_norm,
    toInt32(outcome_index) AS outcome,
    sumIf(toFloat64(shares), trade_direction = 'BUY') - sumIf(toFloat64(shares), trade_direction = 'SELL') AS shares_net,
    sumIf(if(trade_direction = 'BUY', -toFloat64(entry_price) * toFloat64(shares), toFloat64(entry_price) * toFloat64(shares)), 1) AS cash_net
  FROM default.vw_trades_canonical
  WHERE condition_id_norm != ''
    AND outcome_index >= 0
  GROUP BY wallet, condition_id_norm, outcome
  HAVING abs(shares_net) >= 0.01
),
unrealized AS (
  SELECT
    p.wallet,
    -- NEVER coalesce to 0! Use NULL to indicate missing data
    sum(
      CASE
        WHEN m.midprice IS NOT NULL AND m.midprice > 0 THEN
          p.shares_net * (m.midprice - (-p.cash_net / nullIf(p.shares_net, 0)))
        ELSE NULL  -- Not coalesce(0) - leave NULL!
      END
    ) AS unrealized_pnl,
    countIf(m.midprice IS NOT NULL AND m.midprice > 0) AS positions_with_prices,
    count(*) AS total_positions
  FROM positions p
  LEFT JOIN cascadian_clean.token_condition_market_map map
    ON lower(replaceAll(p.condition_id_norm, '0x', '')) = map.condition_id_32b
  LEFT JOIN cascadian_clean.midprices_latest m
    ON map.market_id_cid = m.market_cid AND p.outcome = m.outcome
  GROUP BY p.wallet
)
SELECT
  coalesce(c.wallet, u.wallet) AS wallet,
  coalesce(c.realized_pnl, 0) AS realized_pnl,
  u.unrealized_pnl AS unrealized_pnl,  -- Can be NULL!
  CASE
    WHEN u.unrealized_pnl IS NULL THEN NULL
    ELSE coalesce(c.realized_pnl, 0) + u.unrealized_pnl
  END AS total_pnl,
  coalesce(u.total_positions, 0) AS open_positions,
  coalesce(u.positions_with_prices, 0) AS positions_with_prices,
  CASE
    WHEN u.positions_with_prices = 0 THEN 'AWAITING_QUOTES'
    WHEN u.positions_with_prices >= u.total_positions * 0.95 THEN 'EXCELLENT'
    WHEN u.positions_with_prices >= u.total_positions * 0.75 THEN 'GOOD'
    WHEN u.positions_with_prices >= u.total_positions * 0.5 THEN 'PARTIAL'
    ELSE 'LIMITED'
  END AS coverage_quality
FROM cascadian_clean.vw_wallet_pnl_closed c
FULL OUTER JOIN unrealized u ON c.wallet = u.wallet;
```

#### Layer 3: vw_wallet_pnl_settled (FIX JOINS)
```sql
CREATE OR REPLACE VIEW cascadian_clean.vw_wallet_pnl_settled AS
WITH positions AS (
  SELECT
    lower(wallet_address_norm) AS wallet,
    condition_id_norm,
    toInt32(outcome_index) AS outcome,
    sumIf(toFloat64(shares), trade_direction = 'BUY') - sumIf(toFloat64(shares), trade_direction = 'SELL') AS shares_net,
    sumIf(if(trade_direction = 'BUY', -toFloat64(entry_price) * toFloat64(shares), toFloat64(entry_price) * toFloat64(shares)), 1) AS cash_net
  FROM default.vw_trades_canonical
  WHERE condition_id_norm != ''
    AND outcome_index >= 0
  GROUP BY wallet, condition_id_norm, outcome
  HAVING abs(shares_net) >= 0.01
),
redemption AS (
  SELECT
    p.wallet,
    sum(
      p.shares_net * (arrayElement(r.payout_numerators, p.outcome + 1) / r.payout_denominator)
      + p.cash_net
    ) AS redemption_pnl,
    count(*) AS positions_settled,
    sum(abs(p.shares_net * (-p.cash_net / nullIf(p.shares_net, 0)))) AS settled_value
  FROM positions p
  INNER JOIN cascadian_clean.token_condition_market_map map
    ON lower(replaceAll(p.condition_id_norm, '0x', '')) = map.condition_id_32b
  INNER JOIN cascadian_clean.vw_resolutions_truth r
    ON map.condition_id_32b = r.condition_id_32b
  WHERE r.payout_denominator > 0
  GROUP BY p.wallet
)
SELECT
  coalesce(c.wallet, r.wallet) AS wallet,
  coalesce(c.realized_pnl, 0) AS trading_pnl,
  coalesce(r.redemption_pnl, 0) AS redemption_pnl,
  coalesce(r.redemption_pnl, 0) AS total_pnl,
  coalesce(r.positions_settled, 0) AS positions_settled,
  coalesce(r.settled_value, 0) AS settled_value
FROM cascadian_clean.vw_wallet_pnl_closed c
FULL OUTER JOIN redemption r ON c.wallet = r.wallet;
```

**Files to Create:**
- `step4-rebuild-pnl-views-fixed.ts`

---

### Step 5: Ship Completeness Stats with Every Wallet 📊 TELEMETRY

**Action:** Add coverage metadata to wallet responses

```typescript
// When returning wallet P&L, include:
{
  wallet: "0x4ce7...",
  pnl: {
    closed: -494.52,
    all: null,  // Can be NULL!
    settled: 0.00
  },
  coverage: {
    positions_with_quotes: 2,
    total_positions: 30,
    quote_coverage_pct: 6.7,
    positions_with_payouts: 0,
    payout_coverage_pct: 0.0,
    last_price_update: "2025-11-09T18:27:58Z",
    coverage_quality: "AWAITING_QUOTES"
  }
}
```

**Global Dashboard Query:**
```sql
SELECT
  count(DISTINCT market_id_cid) as total_traded_markets,
  countIf(r.condition_id_32b IS NOT NULL) as markets_with_payouts,
  (countIf(m.midprice > 0) / count(*) * 100)::Float64 as quote_coverage_pct,
  countIf(r.resolved_at >= today()) as newly_resolved_today
FROM cascadian_clean.token_condition_market_map map
LEFT JOIN cascadian_clean.vw_resolutions_truth r
  ON map.condition_id_32b = r.condition_id_32b
LEFT JOIN cascadian_clean.midprices_latest m
  ON map.market_id_cid = m.market_cid;
```

**Files to Create:**
- `step5-coverage-telemetry.ts`

---

### Step 6: Decide on Price Backfill (ONLY AFTER ABOVE) 🚫 DEFERRED

**Do NOT run midprice backfill yet because:**
- Delisted markets return empty orderbooks (won't help)
- We don't know which markets are active vs delisted
- Broken joins mean backfill would mask the real problem

**After Steps 1-5 work, THEN decide:**
```sql
-- Find markets that are active (have recent trades)
SELECT DISTINCT market_id_cid
FROM cascadian_clean.token_condition_market_map map
WHERE EXISTS (
  SELECT 1 FROM default.vw_trades_canonical t
  WHERE lower(replaceAll(t.condition_id_norm, '0x', '')) = map.condition_id_32b
    AND t.timestamp >= now() - INTERVAL 7 DAY
)
AND NOT EXISTS (
  SELECT 1 FROM cascadian_clean.midprices_latest m
  WHERE m.market_cid = map.market_id_cid
);
```

Only backfill these markets (ignore delisted ones).

---

## Definition of Done ✅

**Before marking complete, verify:**

1. ✅ **ID Mapping:** token_condition_market_map has consistent 1:1:1 mapping
2. ✅ **Truth View:** vw_resolutions_truth has 176 valid payouts, sum(payout_numerators) = payout_denominator
3. ✅ **Join Validation:** Audit wallet diagnostic shows X positions found in resolutions (even if Y with payouts = 0)
4. ✅ **NULL Handling:** Layer 2 returns NULL unrealized_pnl (not $0) when quotes missing
5. ✅ **Layer 3 Joins:** Layer 3 uses mapping table and vw_resolutions_truth
6. ✅ **Telemetry:** Wallet responses include coverage stats, dashboard shows global metrics
7. ✅ **12 Wallet Audit:** All 12 audit wallets show sensible Closed/All/Settled (where applicable)
8. ✅ **One-Page Report:** Document lists payout sources and counts

**Final Validation Query:**
```sql
-- Test wallet should show:
-- Closed: -$494.52 (same as before)
-- All: NULL or partial (not -$1,171)
-- Settled: $0 (expected - no settled positions)
-- Coverage: AWAITING_QUOTES

SELECT * FROM cascadian_clean.vw_wallet_pnl_all
WHERE wallet = lower('0x4ce73141dbfce41e65db3723e31059a730f0abad');
```

---

## Execution Order

**Day 1 (2-3 hours):**
1. Create step1-build-id-mapping.ts → Run → Validate consistent mapping
2. Create step2-build-truth-resolutions.ts → Run → Validate 176 rows
3. Create step3-validate-wallet-joins.ts → Run → Prove joins work

**Day 2 (2-3 hours):**
4. Create step4-rebuild-pnl-views-fixed.ts → Run → Test wallet shows NULL not $0
5. Create step5-coverage-telemetry.ts → Run → Dashboard shows metrics
6. Run all 12 audit wallets → Verify definition of done

**Day 3 (1 hour):**
7. Document findings → One-page report
8. Decide if midprice backfill is worthwhile (probably not for delisted markets)

---

## Critical Reminders

- **NEVER coalesce missing midprices to $0** - leave NULL and mark "AWAITING"
- **NEVER truncate condition_ids without proving the mapping** - use mapping table
- **NEVER use warehouse or empty payout data** - use vw_resolutions_truth only
- **ALWAYS validate joins on one wallet before going system-wide**
- **ALWAYS ship coverage stats with every wallet response**

---

## Why This Fixes the $333K Gap

**Current (broken):**
- Truncated condition_ids → broken joins → 0 resolutions found
- Coalesced missing prices to $0 → negative unrealized P&L
- Result: -$1,171 (wrong)

**After fix:**
- Proper ID mapping → joins work
- NULL handling → unrealized shows NULL (not negative)
- Coverage telemetry → users know data is incomplete
- Result: Closed = -$494.52, All = NULL (AWAITING_QUOTES), Settled = $0 (correct)

**User sees:**
```
Trading P&L: -$494.52 ✅
Unrealized P&L: AWAITING QUOTES (2/30 positions priced)
Settled P&L: $0.00 (0/30 positions settled)

⚠️ Coverage: 6.7% - Most markets delisted, quotes unavailable
```

This is HONEST and CORRECT (not broken).

---

## Files to Create (Summary)

1. `step1-build-id-mapping.ts` - Create and populate token_condition_market_map
2. `step2-build-truth-resolutions.ts` - Create vw_resolutions_truth with strict filtering
3. `step3-validate-wallet-joins.ts` - Diagnostic for audit wallet (prove joins work)
4. `step4-rebuild-pnl-views-fixed.ts` - Rebuild all three views with NULL handling + mapping
5. `step5-coverage-telemetry.ts` - Add coverage stats to responses + global dashboard
6. `step6-audit-12-wallets.ts` - Run all audit wallets through the system
7. `PAYOUT_SOURCES_REPORT.md` - One-page report of payout sources and counts

---

## Next Move

Start with Step 1: `step1-build-id-mapping.ts`

Build the token_condition_market_map table and validate the mapping is consistent before touching anything else.
