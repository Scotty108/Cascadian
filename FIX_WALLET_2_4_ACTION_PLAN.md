# Action Plan: Fix Wallet 2-4 Resolution Data Gap

**Issue**: Wallets 2-4 show zero resolved conditions despite expected P&L
**Timeline**: 6-10 hours total
**Difficulty**: Medium
**Status**: Ready to execute

---

## Root Cause Summary

From `WALLET_RESOLUTION_GAP_INVESTIGATION.md`:

1. **trades_raw.condition_id field is empty** for wallets 2-4
2. **market_resolutions_final table doesn't exist** (referenced but never created)
3. Data exists in blockchain, just needs enrichment/parsing

**NOT a Substreams problem** - We already have the raw blockchain data

---

## 4-Step Fix Plan

### Step 1: Audit Current Data State (30 min)

**Goal**: Understand exactly what's missing

```sql
-- Check condition_id coverage
SELECT
  CASE
    WHEN condition_id IS NULL OR condition_id = '' THEN 'empty'
    ELSE 'populated'
  END as status,
  COUNT(*) as trades,
  COUNT(DISTINCT wallet_address) as wallets
FROM trades_raw
GROUP BY status;

-- Check specific wallets
SELECT
  wallet_address,
  COUNT(*) as total_trades,
  SUM(CASE WHEN condition_id IS NULL OR condition_id = '' THEN 1 ELSE 0 END) as missing_condition_id
FROM trades_raw
WHERE lower(wallet_address) IN (
  '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8', -- HolyMoses7
  '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0', -- niggemon
  '0x0e9e7ce245fae8bd563cf3c2fa5693c97da93e47', -- Wallet 3
  '0x2fffd6a9b421b80c69eab16c8bbde21d28663bc0'  -- Wallet 4
)
GROUP BY wallet_address;

-- Check if market_resolutions_final exists
SHOW TABLES LIKE '%resolution%';
```

**Expected Output**:
- If `condition_id` is empty → Need Step 2
- If `market_resolutions_final` doesn't exist → Need Step 3

---

### Step 2: Backfill condition_id Field (2-3 hours)

**Goal**: Populate `condition_id` from existing blockchain data

#### Option A: From ctf_token_map (Recommended)
```sql
-- Preview the join
SELECT
  t.wallet_address,
  t.market_id,
  t.outcome_index,
  c.condition_id,
  COUNT(*) as trades
FROM trades_raw t
LEFT JOIN ctf_token_map c
  ON t.market_id = c.market_id
  AND t.outcome_index = c.outcome_index
WHERE lower(t.wallet_address) IN (
  '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
  '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0',
  '0x0e9e7ce245fae8bd563cf3c2fa5693c97da93e47',
  '0x2fffd6a9b421b80c69eab16c8bbde21d28663bc0'
)
  AND (t.condition_id IS NULL OR t.condition_id = '')
GROUP BY 1, 2, 3, 4
LIMIT 20;

-- If results look good, apply update
-- NOTE: Use **Atomic Rebuild** (AR) pattern from CLAUDE.md
CREATE TABLE trades_raw_enriched AS
SELECT
  t.*,
  COALESCE(t.condition_id, c.condition_id) as condition_id_enriched
FROM trades_raw t
LEFT JOIN ctf_token_map c
  ON t.market_id = c.market_id
  AND t.outcome_index = c.outcome_index;

-- Verify
SELECT COUNT(*) FROM trades_raw_enriched WHERE condition_id_enriched IS NOT NULL;

-- If good, rename swap
RENAME TABLE trades_raw TO trades_raw_backup;
RENAME TABLE trades_raw_enriched TO trades_raw;
```

#### Option B: From ERC1155 Events (If Option A fails)
```sql
-- Join to pm_erc1155_flats to extract condition_id from token transfers
CREATE TABLE trades_raw_enriched AS
SELECT
  t.*,
  COALESCE(
    t.condition_id,
    substring(e.token_id, 1, 64) -- First 32 bytes = condition_id
  ) as condition_id_enriched
FROM trades_raw t
LEFT JOIN pm_erc1155_flats e
  ON t.transaction_hash = e.tx_hash
  AND t.wallet_address = e.from_address
WHERE e.event_type IN ('single', 'batch');

-- Verify and rename swap (same as Option A)
```

**Verification**:
```sql
-- Should now show populated condition_id
SELECT
  COUNT(*) as total_trades,
  SUM(CASE WHEN condition_id IS NOT NULL AND condition_id != '' THEN 1 ELSE 0 END) as with_condition_id
FROM trades_raw
WHERE lower(wallet_address) IN (
  '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
  '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0',
  '0x0e9e7ce245fae8bd563cf3c2fa5693c97da93e47',
  '0x2fffd6a9b421b80c69eab16c8bbde21d28663bc0'
);
```

---

### Step 3: Create market_resolutions_final Table (1-2 hours)

**Goal**: Store market resolution data (winner, payout, timestamp)

#### 3A: Define Schema
```sql
CREATE TABLE market_resolutions_final (
  market_id String,
  condition_id String,
  condition_id_norm String, -- lowercase, no 0x prefix
  question_id String,
  question String,
  resolved_at DateTime,
  winner String, -- outcome name
  winning_index UInt8,
  payout_numerators Array(UInt256),
  payout_denominator UInt256,
  resolution_source String, -- 'clob_api', 'dune', 'blockchain'
  created_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(created_at)
ORDER BY (market_id, condition_id_norm);
```

#### 3B: Populate from Polymarket CLOB API (Recommended)
```typescript
// Script: scripts/backfill-market-resolutions.ts
import "dotenv/config";
import { createClient } from "@clickhouse/client";

const POLYMARKET_API = "https://clob.polymarket.com";

async function fetchResolvedMarkets() {
  const response = await fetch(`${POLYMARKET_API}/markets?closed=true&limit=1000`);
  const markets = await response.json();

  return markets
    .filter(m => m.resolved)
    .map(m => ({
      market_id: m.condition_id,
      condition_id: m.condition_id,
      condition_id_norm: m.condition_id.toLowerCase().replace('0x', ''),
      question_id: m.question_id,
      question: m.question,
      resolved_at: new Date(m.end_date_iso),
      winner: m.outcomes[m.winner_index],
      winning_index: m.winner_index,
      payout_numerators: m.payout_numerators || [],
      payout_denominator: m.payout_denominator || 1,
      resolution_source: 'clob_api'
    }));
}

async function main() {
  const ch = createClient({
    url: process.env.CLICKHOUSE_HOST,
    username: process.env.CLICKHOUSE_USER,
    password: process.env.CLICKHOUSE_PASSWORD,
    database: process.env.CLICKHOUSE_DATABASE
  });

  console.log("Fetching resolved markets from Polymarket CLOB API...");
  const resolutions = await fetchResolvedMarkets();
  console.log(`Found ${resolutions.length} resolved markets`);

  console.log("Inserting into ClickHouse...");
  await ch.insert({
    table: 'market_resolutions_final',
    values: resolutions,
    format: 'JSONEachRow'
  });

  console.log("✅ Done!");
}

main();
```

**Run**:
```bash
npx tsx scripts/backfill-market-resolutions.ts
```

#### 3C: Alternative - Populate from Dune Analytics
```sql
-- Export from Dune query:
-- https://dune.com/queries/polymarket-resolved-markets
-- Then import CSV to ClickHouse

clickhouse-client --query="
  INSERT INTO market_resolutions_final
  SELECT
    market_id,
    condition_id,
    lower(replace(condition_id, '0x', '')) as condition_id_norm,
    question_id,
    question,
    parseDateTime64BestEffort(resolved_at) as resolved_at,
    winner,
    winning_index,
    splitByString(',', payout_numerators) as payout_numerators,
    payout_denominator,
    'dune' as resolution_source
  FROM input('market_id String, condition_id String, ...')
  FORMAT CSV
" < polymarket_resolutions.csv
```

**Verification**:
```sql
SELECT
  COUNT(*) as total_resolutions,
  COUNT(DISTINCT condition_id_norm) as unique_conditions,
  resolution_source,
  min(resolved_at) as earliest,
  max(resolved_at) as latest
FROM market_resolutions_final
GROUP BY resolution_source;
```

---

### Step 4: Calculate Realized P&L (2-3 hours)

**Goal**: Join trades with resolutions and calculate P&L

#### 4A: Create Realized P&L View
```sql
-- Apply **PNL** skill from CLAUDE.md
CREATE VIEW wallet_realized_pnl AS
SELECT
  t.wallet_address as wallet,
  t.market_id,
  t.condition_id,
  t.outcome,
  t.outcome_index,
  t.side,
  SUM(cast(t.shares as Float64)) as total_shares,
  AVG(cast(t.entry_price as Float64)) as avg_entry_price,
  SUM(cast(t.usd_value as Float64)) as cost_basis,
  r.winner,
  r.winning_index,
  r.payout_numerators,
  r.payout_denominator,
  -- PnL formula: shares * (payout_numerators[winning_index + 1] / payout_denominator) - cost_basis
  CASE
    WHEN r.winning_index IS NOT NULL THEN
      cast(SUM(cast(t.shares as Float64)) as Float64) *
      (cast(arrayElement(r.payout_numerators, r.winning_index + 1) as Float64) / cast(r.payout_denominator as Float64))
      - cast(SUM(cast(t.usd_value as Float64)) as Float64)
    ELSE
      NULL
  END as realized_pnl_usd,
  r.resolved_at,
  COUNT(*) as trade_count
FROM trades_raw t
LEFT JOIN market_resolutions_final r
  ON lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
WHERE r.winning_index IS NOT NULL -- Only resolved markets
GROUP BY
  t.wallet_address,
  t.market_id,
  t.condition_id,
  t.outcome,
  t.outcome_index,
  t.side,
  r.winner,
  r.winning_index,
  r.payout_numerators,
  r.payout_denominator,
  r.resolved_at;
```

#### 4B: Test on Wallet 1 (Control)
```sql
SELECT
  wallet,
  COUNT(DISTINCT market_id) as resolved_markets,
  SUM(realized_pnl_usd) as total_realized_pnl,
  SUM(CASE WHEN realized_pnl_usd > 0 THEN 1 ELSE 0 END) as winning_trades,
  SUM(CASE WHEN realized_pnl_usd < 0 THEN 1 ELSE 0 END) as losing_trades
FROM wallet_realized_pnl
WHERE lower(wallet) = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8' -- HolyMoses7
GROUP BY wallet;
```

**Expected**: Should match existing Wallet 1 results (74 resolved conditions)

#### 4C: Test on Wallets 2-4
```sql
SELECT
  wallet,
  COUNT(DISTINCT market_id) as resolved_markets,
  SUM(realized_pnl_usd) as total_realized_pnl,
  SUM(CASE WHEN realized_pnl_usd > 0 THEN 1 ELSE 0 END) as winning_trades,
  SUM(CASE WHEN realized_pnl_usd < 0 THEN 1 ELSE 0 END) as losing_trades
FROM wallet_realized_pnl
WHERE lower(wallet) IN (
  '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0', -- niggemon
  '0x0e9e7ce245fae8bd563cf3c2fa5693c97da93e47', -- Wallet 3
  '0x2fffd6a9b421b80c69eab16c8bbde21d28663bc0'  -- Wallet 4
)
GROUP BY wallet;
```

**Expected**: Should now show non-zero resolved markets (was zero before)

#### 4D: Create Combined P&L Summary
```sql
-- Combine realized + unrealized P&L
CREATE VIEW wallet_pnl_complete AS
SELECT
  COALESCE(r.wallet, u.wallet) as wallet,
  SUM(r.realized_pnl_usd) as realized_pnl,
  SUM(u.unrealized_pnl_usd) as unrealized_pnl,
  SUM(r.realized_pnl_usd) + SUM(u.unrealized_pnl_usd) as total_pnl,
  COUNT(DISTINCT r.market_id) as resolved_markets,
  COUNT(DISTINCT u.market_id) as open_positions
FROM wallet_realized_pnl r
FULL OUTER JOIN portfolio_mtm_detailed u
  ON r.wallet = u.wallet
GROUP BY wallet;
```

**Verification**:
```sql
SELECT * FROM wallet_pnl_complete
WHERE lower(wallet) IN (
  '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
  '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0',
  '0x0e9e7ce245fae8bd563cf3c2fa5693c97da93e47',
  '0x2fffd6a9b421b80c69eab16c8bbde21d28663bc0'
);
```

**Expected**:
- All 4 wallets should show non-zero values
- Realized + unrealized P&L both populated
- Match expected P&L from Polymarket UI

---

## Success Criteria

### All 4 Checks Must Pass

```sql
-- Check 1: condition_id populated
SELECT
  COUNT(*) as trades_with_condition_id
FROM trades_raw
WHERE (condition_id IS NOT NULL AND condition_id != '')
  AND lower(wallet_address) IN (
    '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
    '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0',
    '0x0e9e7ce245fae8bd563cf3c2fa5693c97da93e47',
    '0x2fffd6a9b421b80c69eab16c8bbde21d28663bc0'
  );
-- Expected: > 20,000 (most/all trades)

-- Check 2: market_resolutions_final populated
SELECT COUNT(*) as total_resolutions FROM market_resolutions_final;
-- Expected: > 1,000 (sufficient for test)

-- Check 3: Wallet 2-4 have resolved markets
SELECT
  wallet,
  COUNT(DISTINCT market_id) as resolved_markets
FROM wallet_realized_pnl
WHERE lower(wallet) IN (
  '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0',
  '0x0e9e7ce245fae8bd563cf3c2fa5693c97da93e47',
  '0x2fffd6a9b421b80c69eab16c8bbde21d28663bc0'
)
GROUP BY wallet;
-- Expected: Each wallet > 0 (was 0 before)

-- Check 4: Total P&L looks reasonable
SELECT
  wallet,
  total_pnl
FROM wallet_pnl_complete
WHERE lower(wallet) IN (
  '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
  '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0',
  '0x0e9e7ce245fae8bd563cf3c2fa5693c97da93e47',
  '0x2fffd6a9b421b80c69eab16c8bbde21d28663bc0'
)
ORDER BY total_pnl DESC;
-- Expected:
-- - niggemon: ~$99K (from READY_FOR_UI_DEPLOYMENT.md)
-- - HolyMoses7: Known value
-- - Wallets 3-4: Non-zero
```

---

## Timeline Summary

| Step | Time | Difficulty | Blocker? |
|------|------|-----------|----------|
| 1. Audit current state | 30 min | Easy | No |
| 2. Backfill condition_id | 2-3 hours | Medium | If ctf_token_map incomplete |
| 3. Create resolutions table | 1-2 hours | Easy | If CLOB API rate-limited |
| 4. Calculate realized P&L | 2-3 hours | Medium | If formula incorrect |
| **Total** | **6-10 hours** | **Medium** | **Unlikely** |

---

## Rollback Plan

If something goes wrong:

```sql
-- Rollback Step 2 (condition_id)
RENAME TABLE trades_raw TO trades_raw_failed;
RENAME TABLE trades_raw_backup TO trades_raw;

-- Rollback Step 3 (resolutions)
DROP TABLE market_resolutions_final;

-- Rollback Step 4 (P&L views)
DROP VIEW wallet_realized_pnl;
DROP VIEW wallet_pnl_complete;
```

No risk to existing system - all changes are additive.

---

## Next Steps After Success

1. ✅ Update API routes to use `wallet_pnl_complete` view
2. ✅ Deploy UI with realized + unrealized P&L
3. ✅ Validate against Polymarket UI for all 4 wallets
4. ✅ Document in `READY_FOR_UI_DEPLOYMENT.md`

---

## References

- **Issue Investigation**: `WALLET_RESOLUTION_GAP_INVESTIGATION.md`
- **Current System Status**: `READY_FOR_UI_DEPLOYMENT.md`
- **Data Quality**: `CLOB_BACKFILL_RECOMMENDATIONS.md`
- **Skills Reference**: `CLAUDE.md` (IDN, PNL, AR, GATE)

---

**Created By**: Claude Code (Cascadian Project)
**Date**: 2025-11-07
**Status**: ✅ Ready to execute
