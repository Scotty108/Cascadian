# Validation Test Suite: Reference Wallets

**Source:** Polymarket Analytics top traders list
**Purpose:** Validate P&L calculations against ground truth
**Test Strategy:** Multi-wallet spot-check after Phase 1 backfill

---

## Priority 1: Core Reference Wallets (MUST VALIDATE)

These are our original test wallets. All must be present in database after backfill.

| Wallet | Short Name | Expected P&L | Status | Notes |
|--------|-----------|--------------|--------|-------|
| 0x7f3c8979d0afa00007bae4747d5347122af05613 | LucasMeow | $179,243 | Currently $0 in DB | HIGH PRIORITY |
| 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b | xcnstrategy | $94,730 | Currently $0 in DB | HIGH PRIORITY |
| 0xa4b366ad22fc0d06f1e934ff468e8922431a87b8 | HolyMoses7 | $93,181 | Oct 31 snapshot target: $89,975.16 | MEDIUM PRIORITY |
| 0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0 | niggemon | $124,705 | Oct 31 snapshot target: $102,001.46 | REFERENCE (already validated) |

---

## Priority 2: Extended Test Suite (SHOULD VALIDATE)

Additional top traders to spot-check coverage and formula accuracy across diverse portfolios.

| Wallet | P&L | Win % | Tests | Rationale |
|--------|-----|-------|-------|-----------|
| 0x4ce73141dbfce41e65db3723e31059a730f0abad | $332,563 | 67.7% | Largest P&L, high volume | Test formula at scale |
| 0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144 | $114,087 | 78.3% | High win rate | Test formula on winner-heavy portfolio |
| 0x1f0a343513aa6060488fabe96960e6d1e177f7aa | $101,576 | 85.6% | Very high win rate | Edge case: concentrated wins |
| 0x06dcaa14f57d8a0573f5dc5940565e6de667af59 | $216,892 | 71.9% | Mid-large P&L | Balanced portfolio |
| 0x1489046ca0f9980fc2d9a950d103d3bec02c1307 | $137,663 | 93.0% | Highest win rate | Extreme edge case |
| 0x8e9eedf20dfa70956d49f608a205e402d9df38e4 | $360,492 | 84.1% | 3rd largest, high wins | Large + accurate portfolio |

---

## Validation Strategy

### Phase 1: Post-Backfill Checks

**Immediate (after rebuild scripts):**
```sql
-- Check all Priority 1 wallets are present
SELECT wallet, COUNT(*) as row_count
FROM outcome_positions_v2
WHERE wallet IN (
  lower('0x7f3c8979d0afa00007bae4747d5347122af05613'),
  lower('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'),
  lower('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8'),
  lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0')
)
GROUP BY wallet
ORDER BY wallet;
```

**Expected result:**
```
0x1489... : >0 rows  (xcnstrategy)
0x7f3c... : >0 rows  (LucasMeow)
0xa4b3... : >0 rows  (HolyMoses7)
0xeb6f... : >0 rows  (niggemon)
```

**GATE:** If any wallet shows 0 rows, backfill failed - investigate before proceeding.

---

### Phase 4: Comprehensive Validation

**After all tables rebuilt and daily sync configured:**

#### Step 1: Test niggemon (Reference Point)
```sql
WITH win AS (
  SELECT condition_id_norm, toInt16(win_idx) AS win_idx
  FROM winning_index
)
SELECT
  p.wallet,
  round(sum(toFloat64(c.cashflow_usdc)) - sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx), 2) AS realized_pnl,
  round(coalesce(u.unrealized_pnl_usd, 0), 2) AS unrealized_pnl,
  round(realized_pnl + unrealized_pnl, 2) AS total_pnl
FROM outcome_positions_v2 AS p
ANY LEFT JOIN trade_cashflows_v3 AS c
  ON (c.wallet = p.wallet) AND (c.market_id = p.market_id) AND (c.condition_id_norm = p.condition_id_norm)
ANY LEFT JOIN win AS w
  ON lower(replaceAll(w.condition_id_norm, '0x', '')) = lower(replaceAll(p.condition_id_norm, '0x', ''))
LEFT JOIN wallet_unrealized_pnl_v2 AS u ON u.wallet = p.wallet
WHERE p.wallet = lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0')
GROUP BY p.wallet, u.unrealized_pnl_usd;
```

**Expected:** $124,705 ± 2% = $122,211 to $127,199
**Acceptable:** Within -2.3% ± 2% of reference validation

---

#### Step 2: Test Priority 1 Wallets

Run same query for:
- `0x7f3c8979d0afa00007bae4747d5347122af05613` (LucasMeow) → Expected: $179,243 ± 5%
- `0xcce2b7c71f21e358b8e5e797e586cbc03160d58b` (xcnstrategy) → Expected: $94,730 ± 5%
- `0xa4b366ad22fc0d06f1e934ff468e8922431a87b8` (HolyMoses7) → Expected: $93,181 (allow ±5% for snapshot variance)

**Acceptance Criteria:**
- LucasMeow: $170,281 to $188,205
- xcnstrategy: $90,994 to $99,467
- HolyMoses7: $88,522 to $97,840

**If any fail:** Investigate calculation before deploying

---

#### Step 3: Quick Spot-Check on 3 Extended Test Wallets

Pick any 3 from Priority 2 and run validation query. Don't need exact match, just verify:
- Returns non-zero P&L (not $0.00)
- Value is within reasonable range (±10% of expected)
- Query executes without errors

**Example:**
```sql
-- For 0x4ce73141dbfce41e65db3723e31059a730f0abad (expected: $332,563)
WHERE p.wallet = lower('0x4ce73141dbfce41e65db3723e31059a730f0abad')
-- Expected result: $332,563 ± 10% = $299,307 to $365,819
```

---

## Validation Pass/Fail Rules

### ✅ PASS CRITERIA
- All Priority 1 wallets present (row count > 0)
- All Priority 1 wallets have P&L within ±5% of expected
- At least 3 Priority 2 wallets return non-zero P&L
- No SQL errors in validation queries
- Daily sync script runs without errors

### ❌ FAIL CRITERIA
Any of:
- Any Priority 1 wallet missing (0 rows)
- Any Priority 1 wallet shows $0.00 P&L
- Any Priority 1 wallet variance > ±5% (except HolyMoses7, allow ±10%)
- Validation queries error out
- Daily sync job fails

**If FAIL:** Do not proceed to Phase 5-6. Troubleshoot and revalidate.

---

## SQL Template for Batch Validation

Use this to test multiple wallets at once:

```sql
WITH win AS (
  SELECT condition_id_norm, toInt16(win_idx) AS win_idx
  FROM winning_index
),
wallet_pnl AS (
  SELECT
    p.wallet,
    round(sum(toFloat64(c.cashflow_usdc)) - sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx), 2) AS realized_pnl,
    round(coalesce(u.unrealized_pnl_usd, 0), 2) AS unrealized_pnl,
    round(realized_pnl + unrealized_pnl, 2) AS total_pnl
  FROM outcome_positions_v2 AS p
  ANY LEFT JOIN trade_cashflows_v3 AS c
    ON (c.wallet = p.wallet) AND (c.market_id = p.market_id) AND (c.condition_id_norm = p.condition_id_norm)
  ANY LEFT JOIN win AS w
    ON lower(replaceAll(w.condition_id_norm, '0x', '')) = lower(replaceAll(p.condition_id_norm, '0x', ''))
  LEFT JOIN wallet_unrealized_pnl_v2 AS u ON u.wallet = p.wallet
  WHERE p.wallet IN (
    lower('0x7f3c8979d0afa00007bae4747d5347122af05613'),  -- LucasMeow
    lower('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'),  -- xcnstrategy
    lower('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8'),  -- HolyMoses7
    lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0')   -- niggemon
  )
  GROUP BY p.wallet, u.unrealized_pnl_usd
)
SELECT
  wallet,
  total_pnl,
  CASE
    WHEN wallet = lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0') THEN 'niggemon (ref)'
    WHEN wallet = lower('0x7f3c8979d0afa00007bae4747d5347122af05613') THEN 'LucasMeow'
    WHEN wallet = lower('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b') THEN 'xcnstrategy'
    WHEN wallet = lower('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8') THEN 'HolyMoses7'
    ELSE 'Unknown'
  END as wallet_name
FROM wallet_pnl
ORDER BY total_pnl DESC;
```

---

## Expected Output After Passing Phase 1-4

```
wallet                                        | total_pnl | wallet_name
─────────────────────────────────────────────────────────────────────
0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0  | 124705.00 | niggemon (ref)
0x7f3c8979d0afa00007bae4747d5347122af05613  | 179243.00 | LucasMeow
0xcce2b7c71f21e358b8e5e797e586cbc03160d58b  |  94730.00 | xcnstrategy
0xa4b366ad22fc0d06f1e934ff468e8922431a87b8  |  93181.00 | HolyMoses7
```

(Values may vary ±5% due to real-time changes, but structure should match)

---

## Next Steps

1. **Execute Phase 1** (backfill trades)
2. **Run Priority 1 presence check** immediately after
3. **If all present:** Continue to Phase 2-3
4. **If any missing:** Stop and troubleshoot backfill
5. **After Phase 4 complete:** Run comprehensive validation query
6. **If all pass:** Proceed to Phase 5-6 deployment

---

**This validation suite gives us confidence that the system works across diverse wallet types and P&L ranges.**

**Ready to execute Phase 1. Post results when complete. 🚀**
