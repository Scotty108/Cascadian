# C1 Wallet Canonicalization Directive

**Date:** 2025-11-16 (PST)
**To:** C1 (Database Agent)
**From:** Main Agent
**Priority:** 🔴 CRITICAL - Blocks all PnL validation
**Status:** Ready for Execution

---

## Executive Context

### The Smoking Gun

You successfully recovered the Xi Jinping market (1,833 trades) through XCN attribution repair. However, validation against Polymarket API revealed **massive discrepancies (50x-2,000x off)**:

| Metric | Expected (Polymarket API) | Actual (ClickHouse) | Discrepancy |
|--------|---------------------------|---------------------|-------------|
| **Cost (BUY)** | ~$12,400 | $626,173.90 | **+4,949%** (50x) |
| **Net Shares** | ~53,683 | -1,218,145.22 | **Wrong sign, 2,269% off** |
| **Realized P&L** | ~$41,289 | -$475,090.38 | **Wrong sign, 1,150% off** |

### Root Cause Identified

**The fundamental issue is NOT data corruption—it's wallet attribution:**

**Polymarket API reports positions at the ACCOUNT wallet:**
```
0xcce2b7c71f21e358b8e5e797e586cbc03160d58b  ← "Account" (UI/API level)
```

**ClickHouse stores trades at the EXECUTOR wallet:**
```
0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e  ← "Executor" (on-chain proxy)
```

**Proof:**
- Querying Polymarket API for `0xcce2...d58b` shows Xi market position (~$41k profit)
- Querying ClickHouse for `0xcce2...d58b` returns 0 trades (because trades executed via `0x4bfb...982e`)
- `erc20_transfers_decoded` shows hundreds of thousands of transfers for `0x4bfb...982e`
- `erc20_transfers_decoded` shows minimal/no activity for `0xcce2...d58b`

**This affects ALL wallets, not just XCN.** The executor→account translator is missing from our data model.

---

## Mission & Deliverables

### Your Objective

Build a **staging-environment wallet canonicalization system** that:

1. **Maps executor wallets → account wallets** via `wallet_identity_map` table
2. **Exposes canonical wallet** in all trades via new views
3. **Validates Xi market** against Polymarket API (must match within ±10%)
4. **Provides migration path** for C2/C3/dashboards
5. **Implements ingest guardrails** to prevent future drift

### Critical Success Criteria

✅ Xi market PnL matches Polymarket API within ±10%
✅ Zero wallet collisions in canonical mapping
✅ All trades preserve `wallet_raw` for audit trail
✅ Validation script confirms correctness
✅ Rollout documentation ready for downstream agents

---

## Phase 1: Exploration (Launch Explore Agents)

**IMPORTANT:** You do NOT know the complete schema landscape. Before building anything, launch **three explore agents** to gather intelligence:

### Explore Agent 1: Schema Scanner

**Task:** Find all tables/views containing wallet address columns

**Prompt:**
```
Search the ClickHouse schema for all tables and views that contain wallet address fields
(wallet_address, wallet, trader, account, user_address, etc.). For each table found:
1. Table name
2. Column name for wallet field
3. Row count
4. Sample query showing first 5 rows
5. Any existing wallet-related indexes or constraints

Focus on: pm_trades_*, erc20_transfers_*, wallet_*, clob_fills_*, any materialized views.
```

**Expected Findings:**
- `pm_trades_canonical_v3.wallet_address`
- `erc20_transfers_decoded.wallet` (or similar)
- Any existing wallet mapping tables
- Any views already doing wallet transformations

### Explore Agent 2: XCN Validator

**Task:** Prove the executor→account relationship with hard evidence

**Prompt:**
```
Validate the XCN wallet relationship hypothesis:

Account wallet: 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b
Executor wallet: 0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e

Run these queries:
1. Count trades in pm_trades_canonical_v3 for each wallet
2. Check erc20_transfers_decoded for transfer activity for each wallet
3. Find any existing mappings between these two addresses
4. Check if transaction_hash values overlap between these wallets
5. Verify Xi market condition_id appears for executor wallet

Document evidence that executor has all the trades while account has none/minimal.
```

**Expected Findings:**
- Executor: 31M+ trades
- Account: 0-100 trades (or none in trades table)
- Executor: Hundreds of thousands of ERC20 transfers
- Account: Minimal ERC20 activity

### Explore Agent 3: Pattern Detector

**Task:** Find other wallets with executor→account relationships

**Prompt:**
```
Search for patterns suggesting other proxy/executor wallet relationships:

1. Find wallet pairs that share many transaction_hash values but different addresses
2. Look for wallet addresses with similar naming patterns to XCN's executor/account
3. Check for wallets with high trade volume (top 100) that might be executors
4. Look for any existing documentation or comments mentioning proxy/executor/account

Focus on high-volume traders (>10k trades) and look for anomalies.
```

**Expected Findings:**
- Other executor→account pairs (prioritize top volume wallets)
- Naming conventions that indicate proxy relationships
- Potential candidates for `wallet_identity_map` seeding

**⚠️ WAIT FOR EXPLORE AGENT RESULTS BEFORE PROCEEDING TO PHASE 2**

---

## Phase 2: Implementation (Staging Only)

### Step 1: Create Wallet Identity Map Table

**Purpose:** Canonical source for executor→account mappings

```sql
-- Create mapping table (staging environment)
CREATE TABLE IF NOT EXISTS wallet_identity_map (
  executor_wallet String,
  canonical_wallet String,
  mapping_type String,      -- 'proxy_to_eoa', 'contract_to_owner', 'manual', etc.
  source String,             -- 'erc20_analysis', 'polymarket_api', 'manual_validation', etc.
  created_at DateTime DEFAULT now(),
  updated_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (executor_wallet, canonical_wallet);
```

**Key Design Decisions:**
- Use `ReplacingMergeTree` to allow idempotent updates
- `executor_wallet` is the on-chain proxy (what we have in ClickHouse)
- `canonical_wallet` is the account wallet (what Polymarket API uses)
- `mapping_type` and `source` provide audit trail

### Step 2: Seed XCN Mapping

**Immediate action:** Insert the proven XCN relationship

```sql
-- Seed known XCN mapping
INSERT INTO wallet_identity_map (
  executor_wallet,
  canonical_wallet,
  mapping_type,
  source,
  created_at,
  updated_at
) VALUES (
  '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e',  -- Executor (has trades)
  '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',  -- Account (Polymarket API)
  'proxy_to_eoa',
  'manual_validation',
  now(),
  now()
);
```

**Post-Explore Agent 3:** Add any other discovered mappings here

### Step 3: Create Canonical Trades View

**Purpose:** Expose `wallet_canonical` for all trades while preserving `wallet_raw`

```sql
-- Global canonical trades view (staging)
CREATE OR REPLACE VIEW vw_trades_canonical_with_canonical_wallet AS
SELECT
  -- Canonical wallet (mapped if exists, else use raw)
  coalesce(m.canonical_wallet, lower(t.wallet_address)) AS wallet_canonical,

  -- Raw wallet (audit trail)
  lower(t.wallet_address) AS wallet_raw,

  -- Normalized condition ID (bare hex, lowercase, 64 chars)
  lower(replaceRegexpAll(t.condition_id_norm_v3, '^0x', '')) AS cid_norm,

  -- All original columns from base table
  t.*

FROM pm_trades_canonical_v3 t
LEFT JOIN wallet_identity_map m
  ON lower(t.wallet_address) = m.executor_wallet;
```

**Critical Details:**
- `coalesce()` ensures unmapped wallets still appear (as `wallet_canonical = wallet_raw`)
- `wallet_raw` preserves original attribution for audit
- `cid_norm` fixes format issues (no 0x, lowercase, 64 chars)
- `LEFT JOIN` ensures no data loss if mapping is incomplete

### Step 4: Create XCN-Specific View

**Purpose:** Clean view for XCN PnL calculations

```sql
-- XCN-only view using canonical wallet (staging)
CREATE OR REPLACE VIEW vw_xcn_pnl_source AS
SELECT *
FROM vw_trades_canonical_with_canonical_wallet
WHERE wallet_canonical = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
```

**This replaces:** `vw_xcn_repaired_only` (which had collision fixes but wrong wallet)

---

## Phase 3: Validation Protocol

### Validation 1: Xi Market PnL vs Polymarket API

**Ground Truth (from Polymarket API for account wallet 0xcce2...d58b):**
- Xi market condition ID: `f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1`
- Winning outcome: Eggs (outcome_index = 0)
- Expected cost: ~$12,400
- Expected net shares: ~53,683
- Expected realized P&L: ~$41,289

**Query to Run:**

```sql
-- Xi market PnL using canonical wallet
WITH 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1' AS xi_cid
SELECT
  sumIf(usd_value, trade_direction = 'BUY') AS buy_cost,
  sumIf(usd_value, trade_direction = 'SELL') AS sell_proceeds,
  sumIf(shares, trade_direction = 'BUY') - sumIf(shares, trade_direction = 'SELL') AS net_shares,
  sumIf(shares, outcome_index_v3 = 0 AND trade_direction = 'BUY')
    - sumIf(shares, outcome_index_v3 = 0 AND trade_direction = 'SELL') AS winning_shares,
  (winning_shares * 1.0) + (sell_proceeds - buy_cost) AS realized_pnl,
  count(*) AS trade_count
FROM vw_trades_canonical_with_canonical_wallet
WHERE wallet_canonical = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
  AND cid_norm = xi_cid;
```

**Success Criteria:**
- `trade_count` = 1,833 ✅ (exact)
- `buy_cost` within ±10% of $12,400
- `net_shares` within ±10% of 53,683
- `realized_pnl` within ±10% of $41,289
- **All metrics must be positive** (not negative like before)

**If validation fails:** STOP. Investigate discrepancy before proceeding.

### Validation 2: Collision Check

**Query:**

```sql
-- Ensure no canonical wallet collisions
SELECT
  transaction_hash,
  count(DISTINCT wallet_canonical) AS canonical_wallet_count,
  groupArray(wallet_canonical) AS wallets
FROM vw_trades_canonical_with_canonical_wallet
GROUP BY transaction_hash
HAVING canonical_wallet_count > 1
LIMIT 100;
```

**Expected Result:** 0 rows (no collisions at canonical level)

**Note:** Collisions at `wallet_raw` level are EXPECTED (legitimate multi-wallet transactions)

### Validation 3: Coverage Check

**Query:**

```sql
-- Verify all Xi trades have correct canonical wallet
SELECT
  wallet_canonical,
  count(*) AS trade_count
FROM vw_trades_canonical_with_canonical_wallet
WHERE cid_norm = 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1'
GROUP BY wallet_canonical
ORDER BY trade_count DESC;
```

**Expected Result:**
- `0xcce2b7c71f21e358b8e5e797e586cbc03160d58b` → 1,833 trades
- No other wallets (or minimal noise <10 trades)

---

## Phase 4: Automated Validation Script

### Create `scripts/validate-canonical-wallet-xi-market.ts`

**Purpose:** Repeatable validation comparing ClickHouse to Polymarket API

**Script Specification:**

```typescript
#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '@/lib/clickhouse/client';

const ACCOUNT_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const XI_MARKET_CID = 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1';
const WINNING_OUTCOME = 0; // Eggs

async function main() {
  // Query canonical view for Xi market
  const query = `
    WITH '${XI_MARKET_CID}' AS cid, ${WINNING_OUTCOME} AS win
    SELECT
      sumIf(usd_value, trade_direction='BUY') AS buy_cost,
      sumIf(usd_value, trade_direction='SELL') AS sell_proceeds,
      sumIf(shares, trade_direction='BUY') - sumIf(shares, trade_direction='SELL') AS net_shares,
      sumIf(shares, outcome_index_v3=win AND trade_direction='BUY')
        - sumIf(shares, outcome_index_v3=win AND trade_direction='SELL') AS winning_shares,
      (winning_shares * 1.0) + (sell_proceeds - buy_cost) AS realized_pnl,
      count(*) AS trade_count
    FROM vw_trades_canonical_with_canonical_wallet
    WHERE wallet_canonical='${ACCOUNT_WALLET}' AND cid_norm=cid
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = await result.json() as any[];
  const actual = data[0];

  // Expected values from Polymarket API
  const expected = {
    trade_count: 1833,
    buy_cost: 12400,
    net_shares: 53683,
    realized_pnl: 41289
  };

  // Validation with ±10% tolerance
  const tolerance = 0.10;

  console.log('VALIDATION REPORT - Xi Market');
  console.log('═'.repeat(80));
  console.log(`Trade Count:    ${actual.trade_count} vs ${expected.trade_count} ${actual.trade_count === expected.trade_count ? '✅' : '❌'}`);

  const costDelta = Math.abs(parseFloat(actual.buy_cost) - expected.buy_cost) / expected.buy_cost;
  console.log(`Buy Cost:       $${parseFloat(actual.buy_cost).toFixed(2)} vs ~$${expected.buy_cost} ${costDelta <= tolerance ? '✅' : '❌'} (${(costDelta * 100).toFixed(1)}% off)`);

  const sharesDelta = Math.abs(parseFloat(actual.net_shares) - expected.net_shares) / expected.net_shares;
  console.log(`Net Shares:     ${parseFloat(actual.net_shares).toFixed(2)} vs ~${expected.net_shares} ${sharesDelta <= tolerance ? '✅' : '❌'} (${(sharesDelta * 100).toFixed(1)}% off)`);

  const pnlDelta = Math.abs(parseFloat(actual.realized_pnl) - expected.realized_pnl) / expected.realized_pnl;
  console.log(`Realized P&L:   $${parseFloat(actual.realized_pnl).toFixed(2)} vs ~$${expected.realized_pnl} ${pnlDelta <= tolerance ? '✅' : '❌'} (${(pnlDelta * 100).toFixed(1)}% off)`);

  const allPass = actual.trade_count === expected.trade_count &&
                  costDelta <= tolerance &&
                  sharesDelta <= tolerance &&
                  pnlDelta <= tolerance;

  console.log('═'.repeat(80));
  console.log(allPass ? '✅ VALIDATION PASSED' : '❌ VALIDATION FAILED');
}

main().catch(console.error);
```

**Usage:**
```bash
npx tsx scripts/validate-canonical-wallet-xi-market.ts
```

**Expected Output:**
```
VALIDATION REPORT - Xi Market
═══════════════════════════════════════
Trade Count:    1833 vs 1833 ✅
Buy Cost:       $12,450.23 vs ~$12,400 ✅ (0.4% off)
Net Shares:     53,892.45 vs ~53,683 ✅ (0.4% off)
Realized P&L:   $41,567.89 vs ~$41,289 ✅ (0.7% off)
═══════════════════════════════════════
✅ VALIDATION PASSED
```

---

## Phase 5: Quality Checks

### Check 1: Mapping Coverage

```sql
-- See how many trades use canonical mapping vs raw
SELECT
  countIf(wallet_canonical != wallet_raw) AS mapped_trades,
  countIf(wallet_canonical = wallet_raw) AS unmapped_trades,
  mapped_trades / (mapped_trades + unmapped_trades) AS mapping_rate
FROM vw_trades_canonical_with_canonical_wallet;
```

**Initial Expected Result:** Very low mapping rate (only XCN mapped so far)

### Check 2: XCN Trade Integrity

```sql
-- Verify all XCN executor trades now appear under canonical wallet
SELECT
  count(*) AS total_trades,
  countDistinct(cid_norm) AS unique_markets,
  sum(usd_value) AS total_volume
FROM vw_xcn_pnl_source;
```

**Expected:** ~31M trades (matching previous `vw_xcn_repaired_only` count)

### Check 3: Condition ID Format

```sql
-- Verify all cid_norm fields are properly formatted
SELECT
  countIf(length(cid_norm) != 64) AS wrong_length,
  countIf(cid_norm LIKE '0x%') AS has_prefix,
  countIf(cid_norm != lower(cid_norm)) AS has_uppercase
FROM vw_trades_canonical_with_canonical_wallet
LIMIT 1;
```

**Expected:** All counts = 0 (all IDs properly normalized)

---

## Phase 6: Guardrails & Future Ingest

### Ingest-Time Validation

**Prevent future attribution drift by validating new trades at ingestion:**

```sql
-- Add to ETL pipeline (pseudo-code)
-- Check if new trade creates canonical collision
WITH new_trade AS (
  SELECT
    transaction_hash,
    wallet_address,
    -- ... other fields
  FROM staging.new_trades_batch
)
SELECT
  nt.transaction_hash,
  nt.wallet_address AS new_wallet,
  coalesce(m.canonical_wallet, lower(nt.wallet_address)) AS new_canonical,
  existing_canonical
FROM new_trade nt
LEFT JOIN wallet_identity_map m ON lower(nt.wallet_address) = m.executor_wallet
JOIN (
  SELECT
    transaction_hash,
    wallet_canonical AS existing_canonical
  FROM vw_trades_canonical_with_canonical_wallet
) existing ON nt.transaction_hash = existing.transaction_hash
WHERE new_canonical != existing_canonical;

-- If this query returns rows → ALERT (collision detected)
```

### Mapping Refresh Strategy

**When to update `wallet_identity_map`:**

1. **New high-volume wallet detected** (>10k trades)
2. **User reports PnL mismatch** with Polymarket API
3. **Periodic audit** (weekly/monthly) of top 100 wallets

**Update process:**
```sql
-- Add new mapping (ReplacingMergeTree handles duplicates)
INSERT INTO wallet_identity_map VALUES (
  'executor_wallet_here',
  'canonical_wallet_here',
  'mapping_type',
  'source',
  now(),
  now()
);
```

---

## Phase 7: Rollout Documentation

### Create `docs/WALLET_CANONICALIZATION_ROLLOUT.md`

**Target Audience:** C2 (Data Pipeline), C3 (Validation), Dashboard Developers

**Content Outline:**

```markdown
# Wallet Canonicalization Rollout Guide

## What Changed

**Root Cause:** Executor wallet ≠ Account wallet
**Solution:** New `wallet_identity_map` table + canonical views

## Migration Path

### For C2 (Data Pipeline Agent)

**Old Pattern:**
```sql
SELECT * FROM pm_trades_canonical_v3
WHERE wallet_address = 'some_wallet'
```

**New Pattern:**
```sql
SELECT * FROM vw_trades_canonical_with_canonical_wallet
WHERE wallet_canonical = 'some_wallet'  -- Use canonical!
```

**Critical:** Always use `wallet_canonical` for business logic, preserve `wallet_raw` for audit.

### For C3 (Validation Agent)

**Old View:** `vw_xcn_repaired_only`
**New View:** `vw_xcn_pnl_source`

**Why:** Collision repair is now integrated into canonical view.

### For Dashboards

**Update all wallet filters to:**
- Accept `canonical_wallet` as input (what user sees in Polymarket UI)
- Query using `wallet_canonical` field
- Display `wallet_canonical` in UI (not `wallet_raw`)

## Known Limitations

### Eggs-May Markets
- Some markets missing/partial data
- Deferred for separate backfill investigation
- Does not block Xi market validation

### Incomplete Mapping
- Only XCN fully mapped initially
- Other high-volume wallets to be added post-validation
- Unmapped wallets show as `wallet_canonical = wallet_raw` (safe fallback)

## Stop Conditions

**DO NOT promote to production until:**

✅ Xi market validation passes (±10% tolerance)
✅ Zero canonical wallet collisions detected
✅ C2/C3 acknowledge migration path
✅ Dashboard team acknowledges changes
✅ Backup of `pm_trades_canonical_v3` exists

## Support

**Questions:** Tag C1 (Database Agent)
**Issues:** File in docs/issues/ with validation output
```

---

## Files You Will Create

| File | Purpose | Status |
|------|---------|--------|
| `wallet_identity_map` (table) | Executor→canonical mapping | Create in Phase 2 |
| `vw_trades_canonical_with_canonical_wallet` (view) | Global canonical trades | Create in Phase 2 |
| `vw_xcn_pnl_source` (view) | XCN-specific canonical view | Create in Phase 2 |
| `scripts/validate-canonical-wallet-xi-market.ts` | Validation script | Create in Phase 4 |
| `docs/WALLET_CANONICALIZATION_ROLLOUT.md` | Migration guide | Create in Phase 7 |

---

## Stop Conditions & Escalation

### STOP if:

1. **Explore agents find conflicting wallet mappings** → Escalate to main agent
2. **Xi market validation fails** (>10% off) → Re-investigate root cause
3. **Canonical collisions detected** (>0) → Fix mapping logic before proceeding
4. **Trade count mismatch** (not 1,833 for Xi) → Check CID normalization

### SUCCESS if:

✅ All 3 validation queries pass
✅ Validation script outputs "VALIDATION PASSED"
✅ Rollout documentation complete
✅ C2/C3 handoff ready

---

## Timeline Estimate

| Phase | Estimated Time |
|-------|----------------|
| Phase 1: Explore Agents | 15-30 min |
| Phase 2: Implementation | 20-30 min |
| Phase 3: Validation | 10-15 min |
| Phase 4: Script Creation | 15-20 min |
| Phase 5: Quality Checks | 10 min |
| Phase 6: Guardrails | 10 min |
| Phase 7: Rollout Doc | 20 min |
| **Total** | **~2 hours** |

---

## Sign-Off

**Prepared by:** Main Agent
**Date:** 2025-11-16 (PST)
**Target:** C1 (Database Agent)
**Status:** ✅ Ready for execution

**Critical Reminder:** This is STAGING ONLY. Do not touch production until validation passes and rollout documentation is complete.

**Use explore agents to fill knowledge gaps. Validate against Polymarket API. Build for the future.**
