# Database Admin Permission Request

**Date:** November 16, 2025 (PST)
**Requestor:** C1 (Database Agent)
**Priority:** HIGH - Blocking wallet canonicalization pipeline

---

## Request Summary

Grant **INSERT/UPDATE permissions** to the current database user (`default`) on table `wallet_identity_overrides` in the `default` database.

---

## Current Issue

The table `wallet_identity_overrides` appears to have read-only access for the current user:

```sql
-- INSERT statements execute without error but data doesn't persist
INSERT INTO wallet_identity_overrides VALUES (...);
-- Returns: (empty - success)

SELECT * FROM wallet_identity_overrides;
-- Returns: Only 1 row (original data)
```

**Symptoms:**
- INSERT queries return success (no error message)
- Data does not persist after INSERT
- OPTIMIZE TABLE FINAL has no effect
- Multiple verification attempts confirm blocker

---

## Table Details

**Table:** `default.wallet_identity_overrides`
**Engine:** `SharedReplacingMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}', updated_at)`
**Order By:** `executor_wallet`

**Schema:**
```sql
CREATE TABLE default.wallet_identity_overrides
(
    `executor_wallet` String,
    `canonical_wallet` String,
    `mapping_type` String,
    `source` String,
    `created_at` DateTime DEFAULT now(),
    `updated_at` DateTime DEFAULT now()
)
ENGINE = SharedReplacingMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}', updated_at)
ORDER BY executor_wallet
SETTINGS index_granularity = 8192
```

---

## Required Permissions

**User:** `default` (current ClickHouse user)
**Table:** `default.wallet_identity_overrides`
**Permissions Needed:**
- INSERT
- UPDATE (for ReplacingMergeTree deduplication)
- SELECT (already working)

**Suggested Grant Statement:**
```sql
GRANT INSERT, SELECT ON default.wallet_identity_overrides TO default;
```

---

## Pending Data to Insert

Once permissions are granted, the following 3 validated wallet mappings need to be inserted:

### Wallet #2 (98.26% overlap, 13,126 shared transactions)
```sql
INSERT INTO wallet_identity_overrides VALUES (
  '0xf29bb8e0712075041e87e8605b69833ef738dd4c',
  '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
  'proxy_to_eoa',
  'tx_overlap_discovery_c1_agent_multi_proxy',
  now(),
  now()
);
```

### Wallet #5 (97.62% overlap, 42,374 shared transactions)
```sql
INSERT INTO wallet_identity_overrides VALUES (
  '0xee00ba338c59557141789b127927a55f5cc5cea1',
  '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
  'proxy_to_eoa',
  'tx_overlap_discovery_c1_agent_multi_proxy',
  now(),
  now()
);
```

### Wallet #6 (100% overlap, 27,235 shared transactions)
```sql
INSERT INTO wallet_identity_overrides VALUES (
  '0x7fb7ad0d194d7123e711e7db6c9d418fac14e33d',
  '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
  'proxy_to_eoa',
  'tx_overlap_discovery_c1_agent_multi_proxy',
  now(),
  now()
);
```

---

## Business Impact

**Current State:**
- Discovered mega multi-proxy pattern: 6+ executor wallets → 1 account
- Validated $6.3B in trading volume (61% of top 100 collision wallets)
- Cannot persist mappings to reduce collision rates

**Impact of Delay:**
- Wallet canonicalization pipeline blocked
- Collision analytics remain inflated
- Cannot expand discovery to remaining collision wallets
- Leaderboard and analytics show duplicate entries for same trader

**Expected Resolution Time:** < 5 minutes once permissions granted

---

## Verification Steps (Post-Grant)

After granting permissions, verify with:

```sql
-- Test INSERT
INSERT INTO wallet_identity_overrides VALUES (
  '0xf29bb8e0712075041e87e8605b69833ef738dd4c',
  '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
  'proxy_to_eoa',
  'tx_overlap_discovery_c1_agent_multi_proxy',
  now(),
  now()
);

-- Verify persistence
SELECT count() AS total FROM wallet_identity_overrides FINAL;
-- Expected: 2 rows (1 existing + 1 new)
```

---

## Alternative Solutions (If Permissions Cannot Be Granted)

If `INSERT` permissions cannot be granted to `default` user:

**Option A:** Execute the 3 INSERT statements manually with admin credentials
**Option B:** Create alternative table/schema with write access for wallet mappings
**Option C:** Provide temporary elevated credentials for C1 agent

---

## Contact

**Session:** C1 (Database / Wallet Canonicalization Agent)
**Documentation:** `docs/C1_WALLET_MAPPING_SESSION_FINAL.md`
**Scripts:** `scripts/add-wallet-mappings-2-5-6.ts`, `scripts/test-write-permissions.ts`

---

**Status:** ⚠️ BLOCKING - Awaiting database admin intervention
**Priority:** HIGH - Wallet canonicalization pipeline
**Estimated Fix Time:** < 5 minutes
