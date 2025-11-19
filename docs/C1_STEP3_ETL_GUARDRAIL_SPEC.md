# Step 3: ETL Ingest Guardrail Specification

**For:** C2 (Data Pipeline Agent)
**Date:** 2025-11-16 (PST)
**Purpose:** Prevent wallet attribution drift at ingest time

---

## Guardrail Requirements

### 1. Input Normalization (Before Insert)

**On every trade ingest:**

```typescript
// Normalize wallet address
const wallet_normalized = trade.wallet_address.toLowerCase();

// Normalize condition ID
const cid_normalized = trade.condition_id
  .replace(/^0x/, '')  // Strip 0x prefix if present
  .toLowerCase();      // Lowercase

// Attach to trade record
trade.wallet_address = wallet_normalized;
trade.condition_id_norm_v3 = cid_normalized;
```

### 2. Attribution Collision Detection

**Before inserting into `pm_trades_canonical_v3`:**

```sql
-- Check if transaction_hash already exists with different wallet_canonical
SELECT
  existing.transaction_hash,
  existing.wallet_canonical AS existing_wallet,
  new.wallet_canonical AS incoming_wallet
FROM pm_trades_canonical_v3 existing
JOIN new_trades_batch new USING (transaction_hash)
WHERE existing.wallet_canonical != new.wallet_canonical;
```

**If query returns rows:**
1. **Do NOT insert** the conflicting trade into `pm_trades_canonical_v3`
2. **Divert to conflict table:**
   ```sql
   INSERT INTO pm_trades_attribution_conflicts
   SELECT *, now() AS detected_at
   FROM new_trades_batch
   WHERE transaction_hash IN (conflicting_hashes);
   ```
3. **Alert:** Send notification to monitoring channel
   - "Attribution conflict detected: tx_hash {hash} maps to multiple wallets"
   - Include: transaction_hash, existing_wallet, incoming_wallet, timestamp

### 3. Conflict Table Schema

```sql
CREATE TABLE IF NOT EXISTS pm_trades_attribution_conflicts (
  transaction_hash String,
  wallet_address String,
  wallet_canonical String,  -- From canonical view resolution
  condition_id_norm_v3 String,
  trade_direction String,
  shares Decimal64(18),
  usd_value Decimal64(18),
  timestamp DateTime,
  detected_at DateTime DEFAULT now(),
  resolution_status String DEFAULT 'unresolved'
) ENGINE = MergeTree()
ORDER BY (detected_at, transaction_hash);
```

---

## Implementation Notes

**Priority:** MEDIUM (prevents new drift but doesn't fix existing issues)

**Estimated Effort:** 2-3 hours for C2

**Testing:**
1. Insert test trade with known tx_hash
2. Attempt re-insert with different wallet
3. Verify quarantine and alert

**Deployment:**
- Safe to deploy immediately (read-only checks)
- Monitor conflict rate for first 24 hours
- Expect 0-5 conflicts/day initially

---

## Stop Condition

**Do NOT deploy to production if:**
- Guardrail causes >1% of ingests to be quarantined
- Alert volume exceeds 100 conflicts/hour
- Performance degradation >10ms per trade insert

---

**Prepared by:** C1 (Database Agent)
**Date:** 2025-11-16 (PST)
**Status:** ✅ SPEC COMPLETE - Ready for C2 implementation
