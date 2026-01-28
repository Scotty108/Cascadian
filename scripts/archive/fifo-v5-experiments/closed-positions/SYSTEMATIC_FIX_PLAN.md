# Systematic Fix: Closed Positions Tracking

## The Problem

**Current system ONLY tracks resolved positions:**
- FIFO table: Only includes positions where `payout_numerators IS NOT NULL`
- Missing: Positions where trader fully exited (net_tokens = 0) but market hasn't resolved
- Impact: $7k+ PnL errors per wallet (e.g., FuelHydrantBoss: $1.8k shown vs $8.7k actual)

**Scale of the problem:**
- Affects ALL wallets with closed-but-unresolved positions
- Impacts ALL PnL calculations: leaderboards, wallet endpoints, analytics
- Estimated 500k-1M closed positions globally

---

## The Solution

### 3-Tier PnL Tracking System

| Tier | Definition | Data Source | Current Status |
|------|------------|-------------|----------------|
| **Realized** | Market resolved | `pm_trade_fifo_roi_v3_deduped` | ✅ Working |
| **Closed** | Fully exited, unresolved | `pm_closed_positions_v1` | 🆕 NEW |
| **Unrealized** | Still holding tokens | V1 position aggregation | ✅ Working |

---

## Implementation Checklist

### Phase 1: Core Infrastructure ✅
- [x] Create `pm_closed_positions_v1` table
- [x] Create `pm_closed_positions_current` view (deduped)
- [x] Backfill historical data
- [x] Verify with test wallet (FuelHydrantBoss)

### Phase 2: V1 Engine Integration 🔄 IN PROGRESS
- [ ] Update `lib/pnl/pnlEngineV1.ts` to query closed positions
- [ ] Add `closed_pnl` to return type
- [ ] Update `getWalletPnLV1()` calculation
- [ ] Update `getWalletPnLWithConfidence()` diagnostics

### Phase 3: API Endpoints 📋 PENDING
Update ALL endpoints that calculate PnL:

#### Wallet Endpoints
- [ ] `app/api/wio/wallet/[address]/route.ts`
  - Add closed positions to PnL calculation
  - Show 3-tier breakdown: realized | closed | unrealized

#### Leaderboard Endpoints
- [ ] `app/api/leaderboard/ultra-active/route.ts`
  - Include closed positions in total_pnl
- [ ] `app/api/copy-trading/leaderboard/route.ts`
  - Update PnL calculations
- [ ] Any other leaderboard queries

#### Analytics Endpoints
- [ ] Search all endpoints that query FIFO or calculate PnL
- [ ] Add closed positions to aggregations

### Phase 4: Cron Jobs 📋 PENDING
- [ ] `app/api/cron/refresh-fifo-trades/route.ts`
  - Add closed positions refresh logic
  - Run after FIFO refresh
- [ ] Create new cron: `refresh-closed-positions`
  - Runs every 1 hour
  - Updates only changed positions (incremental)

### Phase 5: Frontend 📋 PENDING
- [ ] Update PnL displays to show 3-tier breakdown
- [ ] Add tooltips explaining "Closed (unresolved)" positions
- [ ] Update charts/graphs to include closed positions

### Phase 6: Documentation 📋 PENDING
- [ ] Update `docs/READ_ME_FIRST_PNL.md`
- [ ] Document closed positions in CLAUDE.md
- [ ] Add to database documentation

---

## Files to Modify

### Core Engine
```
lib/pnl/pnlEngineV1.ts
lib/pnl/types.ts  (add closed_pnl field)
```

### API Endpoints (Search results)
```bash
# Find all files that query FIFO or calculate PnL
grep -r "pm_trade_fifo_roi" app/api/ --files-with-matches
grep -r "pnl_usd" app/api/ --files-with-matches
grep -r "getWalletPnL" app/api/ --files-with-matches
```

### Cron Jobs
```
app/api/cron/refresh-fifo-trades/route.ts
app/api/cron/refresh-closed-positions/route.ts (NEW)
```

---

## New Database Objects

### Table: `pm_closed_positions_v1`
```sql
CREATE TABLE pm_closed_positions_v1 (
  wallet String,
  condition_id String,
  outcome_index UInt8,
  net_cash_flow Float64,  -- This is the realized PnL
  -- ... other fields
)
ENGINE = ReplacingMergeTree(_version)
ORDER BY (wallet, condition_id, outcome_index)
```

### View: `pm_closed_positions_current`
```sql
CREATE VIEW pm_closed_positions_current AS
SELECT ...
FROM pm_closed_positions_v1
GROUP BY wallet, condition_id, outcome_index
```

---

## Testing Strategy

### 1. Unit Tests (Per Wallet)
Test wallets with known discrepancies:
- FuelHydrantBoss (0x94a4...): $1.8k → $8.7k ✓
- czpre (0x7ed6...): -$4.8k → -$568 (test this)
- Others: Run validation script on top 100 wallets

### 2. Integration Tests (System-wide)
```sql
-- Test: Total PnL should increase significantly
SELECT
  sum(pnl_before) as before,
  sum(pnl_after) as after,
  sum(pnl_after - pnl_before) as total_gain
FROM (
  SELECT wallet,
    (SELECT sum(pnl_usd) FROM pm_trade_fifo_roi_v3_deduped WHERE ...) as pnl_before,
    (SELECT sum(pnl_usd) FROM pm_trade_fifo_roi_v3_deduped WHERE ...)
      + (SELECT sum(net_cash_flow) FROM pm_closed_positions_current WHERE ...) as pnl_after
  FROM (SELECT DISTINCT wallet FROM pm_closed_positions_current LIMIT 1000)
)
```

### 3. Regression Tests
- Verify leaderboard order changes (some wallets will jump ranks)
- Check API response times (should still be < 1s per wallet)
- Validate no double-counting (FIFO + closed should be disjoint)

---

## Rollout Plan

### Stage 1: Silent Deployment (Week 1)
1. Deploy table and populate data
2. Update V1 engine with feature flag
3. Test on small subset of wallets
4. Monitor for anomalies

### Stage 2: Internal Validation (Week 2)
1. Enable for all internal queries
2. Compare old vs new PnL for all wallets
3. Investigate large discrepancies
4. Fix any bugs

### Stage 3: Production Launch (Week 3)
1. Update all API endpoints
2. Update frontend displays
3. Enable cron jobs
4. Monitor user feedback

### Stage 4: Optimization (Ongoing)
1. Add indexes if queries are slow
2. Optimize refresh frequency
3. Consider materialized views for leaderboards

---

## Success Metrics

| Metric | Before | After | Target |
|--------|--------|-------|--------|
| PnL accuracy vs PM | ~50% off | ??? | >95% |
| Wallets with closed positions | 0 tracked | ~100k+ | All |
| Missing PnL per wallet | $7k avg | $0 | <$100 |
| API response time | <1s | ??? | <1s |

---

## Risks & Mitigation

### Risk 1: Performance degradation
- **Mitigation:** Index closed positions table, cache results
- **Fallback:** Use materialized view if queries too slow

### Risk 2: Double-counting positions
- **Mitigation:** Ensure FIFO and closed are mutually exclusive
- **Test:** Validate no overlap in position sets

### Risk 3: Incorrect closed position detection
- **Mitigation:** Threshold for "closed" is |net_tokens| < 0.01
- **Test:** Manual verification of sample closed positions

### Risk 4: Cron job timing conflicts
- **Mitigation:** Run closed position refresh AFTER FIFO refresh
- **Monitor:** Track refresh times and errors

---

## Monitoring

### Dashboards
1. **Closed Positions Growth**
   - New closed positions per day
   - Total closed positions over time
2. **PnL Comparison**
   - Old PnL vs New PnL distribution
   - Wallets with >$1k difference
3. **System Health**
   - Refresh job success rate
   - Query performance metrics

### Alerts
- Closed position refresh job fails
- Query time > 2s for wallet lookup
- Large PnL discrepancies (>10k) detected

---

## Next Steps (Priority Order)

1. ✅ **Create infrastructure** (DONE)
2. 🔄 **Populate data** (IN PROGRESS)
3. ⏳ **Verify test wallet** (NEXT)
4. ⏳ **Update V1 engine**
5. ⏳ **Update all API endpoints**
6. ⏳ **Deploy and monitor**

---

## Questions to Resolve

1. Should we backfill closed positions for ALL history or just recent (e.g., last 6 months)?
   - Recommendation: ALL history (one-time cost, complete data)

2. How often to refresh closed positions?
   - Recommendation: Every 1 hour (same as FIFO)

3. Should we count closed positions as "realized" or separate category?
   - Recommendation: Separate category for transparency

4. What to do when a closed position's market resolves?
   - Recommendation: Keep in closed table, just mark market_open=0

---

## Related Documents

- [READ_ME_FIRST_PNL.md](../../docs/READ_ME_FIRST_PNL.md) - PnL engine documentation
- [DEDUPLICATION_STRATEGY.md](../dedup/00-EXECUTE-SYSTEMATIC-FIX.md) - Dedup approach
- [TABLE_RELATIONSHIPS.md](../../docs/systems/database/TABLE_RELATIONSHIPS.md) - Schema docs
