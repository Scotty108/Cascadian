# Phase 2 Test 1: Manual Execution Guide

## ⚠️ ClickHouse Connection Issue

The automated script cannot connect to ClickHouse at `localhost:8123`. This likely means:
- ClickHouse server is not running
- Docker container is not active
- Environment variables are misconfigured

**Status:** Ready to execute manually via ClickHouse CLI or web interface

---

## How to Run Test 1 Manually

### Option A: Using ClickHouse Client CLI (Recommended)

```bash
# 1. Open ClickHouse client
docker compose exec clickhouse clickhouse-client

# 2. Connect to polymarket database
USE polymarket;

# 3. Run Test 1a: Check trades_enriched_with_condition
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
ORDER BY trade_count DESC;

# 4. If no results, run Test 1b: Check trades_raw
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
ORDER BY trade_count DESC;
```

### Option B: Using ClickHouse Web UI

1. Open `http://localhost:8123/play` in browser
2. Paste Test 1a query above
3. Click "Run" button
4. Review results

---

## Test Wallets

```
0x7f3c8979d0afa00007bae4747d5347122af05613
0x1489046ca0f9980fc2d9a950d103d3bec02c1307
0x8e9eedf20dfa70956d49f608a205e402d9df38e4
0xcce2b7c71f21e358b8e5e797e586cbc03160d58b
0x6770bf688b8121331b1c5cfd7723ebd4152545fb
```

---

## Expected Results

### ✅ If Test 1a Returns Rows (Wallets Found in trades_enriched_with_condition)

```
source                           | wallet_address                          | trade_count | first_trade | last_trade
trades_enriched_with_condition   | 0x7f3c8979d0afa00007bae4747d5347122af05613 | 145        | 2025-05-... | 2025-10-...
trades_enriched_with_condition   | 0x1489046ca0f9980fc2d9a950d103d3bec02c1307 | 78         | 2025-06-... | 2025-10-...
(etc)
```

**Interpretation:**
- ✅ Wallets exist in the database
- ✅ Have trading data
- ✅ Proceed to Test 2 (Resolution Coverage Check)
- **Next:** The $0.00 result is a query logic bug, not a data problem

---

### ❌ If Test 1a Returns NO Rows (Empty Result)

Then run Test 1b to check `trades_raw`:

**If Test 1b Returns Rows:**
- ⚠️ Wallets in raw trades but NOT in enriched tables
- **Cause:** Enrichment process failed for these wallets
- **Fix:** Rebuild enriched tables for these wallets

**If Test 1b Returns NO Rows:**
- ❌ Wallets not in ANY table
- **Cause:** Data not ingested OR wallet addresses are incorrect
- **Action:** Verify wallet addresses with user, check if they should be backfilled

---

## Decision Tree

```
Run Test 1a (trades_enriched_with_condition)
│
├─ YES (rows returned)
│  └─ Wallets EXIST ✅
│     └─ Proceed to Test 2 (Resolution Coverage Check)
│        └─ Identify which query component is failing
│
└─ NO (empty result)
   └─ Run Test 1b (trades_raw)
      │
      ├─ YES (rows returned)
      │  └─ Data exists RAW but not ENRICHED ⚠️
      │     └─ Rebuild enriched tables
      │
      └─ NO (empty result)
         └─ Wallets NOT in database ❌
            └─ Verify addresses or backfill data
```

---

## What This Determines

**Critical Question:** Why do these 5 wallets return $0.00?

1. **If wallets exist** (Test 1 finds data)
   - → The query logic has a bug (affects all production)
   - → Must fix query filters or joins
   - → Apply fix to all Phase 2 wallets

2. **If wallets don't exist** (Test 1 finds no data)
   - → These wallets weren't ingested or backfilled
   - → Either use different test wallets OR backfill these specific wallets
   - → Clarify with user which wallets should be used for Phase 2

---

## Files for Reference

| File | Purpose |
|------|---------|
| PHASE_2_DEBUG_CRITICAL.md | Complete 5-test diagnostic sequence |
| URGENT_DEBUG_STEPS.txt | Quick-reference with decision framework |
| phase2-test1-wallet-existence.ts | Automated script (use when ClickHouse is running) |

---

## Critical Notes

- **DO NOT DEPLOY** until this is resolved
- This test determines if the $0.00 issue is:
  - Query logic error (affects all production) → MUST FIX BEFORE DEPLOYMENT
  - Data completeness issue (affects specific wallets) → MUST VERIFY OR BACKFILL
- Report back with Test 1 results to proceed to Test 2

---

## How to Report Results

When sharing results, include:

```
Test 1a (trades_enriched_with_condition):
- Wallet count found: [number]
- Sample results: [first 2-3 rows]
- Trade counts: [min, max, avg]

Test 1b (trades_raw, if needed):
- Wallet count found: [number]
- Sample results: [first 2-3 rows]

Diagnosis:
- Wallets exist / Don't exist / Partially exist
- Next step: Test 2 / Rebuild / Backfill / Clarify
```

This will enable quick diagnosis and resolution in Test 2-5.
