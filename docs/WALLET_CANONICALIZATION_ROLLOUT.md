# Wallet Canonicalization Rollout Guide

**Date:** 2025-11-16 (PST)
**From:** C1 (Database Agent)
**To:** C2 (Data Pipeline), C3 (Validation), Dashboard Developers
**Status:** Ready for Migration

---

## Executive Summary

### What Changed

**Root Cause Identified:**
- Polymarket API reports positions at the **account wallet** level
- ClickHouse stores trades at the **executor wallet** level (on-chain proxy addresses)
- Missing executor → account wallet mapping caused **all PnL calculations to fail**

**Solution Implemented:**
- Created `wallet_identity_map` table to map executor wallets to account wallets
- Created canonical views that expose `wallet_canonical` field
- Validated against Polymarket API with Xi Jinping market (±10% tolerance)

**Impact:**
- XCN wallet now shows correct P&L (~$41k profit vs previous $0)
- All downstream systems can now query by account wallet (user-facing ID)
- Trade data preserved at executor level for audit trail

---

## Technical Changes

### New Database Objects

#### 1. `wallet_identity_map` Table

**Purpose:** Maps executor wallets (on-chain) to canonical wallets (account/UI)

**Schema:**
```sql
CREATE TABLE wallet_identity_map (
  executor_wallet String,      -- On-chain proxy (e.g., 0x4bfb...)
  canonical_wallet String,      -- Account wallet (e.g., 0xcce2...)
  mapping_type String,          -- 'proxy_to_eoa', 'contract_to_owner', etc.
  source String,                -- 'erc20_analysis', 'polymarket_api', etc.
  created_at DateTime,
  updated_at DateTime
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (executor_wallet, canonical_wallet);
```

**Initial Data:**
- XCN mapping: `0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e` → `0xcce2b7c71f21e358b8e5e797e586cbc03160d58b`
- Additional mappings to be added via Explore Agent findings

#### 2. `vw_trades_canonical_with_canonical_wallet` View

**Purpose:** Global canonical trades view with wallet translation

**Key Fields:**
- `wallet_canonical` - Mapped account wallet (use this for business logic)
- `wallet_raw` - Original executor wallet (use for audit)
- `cid_norm` - Normalized condition_id (bare hex, lowercase, 64 chars)
- All original `pm_trades_canonical_v3` columns preserved

**Logic:**
```sql
SELECT
  coalesce(m.canonical_wallet, lower(t.wallet_address)) AS wallet_canonical,
  lower(t.wallet_address) AS wallet_raw,
  lower(replaceRegexpAll(t.condition_id_norm_v3, '^0x', '')) AS cid_norm,
  t.*
FROM pm_trades_canonical_v3 t
LEFT JOIN wallet_identity_map m ON lower(t.wallet_address) = m.executor_wallet;
```

**Fallback Behavior:** If no mapping exists, `wallet_canonical = wallet_raw`

#### 3. `vw_xcn_pnl_source` View

**Purpose:** XCN-specific canonical view (replaces `vw_xcn_repaired_only`)

**Filter:**
```sql
SELECT * FROM vw_trades_canonical_with_canonical_wallet
WHERE wallet_canonical = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
```

---

## Migration Guide

### For C2 (Data Pipeline Agent)

#### Before (OLD - DO NOT USE)
```sql
-- Querying by executor wallet (WRONG - misses account-level positions)
SELECT *
FROM pm_trades_canonical_v3
WHERE wallet_address = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e';  -- Executor
```

#### After (NEW - USE THIS)
```sql
-- Querying by canonical wallet (CORRECT - shows user's positions)
SELECT *
FROM vw_trades_canonical_with_canonical_wallet
WHERE wallet_canonical = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';  -- Account
```

#### Critical Rules

1. **Always use `wallet_canonical` for business logic**
   - User queries should filter on `wallet_canonical`
   - P&L aggregations should group by `wallet_canonical`
   - Dashboard displays should show `wallet_canonical`

2. **Preserve `wallet_raw` for audit trail**
   - Keep `wallet_raw` in SELECT lists for debugging
   - Use `wallet_raw` when investigating blockchain transactions
   - Never discard `wallet_raw` - it's the source of truth

3. **Use `cid_norm` for condition_id comparisons**
   - Always filter on `cid_norm` (not `condition_id_norm_v3`)
   - Format: lowercase, no "0x" prefix, 64 characters
   - Example: `f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1`

### For C3 (Validation Agent)

#### View Replacement

**Old View:** `vw_xcn_repaired_only`
- Contained collision repair logic
- Used executor wallet

**New View:** `vw_xcn_pnl_source`
- Integrates collision repair + canonical wallet mapping
- Uses account wallet

**Migration:**
Replace all references to `vw_xcn_repaired_only` with `vw_xcn_pnl_source`.

#### Validation Workflow

1. **Run validation script:**
   ```bash
   npx tsx scripts/validate-canonical-wallet-xi-market.ts
   ```

2. **Expected output:**
   ```
   ✅ VALIDATION PASSED - All metrics within tolerance (±10%)
   ```

3. **If validation fails:**
   - Check `wallet_identity_map` has XCN mapping
   - Verify `cid_norm` format (bare hex, no 0x)
   - Investigate trade_direction or calculation logic

#### P&L Calculation Pattern

**Old Pattern (WRONG):**
```sql
SELECT
  sum(usd_value) AS total_pnl
FROM vw_xcn_repaired_only
WHERE wallet_address = '0x4bfb...982e';  -- Executor
```

**New Pattern (CORRECT):**
```sql
SELECT
  sum(usd_value) AS total_pnl
FROM vw_xcn_pnl_source  -- Already filtered to canonical wallet
WHERE cid_norm = 'condition_id_here';
```

### For Dashboard Developers

#### User-Facing Wallet Display

**Rule:** Always display `wallet_canonical` to users

**Example:**
```tsx
// Before (WRONG)
<WalletCard address={trade.wallet_address} />  // Shows executor

// After (CORRECT)
<WalletCard address={trade.wallet_canonical} />  // Shows account
```

#### Wallet Search/Filter

**Rule:** Accept account wallet as input, query `wallet_canonical`

**API Endpoint Example:**
```typescript
// Before (WRONG)
app.get('/api/wallets/:address', async (req, res) => {
  const trades = await clickhouse.query({
    query: `SELECT * FROM pm_trades_canonical_v3 WHERE wallet_address = {addr:String}`,
    query_params: { addr: req.params.address }
  });
});

// After (CORRECT)
app.get('/api/wallets/:address', async (req, res) => {
  const trades = await clickhouse.query({
    query: `SELECT * FROM vw_trades_canonical_with_canonical_wallet WHERE wallet_canonical = {addr:String}`,
    query_params: { addr: req.params.address.toLowerCase() }
  });
});
```

#### P&L Display

**Show canonical wallet, preserve raw for tooltip/debug:**

```tsx
function PnlCard({ trade }) {
  return (
    <div>
      <div>Wallet: {trade.wallet_canonical}</div>
      <div>P&L: ${trade.realized_pnl}</div>
      <Tooltip>
        Raw executor: {trade.wallet_raw}
        {trade.wallet_raw !== trade.wallet_canonical && " (mapped)"}
      </Tooltip>
    </div>
  );
}
```

---

## Known Limitations

### 1. Incomplete Mapping Coverage

**Current State:**
- Only XCN wallet fully mapped
- Other high-volume wallets require Explore Agent investigation

**Impact:**
- Unmapped wallets will show `wallet_canonical = wallet_raw` (safe fallback)
- P&L calculations for unmapped wallets may still be incorrect if they use proxies

**Mitigation:**
- Run Explore Agent 3 (Pattern Detector) to find other proxy relationships
- Prioritize top 100 volume wallets for mapping
- Add mappings incrementally via `INSERT INTO wallet_identity_map`

### 2. Eggs-May Markets (Deferred)

**Issue:**
- Some markets missing/partial data
- Not related to wallet attribution issue

**Status:**
- Documented but not blocking
- Requires separate investigation

**Impact:**
- Does not affect Xi market validation
- May affect other XCN positions (low priority)

### 3. Historical Data Gap

**Issue:**
- Mapping only fixes future queries
- Historical reports generated before fix may still be incorrect

**Mitigation:**
- Regenerate historical reports using canonical views
- Add timestamp watermark: "Data recalculated on 2025-11-16 with canonical wallets"

---

## Validation Checklist

Before promoting to production, ensure:

### C1 (Database Agent)
- ✅ `wallet_identity_map` table created
- ✅ XCN mapping seeded
- ✅ `vw_trades_canonical_with_canonical_wallet` view created
- ✅ `vw_xcn_pnl_source` view created
- ✅ Xi market validation passed (±10% tolerance)
- ✅ Zero canonical wallet collisions detected

### C2 (Data Pipeline Agent)
- ⏳ Review all queries using `pm_trades_canonical_v3`
- ⏳ Update to use `vw_trades_canonical_with_canonical_wallet`
- ⏳ Verify ETL ingestion uses `wallet_canonical` for new trades
- ⏳ Test ingest-time collision detection

### C3 (Validation Agent)
- ⏳ Replace `vw_xcn_repaired_only` with `vw_xcn_pnl_source`
- ⏳ Run validation script: `npx tsx scripts/validate-canonical-wallet-xi-market.ts`
- ⏳ Confirm P&L matches Polymarket API (within ±10%)
- ⏳ Audit other high-volume wallets for similar issues

### Dashboard Team
- ⏳ Update all wallet filters to accept `wallet_canonical`
- ⏳ Display `wallet_canonical` in UI (not `wallet_raw`)
- ⏳ Add tooltip showing executor wallet for transparency
- ⏳ Test wallet search with known account wallets

---

## Stop Conditions

**DO NOT promote to production if:**

❌ Xi market validation fails (>10% discrepancy)
❌ Canonical wallet collisions detected (>0)
❌ C2 has not acknowledged migration path
❌ C3 has not validated P&L calculations
❌ Dashboard team has not updated wallet filters
❌ Backup of `pm_trades_canonical_v3` does not exist

**Proceed to production only if:**

✅ All validation checks pass
✅ Downstream agents acknowledge changes
✅ Rollback plan documented
✅ Monitoring alerts configured

---

## Rollback Plan

If production issues occur:

### Immediate Rollback (Emergency)

1. **Revert API queries:**
   ```sql
   -- Emergency: Use old table directly
   SELECT * FROM pm_trades_canonical_v3 WHERE wallet_address = 'wallet_here';
   ```

2. **Disable canonical views:**
   ```sql
   -- Rename views to prevent usage
   RENAME TABLE vw_trades_canonical_with_canonical_wallet TO vw_trades_canonical_with_canonical_wallet_DISABLED;
   ```

3. **Notify stakeholders:**
   - Post in #engineering channel
   - Update status page
   - File incident report

### Permanent Rollback (If Fix Fails)

1. **Drop new objects:**
   ```sql
   DROP TABLE IF EXISTS wallet_identity_map;
   DROP VIEW IF EXISTS vw_trades_canonical_with_canonical_wallet;
   DROP VIEW IF EXISTS vw_xcn_pnl_source;
   ```

2. **Restore old views:**
   ```sql
   -- Restore vw_xcn_repaired_only (collision fix only)
   CREATE OR REPLACE VIEW vw_xcn_repaired_only AS ...
   ```

3. **Document root cause:**
   - File post-mortem in `docs/incidents/`
   - Tag failed approach as "canonical-wallet-v1-failed"

---

## Future Enhancements

### Phase 2: Global Mapping Expansion

1. **Run Explore Agent 3 (Pattern Detector):**
   - Find all proxy/executor wallet relationships
   - Prioritize top 100 volume wallets

2. **Batch insert mappings:**
   ```sql
   INSERT INTO wallet_identity_map
   SELECT * FROM discovered_mappings;
   ```

3. **Monitor mapping coverage:**
   ```sql
   SELECT
     countIf(wallet_canonical != wallet_raw) AS mapped,
     count(*) AS total,
     mapped / total AS coverage_rate
   FROM vw_trades_canonical_with_canonical_wallet;
   ```

### Phase 3: Ingest-Time Guardrails

**Prevent future attribution drift:**

```sql
-- Add to ETL pipeline (check for collisions before insert)
SELECT
  transaction_hash,
  new_canonical AS incoming,
  existing_canonical
FROM new_trades_batch
JOIN vw_trades_canonical_with_canonical_wallet existing USING (transaction_hash)
WHERE new_canonical != existing_canonical;

-- If query returns rows → ALERT (collision detected)
```

### Phase 4: Automated Mapping Discovery

**Use blockchain data to auto-discover relationships:**

1. Analyze ERC20 transfer patterns (executor → account flows)
2. Check transaction hashes shared between wallets
3. Query Polymarket API for known proxy relationships
4. Auto-populate `wallet_identity_map` with high-confidence mappings

---

## Support & Troubleshooting

### Common Issues

**Issue:** Validation script shows "No data returned"
**Fix:**
- Check view exists: `DESCRIBE vw_trades_canonical_with_canonical_wallet`
- Verify mapping: `SELECT * FROM wallet_identity_map WHERE executor_wallet = '0x4bfb...'`
- Inspect schema: `SELECT * FROM vw_trades_canonical_with_canonical_wallet LIMIT 1`

**Issue:** P&L still shows $0 for XCN
**Fix:**
- Confirm using `vw_xcn_pnl_source` (not `vw_xcn_repaired_only`)
- Check filter uses `wallet_canonical = '0xcce2...d58b'` (not executor)
- Run validation script to verify data integrity

**Issue:** Trade count mismatch
**Fix:**
- Verify `cid_norm` format (bare hex, no 0x, lowercase)
- Check for duplicate trades in base table
- Inspect collision repair logic in old view

### Contact

**Database Issues:** Tag C1 (Database Agent)
**Pipeline Issues:** Tag C2 (Data Pipeline Agent)
**Validation Issues:** Tag C3 (Validation Agent)
**Dashboard Issues:** Tag Frontend Team

**Escalation Path:**
1. Check this document first
2. Review `docs/C1_WALLET_CANONICALIZATION_DIRECTIVE.md`
3. Run validation script: `npx tsx scripts/validate-canonical-wallet-xi-market.ts`
4. File issue in `docs/issues/` with full validation output

---

## References

### Documentation

- **Technical Directive:** `docs/C1_WALLET_CANONICALIZATION_DIRECTIVE.md`
- **Validation Script:** `scripts/validate-canonical-wallet-xi-market.ts`
- **Xi Market Findings:** `docs/XI_MARKET_VALIDATION_FINDINGS.md`
- **XCN Attribution Repair:** `docs/XCN_ATTRIBUTION_REPAIR_COMPLETE.md`

### Key Tables & Views

- `wallet_identity_map` - Executor → canonical mapping table
- `vw_trades_canonical_with_canonical_wallet` - Global canonical trades view
- `vw_xcn_pnl_source` - XCN-specific canonical view (replaces `vw_xcn_repaired_only`)
- `pm_trades_canonical_v3` - Base trades table (raw executor wallets)

### Critical Data Points

**XCN Wallets:**
- Account (canonical): `0xcce2b7c71f21e358b8e5e797e586cbc03160d58b`
- Executor (raw): `0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e`

**Xi Market:**
- Condition ID: `f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1`
- Winning Outcome: 0 (Eggs)
- Expected P&L: ~$41,289 (±10%)

---

## Sign-Off

**Prepared by:** C1 (Database Agent)
**Date:** 2025-11-16 (PST)
**Status:** ✅ Ready for downstream adoption

**Summary:**
- Root cause: Executor ≠ Account wallet
- Solution: Canonical wallet mapping infrastructure
- Validation: Xi market matches Polymarket API (±10%)
- Impact: Enables accurate P&L calculations for all wallets

**Action Required:**
- C2: Migrate pipeline queries to canonical views
- C3: Validate P&L calculations with new views
- Dashboards: Update wallet filters to use `wallet_canonical`

**Use `wallet_canonical` for all business logic. Preserve `wallet_raw` for audit.**
