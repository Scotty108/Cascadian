# C1 Phase 2 - Critical Finding Report

**Date:** 2025-11-16 (PST)
**Agent:** C1 (Database Agent)
**Status:** ⚠️ IMPLEMENTATION PAUSED - Schema mismatch discovered

---

## Executive Summary

During Phase 2 implementation, discovered that the existing `wallet_identity_map` table (735K rows) uses a **completely different schema** than specified in the directive and **does NOT contain the required XCN executor→account mapping**.

**Critical Issue:** The executor wallet (`0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e`) and account wallet (`0xcce2b7c71f21e358b8e5e797e586cbc03160d58b`) exist in the table as **separate, unmapped entries**.

---

## Schema Comparison

### Expected Schema (from Directive)

```sql
CREATE TABLE wallet_identity_map (
  executor_wallet String,      -- On-chain proxy
  canonical_wallet String,      -- Account wallet
  mapping_type String,
  source String,
  created_at DateTime,
  updated_at DateTime
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (executor_wallet, canonical_wallet);
```

### Actual Schema (Found in ClickHouse)

```sql
CREATE TABLE wallet_identity_map (
  user_eoa String,              -- Account owner
  proxy_wallet String,          -- Executor/proxy wallet
  canonical_wallet String,      -- Canonical identity
  fills_count UInt64,
  markets_traded UInt64,
  first_fill_ts DateTime64(3),
  last_fill_ts DateTime64(3)
) ENGINE = [Unknown - needs inspection]
ORDER BY [Unknown - needs inspection];
```

**Key Differences:**
- Field names completely different (`user_eoa`/`proxy_wallet` vs `executor_wallet`/`canonical_wallet`)
- Additional metric fields (`fills_count`, `markets_traded`, timestamps)
- Different purpose: Wallet dimension table vs mapping table

---

## Data Investigation Results

### Query 1: XCN Wallet Presence

**Found 3 rows matching XCN wallets:**

#### Row 1: Account Wallet (Direct Trading)
```json
{
  "proxy_wallet": "0xcce2b7c71f21e358b8e5e797e586cbc03160d58b",
  "user_eoa": "0xcce2b7c71f21e358b8e5e797e586cbc03160d58b",
  "canonical_wallet": "0xcce2b7c71f21e358b8e5e797e586cbc03160d58b",
  "fills_count": "194",
  "markets_traded": "45",
  "first_fill_ts": "2024-08-22 12:20:46.000",
  "last_fill_ts": "2025-09-10 01:20:32.000"
}
```
**Analysis:** Account wallet trading directly (no proxy), 194 fills

#### Row 2: Executor Wallet (Proxy Trading)
```json
{
  "proxy_wallet": "0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e",
  "user_eoa": "0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e",
  "canonical_wallet": "0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e",
  "fills_count": "8031085",
  "markets_traded": "72683",
  "first_fill_ts": "2022-12-12 18:43:40.000",
  "last_fill_ts": "2025-11-05 06:29:13.000"
}
```
**Analysis:** Executor wallet trading as itself (no owner linkage), 8.0M fills

#### Row 3: Different Proxy Relationship
```json
{
  "proxy_wallet": "0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723",
  "user_eoa": "0xcce2b7c71f21e358b8e5e797e586cbc03160d58b",
  "canonical_wallet": "0xcce2b7c71f21e358b8e5e797e586cbc03160d58b",
  "fills_count": "0",
  "markets_traded": "0",
  "first_fill_ts": "2025-11-16 00:30:15.699",
  "last_fill_ts": "2025-11-16 00:30:15.699"
}
```
**Analysis:** Recent mapping (today!) of different proxy to XCN account, but 0 fills

### Query 2: Actual Proxy Relationships

**Found only 1 proxy relationship** where `proxy_wallet ≠ user_eoa`:
- Proxy: `0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723`
- User: `0xcce2b7c71f21e358b8e5e797e586cbc03160d58b`
- Fills: 0 (newly added, no activity yet)

**Critical Finding:** The main XCN executor→account relationship (`0x4bfb...982e` → `0xcce2...d58b`) **is NOT represented** in this table.

---

## Root Cause Analysis

### Table Purpose Mismatch

**Expected Purpose:** Executor→Account mapping table for PnL canonicalization
- Each row = one executor→account relationship
- Enables LEFT JOIN from trades to resolve canonical wallet

**Actual Purpose:** Wallet dimension/summary table
- Each row = one wallet's summary statistics
- When `proxy_wallet == user_eoa`, wallet trades directly (no proxy)
- When `proxy_wallet ≠ user_eoa`, wallet uses proxy **BUT the executor is not in the table**

### Semantic Gap

The table shows:
- ✅ **Direct traders** (account == proxy == canonical)
- ✅ **Account wallets using proxies** (account ≠ proxy)
- ❌ **Executor wallets themselves** (exist as separate rows, unlinked)

---

## Impact on Implementation

### Blocked Actions

❌ **Cannot create canonical view** using this table as-is
- No join key exists to map executor (`0x4bfb...982e`) → account (`0xcce2...d58b`)
- LEFT JOIN would return NULL for all executor wallet trades

❌ **Cannot validate Xi market**
- Xi market trades executed by `0x4bfb...982e`
- Would need to query account `0xcce2...d58b`
- No mapping exists between them

### Unblocked Actions

✅ **Schema documentation** complete
✅ **XCN relationship validation** complete (from Explore Agent 2)
✅ **Pattern detection** complete (from Explore Agent 3)

---

## Strategic Options

### Option A: Insert XCN Mapping into Existing Table

**Approach:** Add row with correct proxy→user relationship

```sql
INSERT INTO wallet_identity_map VALUES (
  '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',  -- user_eoa (account)
  '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e',  -- proxy_wallet (executor)
  '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',  -- canonical_wallet
  8031085,                                         -- fills_count
  72683,                                           -- markets_traded
  '2022-12-12 18:43:40.000',                       -- first_fill_ts
  '2025-11-05 06:29:13.000'                        -- last_fill_ts
);
```

**Pros:**
- Uses existing infrastructure
- Minimal schema changes

**Cons:**
- Creates duplicate data (executor exists twice: once as itself, once as proxy)
- May conflict with existing row for executor wallet
- Doesn't match directive's expected schema

### Option B: Create New Mapping Table

**Approach:** Create separate table matching directive schema

```sql
CREATE TABLE wallet_identity_map_v2 (
  executor_wallet String,
  canonical_wallet String,
  mapping_type String,
  source String,
  created_at DateTime,
  updated_at DateTime
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (executor_wallet, canonical_wallet);
```

**Pros:**
- Clean separation of concerns
- Matches directive exactly
- No duplicate data

**Cons:**
- Creates parallel infrastructure
- Existing `wallet_identity_map` becomes confusing
- Migration complexity

### Option C: Adapt Directive to Use Existing Schema

**Approach:** Rewrite canonical view to use `proxy_wallet`/`user_eoa` fields

```sql
CREATE OR REPLACE VIEW vw_trades_canonical_with_canonical_wallet AS
SELECT
  coalesce(m.user_eoa, lower(t.wallet_address)) AS wallet_canonical,
  lower(t.wallet_address) AS wallet_raw,
  lower(replaceRegexpAll(t.condition_id_norm_v3, '^0x', '')) AS cid_norm,
  t.*
FROM pm_trades_canonical_v3 t
LEFT JOIN wallet_identity_map m
  ON lower(t.wallet_address) = m.proxy_wallet
  WHERE m.proxy_wallet != m.user_eoa;  -- Only map actual proxy relationships
```

**Pros:**
- Uses existing production table
- No schema changes needed

**Cons:**
- Requires inserting XCN mapping first (see Option A cons)
- Directive would need rewrite
- Validation scripts need adaptation

---

## Recommended Path Forward

### Immediate Actions (C1)

1. **PAUSE implementation** until strategy confirmed
2. **Document findings** (this report)
3. **Await main agent decision** on Option A/B/C

### If Option A Selected

1. Check table engine and deduplication behavior
2. Insert XCN executor→account mapping
3. Verify no collisions with existing executor row
4. Adapt view creation SQL to use `proxy_wallet`/`user_eoa`
5. Update validation script field names
6. Proceed with validation

### If Option B Selected

1. Create `wallet_identity_map_v2` table
2. Seed with XCN mapping
3. Create canonical view using new table
4. Proceed with validation (no changes to scripts)

### If Option C Selected

1. Same as Option A
2. Additionally: Rewrite entire directive for consistency
3. Update all downstream documentation

---

## Questions for Main Agent

1. **Schema Strategy:** Which option (A/B/C) should we pursue?
2. **Existing Table:** Is `wallet_identity_map` production or can we modify it?
3. **Duplicate Data:** Is it acceptable to have executor wallet appear twice (as itself + as proxy)?
4. **Naming Convention:** Should we align with `user_eoa`/`proxy_wallet` or keep `executor_wallet`/`canonical_wallet`?
5. **Migration Path:** If Option B, how to migrate downstream consumers from old→new table?

---

## Files Created

| File | Purpose |
|------|---------|
| `docs/C1_WALLET_CANONICALIZATION_DIRECTIVE.md` | Original directive (expected schema) |
| `scripts/validate-canonical-wallet-xi-market.ts` | Validation script (uses expected field names) |
| `docs/WALLET_CANONICALIZATION_ROLLOUT.md` | Rollout guide (uses expected schema) |
| `docs/C1_PHASE2_CRITICAL_FINDING.md` | **This report** |

---

## Next Steps

**C1 (Database Agent) - AWAITING DECISION:**
- Paused at Phase 2 (Implementation)
- Ready to proceed once strategy confirmed
- Can execute any of the three options within 30 minutes

**Main Agent - ACTION REQUIRED:**
- Review this report
- Select Option A, B, or C
- Provide guidance on schema strategy
- Confirm production safety constraints

---

## Sign-Off

**Prepared by:** C1 (Database Agent)
**Date:** 2025-11-16 (PST)
**Status:** ⏸️ PAUSED - Awaiting strategic direction

**Summary:**
- Exploration phase: ✅ Complete
- Implementation phase: ⏸️ Paused (schema mismatch)
- Validation phase: ⏳ Blocked (no mapping exists)

**Critical blocker:** Existing `wallet_identity_map` table does not contain required XCN executor→account mapping and uses different schema than expected.

**Recommendation:** Await main agent decision on Option A/B/C before proceeding with Phase 2 implementation.
