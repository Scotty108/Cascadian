# Proxy Wallet Mapping Specification

**Date:** 2025-11-16
**Status:** 🟡 Infrastructure Exists But NOT Used in P&L
**Terminal:** Claude 1

---

## Executive Summary

**Current State:**
- ✅ Proxy mapping infrastructure EXISTS (`wallet_identity_map`, `pm_user_proxy_wallets_v2`)
- ❌ P&L views DO NOT use canonical wallet mapping
- ❌ xcnstrategy proxy relationship is MISSING from our mapping tables
- ⚠️  This causes $84,941 (97.6%) of xcnstrategy P&L to be INVISIBLE to our system

**Root Cause:**
- Our `wallet_identity_map` incorrectly maps xcnstrategy as EOA = Proxy = Canonical (all same wallet)
- Dome API correctly knows: EOA = `0xcce...58b`, Proxy = `0xd59...723` (different!)
- The proxy wallet (`0xd59...723`) has ZERO trades in our `pm_trades` because it's not in `clob_fills`

---

## Table Inventory

### 1. wallet_identity_map (PRIMARY MAPPING TABLE)

**Status:** ✅ Exists
**Rows:** 735,637
**Purpose:** Maps proxy_wallet → canonical_wallet for wallet aggregation

**Schema:**
```sql
CREATE TABLE wallet_identity_map (
  user_eoa           String,        -- Owner EOA address
  proxy_wallet       String,        -- Trading wallet address
  canonical_wallet   String,        -- Canonical identity for aggregation
  fills_count        UInt64,        -- Total fills for this wallet
  markets_traded     UInt64,        -- Unique markets traded
  first_fill_ts      DateTime64(3), -- First trade timestamp
  last_fill_ts       DateTime64(3)  -- Last trade timestamp
)
ENGINE = ...
ORDER BY canonical_wallet
```

**Data Pattern:**
- **Most wallets:** `user_eoa = proxy_wallet = canonical_wallet` (wallets trading directly)
- **Safe multisigs:** `user_eoa ≠ proxy_wallet`, `canonical_wallet = user_eoa` (aggregated to EOA)
- **Expected for xcnstrategy:** `user_eoa = 0xcce...58b`, `proxy_wallet = 0xd59...723`, `canonical_wallet = 0xcce...58b`
- **Actual for xcnstrategy:** `user_eoa = proxy_wallet = canonical_wallet = 0xcce...58b` ❌ WRONG

**Current xcnstrategy Entry:**
```json
{
  "user_eoa": "0xcce2b7c71f21e358b8e5e797e586cbc03160d58b",
  "proxy_wallet": "0xcce2b7c71f21e358b8e5e797e586cbc03160d58b",
  "canonical_wallet": "0xcce2b7c71f21e358b8e5e797e586cbc03160d58b",
  "fills_count": "194",
  "markets_traded": "45",
  "first_fill_ts": "2024-08-22 12:20:46.000",
  "last_fill_ts": "2025-09-10 01:20:32.000"
}
```

**Problem:** This entry claims xcnstrategy trades directly (no proxy), contradicting Dome API which shows proxy `0xd59...723`.

---

### 2. pm_user_proxy_wallets_v2 (SECONDARY MAPPING TABLE)

**Status:** ✅ Exists
**Rows:** 6 (minimal coverage)
**Purpose:** API-sourced proxy mappings

**Schema:**
```sql
CREATE TABLE pm_user_proxy_wallets_v2 (
  user_eoa       String,
  proxy_wallet   String,
  source         LowCardinality(String), -- 'api' or 'inferred'
  first_seen_at  DateTime,
  last_seen_at   DateTime,
  is_active      UInt8,
  metadata       String
)
ENGINE = ReplacingMergeTree(last_seen_at)
ORDER BY user_eoa
```

**Current xcnstrategy Entry:**
```json
{
  "user_eoa": "0xcce2b7c71f21e358b8e5e797e586cbc03160d58b",
  "proxy_wallet": "0xcce2b7c71f21e358b8e5e797e586cbc03160d58b",
  "source": "api",
  "first_seen_at": "2025-11-11 09:38:23",
  "last_seen_at": "2025-11-11 09:38:23",
  "is_active": 1,
  "metadata": ""
}
```

**Problem:** Same issue - API returned EOA = proxy_wallet, missing the real proxy relationship.

---

### 3. clob_fills (SOURCE DATA)

**Status:** ✅ Exists
**Rows:** 38,945,566
**Purpose:** Raw CLOB trade data from Polymarket API

**Relevant Columns:**
```sql
CREATE TABLE clob_fills (
  fill_id         String,
  proxy_wallet    String,  -- Trading wallet (appears in CLOB)
  user_eoa        String,  -- Owner EOA (may differ from proxy_wallet)
  condition_id    String,
  asset_id        String,
  side            LowCardinality(String),
  price           Float64,
  size            Float64,
  timestamp       DateTime,
  ...
)
```

**Key Facts:**
- `proxy_wallet`: The wallet that executed the trade (appears in CLOB API)
- `user_eoa`: The owner of the trading wallet (may be same or different)
- For direct traders: `proxy_wallet = user_eoa`
- For Safe multisigs: `proxy_wallet ≠ user_eoa`

**xcnstrategy in clob_fills:**
- Trades with `proxy_wallet = 0xcce...58b` (EOA): **194 trades** ✅ Present
- Trades with `proxy_wallet = 0xd59...723` (Proxy): **0 trades** ❌ Missing

**Conclusion:** The proxy wallet (`0xd59...723`) either:
1. Never traded via CLOB (used AMM instead), OR
2. Trades exist but are outside our backfill date range, OR
3. Attribution is incorrect (trades attributed to different wallet)

---

## Current P&L Pipeline (WITHOUT Canonical Mapping)

### pm_trades View

**Definition:**
```sql
CREATE VIEW pm_trades AS
SELECT
  cf.fill_id,
  cf.timestamp AS block_time,
  lower(cf.proxy_wallet) AS wallet_address,  -- ← Uses proxy_wallet directly
  lower(cf.user_eoa) AS operator_address,
  multiIf(lower(cf.proxy_wallet) != lower(cf.user_eoa), 1, 0) AS is_proxy_trade,
  ...
FROM default.clob_fills AS cf
INNER JOIN default.pm_asset_token_map AS atm
  ON cf.asset_id = atm.asset_id_decimal
```

**Key Behavior:**
- `wallet_address = lower(cf.proxy_wallet)` ← Trading wallet used for P&L
- Does NOT join to `wallet_identity_map`
- Does NOT use `canonical_wallet`

**Impact on xcnstrategy:**
- All 194 trades have `wallet_address = 0xcce...58b` (EOA)
- Proxy wallet (`0xd59...723`) has 0 trades in `clob_fills` → 0 in `pm_trades`
- P&L is calculated ONLY for EOA, missing ALL proxy trades

---

### pm_wallet_market_pnl_resolved View

**Definition:**
```sql
CREATE VIEW pm_wallet_market_pnl_resolved AS
WITH position_summary AS (
  SELECT
    wallet_address,  -- ← Inherited from pm_trades (no canonical mapping)
    condition_id,
    SUM(...) as pnl_gross,
    SUM(...) as pnl_net,
    ...
  FROM pm_trades
  WHERE ...
  GROUP BY wallet_address, condition_id
)
SELECT * FROM position_summary
INNER JOIN pm_markets ...
```

**Key Behavior:**
- Groups by `wallet_address` directly (no canonical mapping)
- Calculates P&L per (wallet_address, condition_id)
- Still does NOT use `wallet_identity_map`

**Impact on xcnstrategy:**
- xcnstrategy P&L = P&L for wallet `0xcce...58b` only
- Proxy wallet P&L = Missing (wallet `0xd59...723` not in pm_trades)

---

### pm_wallet_pnl_summary View

**Definition:**
```sql
CREATE VIEW pm_wallet_pnl_summary AS
WITH wallet_aggregates AS (
  SELECT
    wallet_address,  -- ← Still no canonical mapping
    COUNT(DISTINCT condition_id) AS total_markets,
    SUM(pnl_net) AS pnl_net,
    ...
  FROM pm_wallet_market_pnl_resolved
  GROUP BY wallet_address
)
SELECT * FROM wallet_aggregates
```

**Key Behavior:**
- Final aggregation by `wallet_address` (proxy wallet identity)
- Does NOT aggregate by `canonical_wallet`
- Leaderboards show individual trading wallets, NOT unified identities

**Impact on xcnstrategy:**
- Leaderboard entry: `0xcce...58b` with $2,089.18 P&L ✅ (EOA only)
- Missing entry: `0xd59...723` with $84,941 P&L ❌ (proxy not in data)
- No unified entry showing total $87,030 P&L

---

## Proxy Mapping Design

### Canonical Wallet Concept

**Definition:**
- **Canonical Wallet:** The authoritative identity for a trading entity, used for P&L aggregation and leaderboards
- **Proxy Wallet:** The on-chain wallet executing trades (may be different from canonical)
- **User EOA:** The owner/controller of the proxy wallet

**Mapping Rules:**
1. **Direct traders:** `canonical_wallet = proxy_wallet = user_eoa` (all same)
2. **Safe multisigs:** `canonical_wallet = user_eoa`, `proxy_wallet ≠ user_eoa` (proxy delegates to EOA)
3. **Smart money profiles:** Multiple proxies → single canonical (unified identity)

### How wallet_identity_map Should Work

**Current Build Logic** (inferred from `clob_fills`):
```sql
-- Likely how wallet_identity_map is built (not verified)
INSERT INTO wallet_identity_map
SELECT
  user_eoa,
  proxy_wallet,
  user_eoa AS canonical_wallet,  -- Default: canonical = EOA
  COUNT(*) as fills_count,
  COUNT(DISTINCT condition_id) as markets_traded,
  MIN(timestamp) as first_fill_ts,
  MAX(timestamp) as last_fill_ts
FROM clob_fills
GROUP BY user_eoa, proxy_wallet
```

**Problem with this approach:**
- If `user_eoa = proxy_wallet` in `clob_fills` (direct trader), then canonical = proxy
- If Polymarket API returns `user = proxy` for a wallet, we miss the real proxy relationship
- For xcnstrategy: API returned `user = 0xcce...58b`, `proxyWallet = 0xcce...58b` (likely wrong)

**Correct Build Logic** (using Dome API or Polymarket positions API):
```typescript
// lib/polymarket/resolver.ts - resolveProxyViaAPI
const url = `https://data-api.polymarket.com/positions?user=${eoa}`;
const positions = await fetch(url).then(r => r.json());
const proxyWallet = positions[0]?.proxyWallet;

// Insert mapping
{
  user_eoa: eoa,
  proxy_wallet: proxyWallet || eoa,  // Use API proxy or default to EOA
  canonical_wallet: eoa,  // Canonical is always the EOA
}
```

**xcnstrategy-specific fix:**
- Query Dome API endpoint (if available) to get real proxy mapping
- OR manually insert: `{user_eoa: '0xcce...58b', proxy_wallet: '0xd59...723', canonical_wallet: '0xcce...58b'}`

---

## Missing Piece: Proxy Trades Not in clob_fills

**The Real Problem:**
Even if we fix `wallet_identity_map`, the proxy wallet (`0xd59...723`) has **ZERO trades** in `clob_fills`.

**Possible Causes:**
1. **AMM Trades:** Proxy traded via AMM (not CLOB), so trades aren't in `clob_fills`
2. **Date Range:** Trades are outside our backfill date range (Sept-Oct 2025 per Dome)
3. **Different Attribution:** Trades attributed to a different wallet in CLOB API
4. **API Limitation:** CLOB API doesn't return trades for this specific proxy

**Investigation Needed:**
1. Check if `0xd59...723` appears in ANY ClickHouse table (ERC1155 transfers, etc.)
2. Query Polymarket CLOB API directly for proxy wallet trades
3. Query Dome API for xcnstrategy trade breakdown (EOA vs proxy)
4. Compare Dome's 14 condition_ids against our `clob_fills` coverage

---

## Answer to User Questions

### Q1: What is the canonical wallet key for P&L/leaderboards?

**Current Answer:** `wallet_address` (from `pm_trades.wallet_address`)
- Inherited from `clob_fills.proxy_wallet`
- NO canonical mapping applied
- Leaderboards show individual trading wallets, not unified identities

**Desired Answer:** `canonical_wallet_address` (to be added)
- Mapped via `wallet_identity_map.canonical_wallet`
- Aggregates all proxies under a single EOA
- Leaderboards show unified trader identities

---

### Q2: Which columns represent EOA, proxy, aliases?

**clob_fills:**
- `user_eoa`: Owner EOA address
- `proxy_wallet`: Trading wallet address (executor)

**wallet_identity_map:**
- `user_eoa`: Owner EOA address
- `proxy_wallet`: Trading wallet address
- `canonical_wallet`: Canonical identity (usually = `user_eoa`)

**pm_trades:**
- `wallet_address`: Trading wallet (copied from `clob_fills.proxy_wallet`)
- `operator_address`: Owner EOA (copied from `clob_fills.user_eoa`)
- `is_proxy_trade`: 1 if `wallet_address ≠ operator_address`, else 0

**Note:** No "aliases" column exists. `canonical_wallet` serves as the alias resolver.

---

### Q3: How to join from pm_trades.wallet_address to mapping?

**Current State:** No join exists (canonical mapping not used)

**Proposed Join:**
```sql
-- Option A: Left join to preserve all trades
SELECT
  t.*,
  COALESCE(wim.canonical_wallet, t.wallet_address) as canonical_wallet_address
FROM pm_trades t
LEFT JOIN wallet_identity_map wim
  ON lower(t.wallet_address) = lower(wim.proxy_wallet)

-- Option B: Direct mapping in pm_trades view
CREATE VIEW pm_trades AS
SELECT
  ...,
  lower(cf.proxy_wallet) AS wallet_address,
  COALESCE(wim.canonical_wallet, lower(cf.proxy_wallet)) AS canonical_wallet_address
FROM clob_fills cf
LEFT JOIN wallet_identity_map wim
  ON lower(cf.proxy_wallet) = lower(wim.proxy_wallet)
...
```

---

## Proposed Solution

### Step 1: Fix xcnstrategy Mapping

**Manual Fix** (immediate):
```sql
-- Update wallet_identity_map with correct proxy relationship
INSERT INTO wallet_identity_map VALUES (
  '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',  -- user_eoa (EOA)
  '0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723',  -- proxy_wallet (Safe proxy)
  '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',  -- canonical_wallet (EOA)
  0,  -- fills_count (proxy has no fills in our data)
  0,  -- markets_traded
  NOW(),  -- first_fill_ts
  NOW()   -- last_fill_ts
);
```

**Note:** This mapping won't help P&L immediately because proxy has 0 trades in `clob_fills`. It prepares for future data ingestion.

---

### Step 2: Wire canonical_wallet_address into pm_trades

**Update pm_trades view:**
```sql
CREATE OR REPLACE VIEW pm_trades AS
SELECT
  cf.fill_id,
  cf.timestamp AS block_time,
  lower(cf.proxy_wallet) AS wallet_address,
  COALESCE(wim.canonical_wallet, lower(cf.proxy_wallet)) AS canonical_wallet_address,
  lower(cf.user_eoa) AS operator_address,
  multiIf(lower(cf.proxy_wallet) != lower(cf.user_eoa), 1, 0) AS is_proxy_trade,
  ...
FROM default.clob_fills AS cf
LEFT JOIN default.wallet_identity_map AS wim
  ON lower(cf.proxy_wallet) = lower(wim.proxy_wallet)
INNER JOIN default.pm_asset_token_map AS atm
  ON cf.asset_id = atm.asset_id_decimal
```

**New Column:**
- `canonical_wallet_address`: Canonical identity for aggregation (defaults to `wallet_address` if no mapping)

---

### Step 3: Propagate canonical_wallet_address into P&L Views

**Update pm_wallet_market_pnl_resolved:**
```sql
CREATE OR REPLACE VIEW pm_wallet_market_pnl_resolved AS
WITH position_summary AS (
  SELECT
    canonical_wallet_address,  -- ← Changed from wallet_address
    condition_id,
    SUM(...) as pnl_gross,
    ...
  FROM pm_trades
  GROUP BY canonical_wallet_address, condition_id
)
SELECT * FROM position_summary ...
```

**Keep wallet_address for debugging:**
```sql
SELECT
  canonical_wallet_address,
  arrayDistinct(groupArray(wallet_address)) as proxy_wallets_used,  -- Show which proxies contributed
  condition_id,
  ...
FROM pm_trades
GROUP BY canonical_wallet_address, condition_id
```

**Update pm_wallet_pnl_summary:**
```sql
CREATE OR REPLACE VIEW pm_wallet_pnl_summary AS
WITH wallet_aggregates AS (
  SELECT
    canonical_wallet_address,  -- ← Changed from wallet_address
    COUNT(DISTINCT condition_id) AS total_markets,
    ...
  FROM pm_wallet_market_pnl_resolved
  GROUP BY canonical_wallet_address
)
SELECT * FROM wallet_aggregates
```

---

### Step 4: Re-run xcnstrategy Comparison

**Before (current state):**
```
xcnstrategy Canonical Wallet: 0xcce...58b
  Proxy Wallets: [0xcce...58b] (1 wallet)
  Total Markets: 4
  Total Trades: 194
  P&L Net: $2,089.18
  vs Dome: $87,030.51
  Gap: $84,941.33 (97.6%)
```

**After (with canonical mapping but same data):**
```
xcnstrategy Canonical Wallet: 0xcce...58b
  Proxy Wallets: [0xcce...58b, 0xd59...723] (2 wallets)
  Total Markets: 4 (only EOA has data)
  Total Trades: 194 (only EOA has data)
  P&L Net: $2,089.18
  vs Dome: $87,030.51
  Gap: $84,941.33 (97.6%)
```

**Expected Result:** Same P&L, because proxy wallet has 0 trades in `clob_fills`.

**Real Fix Requires:** Backfilling proxy wallet trades (see DOME_COVERAGE_INVESTIGATION_REPORT.md Category C)

---

## Files and Scripts

### Existing Infrastructure

**Tables:**
- `wallet_identity_map` - Primary canonical mapping (735K rows)
- `pm_user_proxy_wallets_v2` - Secondary API mappings (6 rows)
- `clob_fills` - Source data with proxy_wallet + user_eoa

**Scripts:**
- `scripts/build-proxy-table.ts` - Builds `pm_user_proxy_wallets` from API
- `scripts/translate-ui-wallet-to-onchain.ts` - Maps UI wallet → proxy → metrics
- `lib/polymarket/resolver.ts` - `resolveProxyViaAPI()` function

**Views:**
- `pm_trades` - Trade normalization (uses `wallet_address`)
- `pm_wallet_market_pnl_resolved` - Position-level P&L (uses `wallet_address`)
- `pm_wallet_pnl_summary` - Wallet-level P&L (uses `wallet_address`)

### New Scripts (To Be Created)

**scripts/104-wire-canonical-wallet-into-pm-trades.ts:**
- Rebuilds `pm_trades` view with `canonical_wallet_address` column
- Adds LEFT JOIN to `wallet_identity_map`
- Defaults to `wallet_address` if no mapping exists

**scripts/105-propagate-canonical-into-pnl-views.ts:**
- Rebuilds `pm_wallet_market_pnl_resolved` to group by `canonical_wallet_address`
- Rebuilds `pm_wallet_pnl_summary` to group by `canonical_wallet_address`
- Keeps `wallet_address` for debugging

**scripts/106-xcnstrategy-canonical-comparison.ts:**
- Queries xcnstrategy P&L by canonical wallet
- Shows breakdown by proxy wallet
- Compares to Dome API $87K target
- Documents remaining gap

**scripts/107-fix-xcnstrategy-proxy-mapping.ts:**
- Queries Dome API for xcnstrategy wallet structure
- Inserts/updates `wallet_identity_map` with correct proxy relationship
- Verifies mapping is correct

---

## Summary

**Infrastructure Status:**
- ✅ Proxy mapping tables exist (`wallet_identity_map`, `pm_user_proxy_wallets_v2`)
- ✅ Source data has proxy fields (`clob_fills.proxy_wallet`, `clob_fills.user_eoa`)
- ✅ Scripts exist to build mappings (`build-proxy-table.ts`, `resolver.ts`)
- ❌ P&L views DO NOT use canonical mapping
- ❌ xcnstrategy proxy relationship is WRONG in mapping tables

**xcnstrategy-Specific Issues:**
- ❌ Proxy wallet (`0xd59...723`) not in `wallet_identity_map`
- ❌ Proxy wallet has ZERO trades in `clob_fills` → ZERO in `pm_trades`
- ❌ $84,941 (97.6%) of P&L is missing because proxy trades are missing

**Next Steps:**
1. ✅ Document current design (this file)
2. ⏳ Wire `canonical_wallet_address` into `pm_trades`
3. ⏳ Propagate canonical wallets into P&L views
4. ⏳ Re-run xcnstrategy comparison (expect same gap due to missing data)
5. ⏳ Investigate Category C markets (14 markets with 100 trades missing)
6. ⏳ Backfill proxy wallet trades if possible

**Expected Outcome:**
- Canonical mapping will unify EOA + proxy under single identity
- But won't fix $84K gap until we backfill the missing 14 markets
- See `DOME_COVERAGE_INVESTIGATION_REPORT.md` for missing markets analysis

---

**Generated:** 2025-11-16
**Terminal:** Claude 1
**Status:** Infrastructure documented, ready for integration

_Always run backfills with maximum workers without hitting rate limits, with save/crash/stall protection enabled._

_— Claude 1_
