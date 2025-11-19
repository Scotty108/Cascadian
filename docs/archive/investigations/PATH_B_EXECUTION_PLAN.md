# Path B Execution Plan: Fix Pipeline & Deploy

**Decision:** Path B - Fix data pipeline before production deployment
**Timeline:** 12-24 hours total work
**Target Completion:** 2025-11-07 EOD or 2025-11-08 AM
**Risk Level:** LOW (fixing known issues, not new features)

---

## Strategic Overview

### What We're Doing
1. **Backfill historical gap** - Import Oct 31 - Nov 6 trades for full coverage
2. **Implement daily sync** - Add cron job to keep data current
3. **Drop broken tables** - Remove enriched tables that have 99.9% error
4. **Validate thoroughly** - Test LucasMeow, xcnstrategy, HolyMoses7, niggemon
5. **Deploy with confidence** - 100% coverage, no disclaimers needed

### Why This Works
- Formula proven correct (niggemon -2.3% variance)
- Data structure sound (outcome_positions_v2 + trade_cashflows_v3)
- Just need to fill temporal gap and establish continuous sync
- One day delay buys professional launch vs beta launch

---

## Phase 1: Backfill Missing Trades (3-4 hours)

### 1.1 Identify Source Data
**Task:** Determine if Oct 31 - Nov 6 trades are in trades_raw

```sql
-- Check for trades after Oct 31 snapshot
SELECT
  COUNT(*) as trade_count,
  MIN(timestamp) as earliest,
  MAX(timestamp) as latest,
  COUNT(DISTINCT wallet) as affected_wallets
FROM trades_raw
WHERE timestamp > 1730419199  -- 2025-10-31 23:59:59
```

**Expected Result:** Should show thousands of trades from Nov 1-6
**Action if zero:** Data backfill script never ran post-Oct 31 (investigate blockchain import)

### 1.2 Rebuild outcome_positions_v2 with Full Date Range
**Location:** Look for `/scripts/` files like:
- `build-positions-from-erc1155.ts`
- `build-outcome-positions-canonical.ts`
- Similar aggregation scripts

**Command:**
```bash
# Run without date filters to capture all data through latest
npx tsx scripts/build-positions-from-erc1155.ts --no-cutoff

# Or if that doesn't exist, use:
npx tsx scripts/build-outcome-positions-canonical.ts
```

**Expected Behavior:**
- Before: outcome_positions_v2 has N rows
- After: outcome_positions_v2 has N + (rows for Oct 31 - Nov 6 gap)
- LucasMeow and xcnstrategy should appear in results

### 1.3 Rebuild trade_cashflows_v3 with Full Date Range
**Command:**
```bash
npx tsx scripts/build-trade-cashflows-canonical.ts --no-cutoff
```

**Validation:**
```sql
SELECT COUNT(DISTINCT wallet) FROM trade_cashflows_v3;
-- Should be significantly higher than before
```

### 1.4 Verify Backfill Success
**Check LucasMeow presence:**
```sql
SELECT COUNT(*) as row_count
FROM outcome_positions_v2
WHERE wallet = lower('0x7f3c8979d0afa00007bae4747d5347122af05613');
```

**Expected:** > 0 (was 0 before)

**Check xcnstrategy presence:**
```sql
SELECT COUNT(*) as row_count
FROM outcome_positions_v2
WHERE wallet = lower('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b');
```

**Expected:** > 0 (was 0 before)

---

## Phase 2: Implement Daily Sync (2-3 hours)

### 2.1 Create Sync Script
**File:** `/scripts/daily-sync-polymarket.ts`

```typescript
#!/usr/bin/env npx tsx
/**
 * Daily sync for Polymarket data
 * Runs every 24 hours to capture new trades
 * Backfill script: Update outcome_positions_v2 and trade_cashflows_v3
 */

import { execSync } from 'child_process';

async function main() {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Starting daily Polymarket sync...`);

  try {
    // Step 1: Fetch new CLOB fills (last 24 hours)
    console.log('  - Importing new CLOB fills...');
    execSync('npx tsx scripts/ingest-clob-fills.ts --since=24h', { stdio: 'inherit' });

    // Step 2: Fetch new ERC1155 transfers (last 24 hours)
    console.log('  - Importing new ERC1155 transfers...');
    execSync('npx tsx scripts/ingest-erc1155-transfers.ts --since=24h', { stdio: 'inherit' });

    // Step 3: Rebuild aggregated tables
    console.log('  - Rebuilding outcome positions...');
    execSync('npx tsx scripts/build-positions-from-erc1155.ts --no-cutoff', { stdio: 'inherit' });

    console.log('  - Rebuilding cashflows...');
    execSync('npx tsx scripts/build-trade-cashflows-canonical.ts --no-cutoff', { stdio: 'inherit' });

    // Step 4: Log success
    console.log(`[${new Date().toISOString()}] ✅ Daily sync complete`);
    process.exit(0);
  } catch (e) {
    console.error(`[${new Date().toISOString()}] ❌ Sync failed:`, e.message);
    process.exit(1);
  }
}

main();
```

### 2.2 Add Cron Job (Linux/macOS)
**Edit crontab:**
```bash
crontab -e
```

**Add this line (runs daily at 2 AM):**
```cron
0 2 * * * cd /Users/scotty/Projects/Cascadian-app && npx tsx scripts/daily-sync-polymarket.ts >> logs/daily-sync.log 2>&1
```

**For Docker/Production:** Use `docker-compose` or Kubernetes cron job

### 2.3 Verify Sync Runs
**Test manually first:**
```bash
npx tsx scripts/daily-sync-polymarket.ts
```

**Expected output:**
```
Starting daily Polymarket sync...
  - Importing new CLOB fills...
  - Importing new ERC1155 transfers...
  - Rebuilding outcome positions...
  - Rebuilding cashflows...
✅ Daily sync complete
```

---

## Phase 3: Drop Broken Enriched Tables (5-10 min)

### 3.1 Identify Enriched Tables to Remove
**These have 99.9% error rate:**
- `trades_enriched_with_condition` (shows $117 instead of $102K)
- `trades_enriched` (shows $117 instead of $102K)
- `trades_with_recovered_cid` (unreliable)
- `trades_dedup` (empty, broken)

**Do NOT drop:**
- `trades_raw` (source of truth)
- `outcome_positions_v2` (correct formula)
- `trade_cashflows_v3` (correct formula)
- `winning_index` (market resolutions)

### 3.2 Drop Broken Tables
```sql
DROP TABLE IF EXISTS trades_enriched_with_condition;
DROP TABLE IF EXISTS trades_enriched;
DROP TABLE IF EXISTS trades_with_recovered_cid;
DROP TABLE IF EXISTS trades_dedup;
```

### 3.3 Verify Cleanup
```sql
-- Confirm only correct tables remain
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'default'
  AND table_name IN ('trades_raw', 'outcome_positions_v2', 'trade_cashflows_v3', 'winning_index')
ORDER BY table_name;
```

**Expected:** 4 tables shown

---

## Phase 4: Validate with Reference Wallets (1-2 hours)

### 4.1 Test niggemon (Known Good)
```sql
WITH win AS (
  SELECT condition_id_norm, toInt16(win_idx) AS win_idx
  FROM winning_index
)
SELECT
  wallet,
  round(sum(toFloat64(c.cashflow_usdc)) - sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx), 2) AS realized_pnl_usd,
  round(coalesce(u.unrealized_pnl_usd, 0), 2) AS unrealized_pnl_usd,
  round(realized_pnl_usd + unrealized_pnl_usd, 2) AS total_pnl_usd
FROM outcome_positions_v2 AS p
ANY LEFT JOIN trade_cashflows_v3 AS c
  ON (c.wallet = p.wallet) AND (c.market_id = p.market_id) AND (c.condition_id_norm = p.condition_id_norm)
ANY LEFT JOIN win AS w
  ON lower(replaceAll(w.condition_id_norm, '0x', '')) = lower(replaceAll(p.condition_id_norm, '0x', ''))
LEFT JOIN wallet_unrealized_pnl_v2 AS u ON u.wallet = p.wallet
WHERE p.wallet = lower('0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0')
GROUP BY p.wallet, u.unrealized_pnl_usd
```

**Expected:** Total P&L ≈ $102,001.46 (within -2.3% variance)
**Actual niggemon target:** $102,001.46

### 4.2 Test LucasMeow (Previously Missing)
```sql
-- Same query as above but for LucasMeow
WHERE p.wallet = lower('0x7f3c8979d0afa00007bae4747d5347122af05613')
```

**Expected:** Should now show > $0 (previously was 0 rows)
**Target:** $181,131.44 (from Polymarket UI)
**Acceptable variance:** ±5% → $172,074.87 to $190,187.76

### 4.3 Test xcnstrategy (Previously Missing)
```sql
-- Same query for xcnstrategy
WHERE p.wallet = lower('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b')
```

**Expected:** Should now show > $0 (previously was 0 rows)
**Target:** $95,349.02 (from Polymarket UI)
**Acceptable variance:** ±5% → $90,581.57 to $100,116.47

### 4.4 Test HolyMoses7 (Known Issue: Timestamp)
```sql
-- Same query for HolyMoses7
WHERE p.wallet = lower('0xa4b366ad22fc0d06f1e934ff468e8922431a87b8')
```

**Expected:** Should match Oct 31 snapshot target
**Target:** $89,975.16 (from Oct 31 snapshot, not Nov 6 file)
**Note:** File was from Nov 6, so small variance OK

---

## Phase 5: Dry-Run Production Deploy (30 min)

### 5.1 Create Test Environment
```bash
# Clone current views to test versions
# Don't deploy real views yet
```

### 5.2 Validate All Views
```sql
-- Test realized_pnl_by_market_final
SELECT COUNT(*) FROM realized_pnl_by_market_final;

-- Test wallet_realized_pnl_final
SELECT COUNT(*) FROM wallet_realized_pnl_final;

-- Test wallet_pnl_summary_final
SELECT COUNT(*) FROM wallet_pnl_summary_final;
```

**Expected:** Non-zero row counts for all views

### 5.3 Spot-Check API Integration
- Call P&L endpoint with test wallets
- Verify response format and values match database
- Check error handling for missing wallets

---

## Phase 6: Production Deployment (1 hour)

### 6.1 Final Backup
```bash
# Backup current ClickHouse state
# (Provider-specific, consult ClickHouse Cloud docs)
```

### 6.2 Drop Test Views
```sql
DROP VIEW IF EXISTS realized_pnl_by_market_final_test;
DROP VIEW IF EXISTS wallet_realized_pnl_final_test;
DROP VIEW IF EXISTS wallet_pnl_summary_final_test;
```

### 6.3 Deploy Real Views
```sql
CREATE OR REPLACE VIEW realized_pnl_by_market_final AS
[your validated query]

CREATE OR REPLACE VIEW wallet_realized_pnl_final AS
[your validated query]

CREATE OR REPLACE VIEW wallet_pnl_summary_final AS
[your validated query]
```

### 6.4 Run Final Validation
```sql
-- Rerun reference wallet tests with production views
-- All should pass with <= 5% variance
```

### 6.5 Enable API & Frontend
- Deploy updated API endpoints
- Deploy updated frontend with P&L dashboard
- Enable P&L features in product

---

## Rollback Plan (Emergency)

### If Backfill Fails
```bash
# Restore previous outcome_positions_v2
# (Run original build script with Oct 31 cutoff)
npx tsx scripts/build-positions-from-erc1155.ts --cutoff=1730419199
```

### If Sync Breaks Production
```bash
# Disable cron job
crontab -e
# Comment out the sync line

# Restore latest working backup
```

### If Views Have Errors
```sql
DROP VIEW IF EXISTS wallet_pnl_summary_final;
DROP VIEW IF EXISTS wallet_realized_pnl_final;
DROP VIEW IF EXISTS realized_pnl_by_market_final;
-- Recreate with previous working versions
```

---

## Success Criteria (Gate Check)

### Must-Pass Tests
- [ ] LucasMeow returns > $0 (was 0 before)
- [ ] xcnstrategy returns > $0 (was 0 before)
- [ ] niggemon returns within -2.3% ± 2% (previous validation)
- [ ] HolyMoses7 returns within ±5% (allows timestamp variation)
- [ ] Daily sync script runs without errors
- [ ] Enriched tables dropped (backup preserved)
- [ ] No data loss or corruption detected

### Nice-to-Have Validations
- [ ] 10+ additional wallets spot-checked
- [ ] Performance metrics acceptable (sub-5 sec queries)
- [ ] Monitoring alerts configured
- [ ] Runbooks updated for ongoing sync

---

## Timeline Summary

| Phase | Duration | Tasks |
|-------|----------|-------|
| Backfill gap | 3-4 hours | Rebuild tables, verify data import |
| Daily sync | 2-3 hours | Create script, test cron, validate |
| Drop broken tables | 10 minutes | Remove enriched tables |
| Validation | 1-2 hours | Test all reference wallets |
| Dry-run deploy | 30 minutes | Test views, API integration |
| Production deploy | 1 hour | Final backup, enable features |
| **TOTAL** | **12-24 hours** | Ready for launch |

---

## Success = Launch Tomorrow with Confidence

When all gates pass:
- ✅ Formula proven correct
- ✅ Data covers 100% of available wallets
- ✅ Daily sync keeps data current
- ✅ Broken tables removed
- ✅ Reference wallets validated
- ✅ No disclaimers needed

**You launch with a production-ready system, not a beta.**

---

**Next Action:** Execute Phase 1 (Backfill). Post results. I'll guide next phases.
