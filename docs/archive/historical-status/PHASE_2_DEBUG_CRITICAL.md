# CRITICAL: Phase 2 Validation Failed - Debug Protocol

**Status:** 🔴 BLOCKER FOUND - Do NOT deploy until resolved
**Issue:** 5 test wallets returning $0.00 when they should have P&L
**Priority:** URGENT - Fix before production

---

## The Problem

Query returned $0.00 for these wallets:
- 0x7f3c8979d0afa00007bae4747d5347122af05613
- 0x1489046ca0f9980fc2d9a950d103d3bec02c1307
- 0x8e9eedf20dfa70956d49f608a205e402d9df38e4
- 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b
- 0x6770bf688b8121331b1c5cfd7723ebd4152545fb

User confirms: These wallets SHOULD have P&L data

**Root cause:** Unknown - could be query issue, data pipeline, or wallet addressing

---

## Diagnostic Sequence (Run in Order)

### **Test 1: Wallet Existence Check (2 min)**

Check if these wallets have ANY trading data in the raw tables:

```sql
SELECT
  'trades_enriched_with_condition' as source,
  wallet_address,
  count() as trade_count,
  min(created_at) as first_trade,
  max(created_at) as last_trade
FROM trades_enriched_with_condition
WHERE lower(wallet_address) IN (
  lower('0x7f3c8979d0afa00007bae4747d5347122af05613'),
  lower('0x1489046ca0f9980fc2d9a950d103d3bec02c1307'),
  lower('0x8e9eedf20dfa70956d49f608a205e402d9df38e4'),
  lower('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'),
  lower('0x6770bf688b8121331b1c5cfd7723ebd4152545fb')
)
GROUP BY wallet_address
ORDER BY trade_count DESC

UNION ALL

SELECT
  'trades_raw' as source,
  wallet_address,
  count() as trade_count,
  min(block_time) as first_trade,
  max(block_time) as last_trade
FROM trades_raw
WHERE lower(wallet_address) IN (
  lower('0x7f3c8979d0afa00007bae4747d5347122af05613'),
  lower('0x1489046ca0f9980fc2d9a950d103d3bec02c1307'),
  lower('0x8e9eedf20dfa70956d49f608a205e402d9df38e4'),
  lower('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'),
  lower('0x6770bf688b8121331b1c5cfd7723ebd4152545fb')
)
GROUP BY wallet_address
ORDER BY trade_count DESC
```

**Expected:** Each wallet should show trade counts > 0
**If empty:** Wallets don't exist in database (data pipeline issue)
**If found:** Proceed to Test 2

---

### **Test 2: Resolution Coverage Check (2 min)**

Check if those trades have resolved positions:

```sql
SELECT
  wallet_address,
  count() as total_trades,
  countIf(is_resolved = 1) as resolved_trades,
  countIf(realized_pnl_usd IS NOT NULL) as with_pnl,
  sum(realized_pnl_usd) as total_pnl
FROM trades_enriched_with_condition
WHERE lower(wallet_address) IN (
  lower('0x7f3c8979d0afa00007bae4747d5347122af05613'),
  lower('0x1489046ca0f9980fc2d9a950d103d3bec02c1307'),
  lower('0x8e9eedf20dfa70956d49f608a205e402d9df38e4'),
  lower('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'),
  lower('0x6770bf688b8121331b1c5cfd7723ebd4152545fb')
)
GROUP BY wallet_address
ORDER BY total_trades DESC
```

**Expected:** Non-zero resolved_trades and pnl values
**If all zeros:** Positions aren't resolved yet (wait for market resolutions)
**If mixed:** Some wallets have data, query is partially broken

---

### **Test 3: Unrealized P&L Check (2 min)**

Check if those wallets show up in the unrealized table:

```sql
SELECT
  wallet,
  unrealized_pnl_usd,
  count() as appearances
FROM wallet_unrealized_pnl_v2
WHERE lower(wallet) IN (
  lower('0x7f3c8979d0afa00007bae4747d5347122af05613'),
  lower('0x1489046ca0f9980fc2d9a950d103d3bec02c1307'),
  lower('0x8e9eedf20dfa70956d49f608a205e402d9df38e4'),
  lower('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'),
  lower('0x6770bf688b8121331b1c5cfd7723ebd4152545fb')
)
GROUP BY wallet
ORDER BY abs(unrealized_pnl_usd) DESC
```

**Expected:** Non-zero unrealized values
**If found:** At least some wallets have open positions
**If empty:** Wallets have no positions at all

---

### **Test 4: Query Logic Verification (5 min)**

Run a SINGLE wallet manually to debug the query:

```sql
-- Pick one wallet that should have data (e.g., 0x7f3c...)
-- Test realized path
SELECT
  'Realized' as pnl_type,
  sum(realized_pnl_usd) as total_pnl,
  count() as row_count,
  countIf(is_resolved = 1) as resolved_count
FROM trades_enriched_with_condition
WHERE lower(wallet_address) = lower('0x7f3c8979d0afa00007bae4747d5347122af05613')

UNION ALL

-- Test unrealized path
SELECT
  'Unrealized' as pnl_type,
  unrealized_pnl_usd as total_pnl,
  1 as row_count,
  1 as resolved_count
FROM wallet_unrealized_pnl_v2
WHERE lower(wallet) = lower('0x7f3c8979d0afa00007bae4747d5347122af05613')
```

**This will show which path (realized vs unrealized) is working/broken**

---

### **Test 5: Table Cardinality (2 min)**

Check raw row counts to find the issue:

```sql
SELECT
  'trades_enriched_with_condition' as table_name,
  count() as total_rows,
  uniqExact(wallet_address) as unique_wallets
FROM trades_enriched_with_condition

UNION ALL

SELECT
  'outcome_positions_v2' as table_name,
  count() as total_rows,
  uniqExact(wallet) as unique_wallets
FROM outcome_positions_v2

UNION ALL

SELECT
  'trade_cashflows_v3' as table_name,
  count() as total_rows,
  uniqExact(wallet) as unique_wallets
FROM trade_cashflows_v3

UNION ALL

SELECT
  'wallet_unrealized_pnl_v2' as table_name,
  count() as total_rows,
  uniqExact(wallet) as unique_wallets
FROM wallet_unrealized_pnl_v2
```

**This shows if the tables are populated and have reasonable wallet counts**

---

## Likely Root Causes

| Cause | Evidence | Fix |
|-------|----------|-----|
| Wallet case mismatch | Test 1 finds data in trades_raw but not enriched | Use LOWER() in query |
| Wallets not ingested | Test 1 shows 0 rows in all tables | Re-run backfill for those wallets |
| No resolved positions | Test 2 shows 0 resolved_trades | Wait for market resolutions |
| Query filter bug | Tests 1-2 show data but query returns 0 | Fix JOIN or WHERE logic |
| Wrong column name | Column doesn't exist or is named differently | Check actual schema |
| Table mismatch | Data is in different table than expected | Switch to correct table |

---

## Critical Questions

1. **Do you know the expected P&L for these 5 wallets?**
   - This tells us if data should exist or wallets are inactive

2. **Can you confirm these are the correct wallet addresses?**
   - Typos in addresses would explain why we get no results

3. **Are these wallets from a different data source?**
   - If from Polymarket API vs blockchain, they might not be in the database

4. **When were these wallets last active?**
   - If inactive before snapshot date, they might legitimately have $0 realized

---

## Decision Point

**Before fixing, clarify:**

Run Test 1 and share the results. This will tell us:
- ✅ If wallets exist in database → Proceed to fix query logic
- ❌ If wallets don't exist → Need to backfill data or use different wallets

Once we know where the data is (or isn't), we can fix the issue and re-validate Phase 2.

---

## DO NOT DEPLOY

Until this is resolved. The $0.00 results indicate either:
1. A critical query bug that would affect all production queries
2. Data completeness issue for certain wallet addresses
3. Wallet addressing/format issue in the system

**This must be fixed before going live.**

