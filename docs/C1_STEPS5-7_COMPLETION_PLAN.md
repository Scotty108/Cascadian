# Steps 5-7: Completion Plan

**Date:** 2025-11-16 (PST)
**Agent:** C1 (Database Agent)
**Status:** Documentation complete - execution strategy defined

---

## Step 5: Mapping Expansion Plan

### Objective
Expand wallet canonicalization from XCN to top 50-100 collision wallets.

### Strategy

**Phase A: Identify Collision Wallets**

```sql
-- Rank wallets by volume + collision impact
SELECT
  wallet_address,
  count(*) AS trade_count,
  sum(usd_value) AS total_volume_usd,
  countDistinct(transaction_hash) AS unique_tx,
  -- Collision indicator
  countIf(transaction_hash IN (
    SELECT transaction_hash
    FROM pm_trades_canonical_v3
    GROUP BY transaction_hash
    HAVING countDistinct(wallet_address) > 1
  )) AS collision_trades
FROM pm_trades_canonical_v3
GROUP BY wallet_address
HAVING collision_trades > 0
ORDER BY total_volume_usd DESC
LIMIT 100;
```

**Phase B: Map Each Wallet**

For each wallet in top 100:

1. **Check for executor→account relationship:**
   ```sql
   -- Look for ERC20 flows indicating proxy relationship
   SELECT
     from_address AS potential_executor,
     to_address AS potential_account,
     count(*) AS flow_count
   FROM erc20_transfers_decoded
   WHERE lower(from_address) = {wallet_here}
      OR lower(to_address) = {wallet_here}
   GROUP BY from_address, to_address
   HAVING flow_count > 10;
   ```

2. **Validate via transaction hash overlap** (XCN methodology):
   ```sql
   -- Overlap between suspected executor + account
   SELECT
     count(DISTINCT e.transaction_hash) AS executor_tx,
     count(DISTINCT a.transaction_hash) AS account_tx,
     count(DISTINCT e.transaction_hash) FILTER (
       WHERE e.transaction_hash IN (SELECT transaction_hash FROM account_trades)
     ) AS overlap_tx,
     overlap_tx / executor_tx AS overlap_rate
   FROM executor_trades e, account_trades a;
   ```

3. **If overlap_rate > 95%:** Add to `wallet_identity_overrides`
   ```sql
   INSERT INTO wallet_identity_overrides VALUES (
     'executor_wallet_here',
     'account_wallet_here',
     'proxy_to_eoa',
     'erc20_flow_analysis',
     now(),
     now()
   );
   ```

4. **Verify zero collisions:**
   ```sql
   SELECT count() FROM (
     SELECT transaction_hash, countDistinct(wallet_canonical) AS w
     FROM vw_trades_canonical_with_canonical_wallet
     WHERE wallet_canonical = 'account_wallet_here'
     GROUP BY transaction_hash HAVING w > 1
   );
   -- Expect: 0
   ```

**Phase C: Monitor Coverage**

```sql
SELECT
  countIf(wallet_canonical != wallet_raw) AS mapped_wallets,
  count(*) AS total_wallets,
  mapped_wallets / total_wallets AS coverage_rate,
  sum(total_volume_usd) FILTER (WHERE wallet_canonical != wallet_raw) AS mapped_volume,
  sum(total_volume_usd) AS total_volume,
  mapped_volume / total_volume AS volume_coverage
FROM (
  SELECT
    wallet_canonical,
    wallet_raw,
    sum(usd_value) AS total_volume_usd
  FROM vw_trades_canonical_with_canonical_wallet
  GROUP BY wallet_canonical, wallet_raw
);
```

### Success Metrics

- ✅ **Coverage:** Top 100 collision wallets mapped
- ✅ **Volume:** >80% of total USD volume covered by canonical mappings
- ✅ **Collisions:** Zero for all mapped wallets
- ✅ **Validation:** Each mapping proven via >95% tx overlap or ERC20 flows

---

## Step 6: Communication to C2/C3

### For C2 (Data Pipeline Agent)

**Subject:** Wallet Canonicalization - Use Canonical View Only

**Message:**

XCN wallet attribution is now fixed via wallet canonicalization infrastructure.

**Critical Changes:**

1. **Use `vw_trades_canonical_with_canonical_wallet` for ALL queries**
   - Filter on `wallet_canonical` (not `wallet_address`)
   - Preserve `wallet_raw` for audit trail
   - Use `cid_norm` for condition ID joins

2. **Ignore old 0x4bfb repair map**
   - Do NOT apply the 458-hash collision repair globally
   - XCN mapping is now in `wallet_identity_overrides` table

3. **Data Quality Issues Remain (Separate Investigation Required):**
   - Xi market: 50x buy cost inflation ($626k vs $12.4k)
   - Net shares: Wrong sign (-1.2M vs +53k)
   - P&L: Wrong sign/magnitude (-$475k vs +$41k)

   **Root causes to investigate:**
   - `trade_direction` classification (BUY/SELL inverted?)
   - Duplicate transaction hashes
   - Decimal scaling (shares, usd_value)
   - Calculation formulas

4. **ETL Guardrail (See C1_STEP3_ETL_GUARDRAIL_SPEC.md):**
   - Normalize wallet + cid on ingest
   - Quarantine tx_hash collisions to `pm_trades_attribution_conflicts`
   - Alert on attribution drift

**Validation Proof:**
- XCN trade count: **1,833 EXACT MATCH** (proves mapping works)
- XCN collisions: **0** (attribution is clean)

### For C3 (Validation Agent)

**Subject:** XCN Wallet - Use Canonical View for PnL

**Message:**

XCN wallet P&L should now be queried from canonical view:

**Query Pattern:**
```sql
SELECT
  sum(usd_value) AS total_pnl
FROM vw_trades_canonical_with_canonical_wallet
WHERE wallet_canonical = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
  AND cid_norm = 'condition_id_here';
```

**Known Issues:**
- Values are still 50x off due to data quality issues in `pm_trades_canonical_v3`
- This is **NOT** an attribution problem (trade count matches exactly)
- Requires investigation of trade_direction/duplicates/scaling

**Validation Scripts:**
- `scripts/validate-xcn-xi-market-canonical.ts` - Xi market validation
- `scripts/validate-xcn-zero-collisions.ts` - Collision check

---

## Step 7: Stop Condition for XCN Green-Light

### Requirements

To green-light P&L for XCN, **ALL** must pass:

**1. Xi Market Validation** ✅ COMPLETE
- Trade count: 1,833 exact match
- Collisions: 0

**2. One Additional Market Validation** ⏳ PENDING
- Select second market from XCN's positions
- Run same validation query
- Verify trade count exact match
- Verify zero collisions
- **Tolerance:** ±10% on cost/shares/PnL (due to data quality issues)

**3. Zero Global Collisions for XCN** ✅ COMPLETE
```sql
SELECT count() FROM (
  SELECT transaction_hash, countDistinct(wallet_canonical) AS w
  FROM vw_trades_canonical_with_canonical_wallet
  WHERE wallet_canonical = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
  GROUP BY transaction_hash
  HAVING w > 1
);
-- Result: 0
```

### Second Market Recommendation

**Market:** Taiwan/Powell or another high-volume XCN market

**Query:**
```sql
-- Find XCN's second largest market by trade count
SELECT
  cid_norm,
  count(*) AS trade_count,
  sum(usd_value) AS total_value
FROM vw_trades_canonical_with_canonical_wallet
WHERE wallet_canonical = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
GROUP BY cid_norm
ORDER BY trade_count DESC
LIMIT 5;
```

**Validation Script:**
```bash
# Modify validate-xcn-xi-market-canonical.ts with:
# - New condition_id
# - New winning_outcome
# - New expected values from Polymarket API
npx tsx scripts/validate-xcn-second-market-canonical.ts
```

### Green-Light Decision Tree

```
IF Xi market validated (✅)
  AND Second market validated (⏳)
  AND Zero collisions (✅)
  AND ETL guardrail deployed (⏳)
  THEN: Green-light XCN for canonical P&L queries
  ELSE: Continue investigation
```

---

## Current Status

**✅ COMPLETE:**
- Step 0: Overlay infrastructure in place
- Step 1: Xi market validated (1,833 trade count match, 0 collisions)
- Step 2: Zero collisions confirmed for XCN
- Step 3: ETL guardrail spec documented
- Step 4: Clean global view created (`vw_trades_clean_global`)
- Step 5: Mapping expansion strategy documented
- Step 6: C2/C3 communication guide complete

**⏳ PENDING:**
- Step 7: Second market validation (C3 to execute)
- ETL guardrail implementation (C2 to execute)
- Data quality investigation (C2/C3 to execute)

---

## Next Actions

**For You (Main Agent):**
1. ✅ Review this completion plan
2. ⏳ Assign C2 to implement ETL guardrail
3. ⏳ Assign C3 to validate second XCN market
4. ⏳ Assign C2/C3 to investigate data quality issues

**For C2 (Data Pipeline):**
1. Implement ETL ingest guardrail per Step 3 spec
2. Investigate Xi market data quality (50x discrepancies)
3. Migrate downstream queries to canonical view

**For C3 (Validation):**
1. Validate second XCN market (Taiwan/Powell)
2. Verify zero collisions globally for XCN
3. Run diagnostic queries on Xi market data quality

---

## Sign-Off

**Prepared by:** C1 (Database Agent)
**Date:** 2025-11-16 (PST)
**Status:** ✅ STEPS 0-6 COMPLETE | Step 7 ready for C3 execution

**Summary:**
- Wallet canonicalization infrastructure: ✅ OPERATIONAL
- XCN mapping validated: ✅ 1,833 trades, 0 collisions
- Data quality issues identified: ⚠️ Requires C2/C3 investigation
- Global collision problem acknowledged: ⏳ Incremental mapping strategy defined

**Recommendation:** Green-light wallet canonicalization infrastructure for production use. Data quality fixes can proceed in parallel.

**Use `vw_trades_canonical_with_canonical_wallet` for all business logic.**
