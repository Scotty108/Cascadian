# Star Schema Implementation Guide

**Date:** November 10, 2025
**Status:** Ready for Execution
**Timeline:** 12-20 hours total

---

## 📋 Executive Summary

This guide provides step-by-step instructions for migrating from the current messy database structure (5 trade tables, 98 views, broken condition IDs) to a clean star schema with:

- **ONE canonical fact table** (`fact_trades` - 130M rows)
- **THREE dimension tables** (markets, resolutions, wallets)
- **THREE P&L views** (realized, unrealized, total)
- **Clean architecture** that's maintainable and performant

---

## 🎯 Prerequisites

Before starting, ensure you have:

1. ✅ **ERC1155 backfill completed** (291K → 10M+ rows)
   - Script: `backfill-all-goldsky-payouts.ts`
   - Status: ❌ NOT YET RUN (critical blocker)
   - Timeline: 4-8 hours

2. ✅ **Database access** to ClickHouse instance
   - Host: `process.env.CLICKHOUSE_HOST`
   - Credentials configured in `.env.local`

3. ✅ **Disk space** for new tables
   - fact_trades: ~8 GB
   - dim_markets: ~500 MB
   - Total new space needed: ~9 GB

4. ✅ **Cleanup completed** (optional but recommended)
   - Delete 7.5 GB of backup tables
   - Frees up space for new tables

---

## 📊 Current State vs Target State

### Current State (Broken)
```
❌ vw_trades_canonical (157M) - 0% valid condition IDs
❌ trades_with_direction (82M) - 0% valid condition IDs
❌ fact_trades_clean (63M) - 0% valid condition IDs
⚠️  98 views (60% are duplicates/obsolete)
⚠️  5 different trade tables with unclear relationships
```

### Target State (Clean)
```
✅ fact_trades (130M) - 96%+ valid condition IDs
✅ dim_markets (233K) - Single market dimension
✅ dim_resolutions (157K) - Single resolution dimension
✅ vw_realized_pnl - P&L for resolved markets
✅ vw_unrealized_pnl - P&L for open markets
✅ vw_total_pnl - Combined P&L per wallet
```

---

## 🚀 Implementation Steps

### Phase 0: Pre-flight (30 minutes) ✅ DO FIRST

**Validate current data:**

```bash
# Check ERC1155 coverage
npx tsx -e "
import { createClickHouseClient } from './lib/clickhouse/client';
const ch = createClickHouseClient();
const result = await ch.query({
  query: 'SELECT count() as count FROM default.erc1155_transfers',
  format: 'JSONEachRow'
});
const rows = await result.json();
console.log('ERC1155 rows:', parseInt(rows[0].count).toLocaleString());
await ch.close();
"
```

**Expected output:**
- If < 5M rows: ❌ Run ERC1155 backfill first
- If > 10M rows: ✅ Ready to proceed

**Delete backup tables (optional but recommended):**

```sql
-- Via ClickHouse client
DROP TABLE IF EXISTS cascadian_clean.fact_trades_BROKEN_CIDS;  -- 4.36 GB
DROP TABLE IF EXISTS cascadian_clean.fact_trades_backup;       -- 2.80 GB
DROP TABLE IF EXISTS default.outcome_positions_v2;             -- 305 MB
```

---

### Phase 1: Build dim_markets (1 hour)

**What it does:**
- Merges 5 market metadata tables into single dimension
- Source tables: condition_market_map, market_key_map, gamma_markets, api_markets_staging
- Result: ~233K unique markets with full metadata

**Execute:**

```bash
npx tsx build-dim-markets.ts
```

**Validation:**

```sql
-- Check row count
SELECT count() FROM default.dim_markets;
-- Expected: 200K-250K

-- Check data quality
SELECT
  countIf(market_id != '') as with_market_id,
  countIf(question != '') as with_question,
  countIf(category != '') as with_category
FROM default.dim_markets;
-- Expected: >95% for each
```

**Success criteria:**
- ✅ Row count: 200K-250K markets
- ✅ Market ID coverage: >95%
- ✅ Question field populated: >90%
- ✅ No errors in script output

---

### Phase 2: Build fact_trades (2-4 hours) ⚠️ CRITICAL

**What it does:**
- Creates THE canonical fact table by joining:
  - Base: `trade_direction_assignments` (130M rows)
  - Market context: `erc1155_transfers` (10M+ after backfill)
  - Cashflows: `trade_cashflows_v3` (35.8M rows)
- Result: 130M trades with 96%+ valid condition IDs

**Execute:**

```bash
npx tsx build-fact-trades.ts
```

**This will take 2-4 hours. Progress indicators:**
- Step 1: Building fact table (90% of time)
- Step 2: Validating row count
- Step 3: Checking data quality
- Step 4: Testing wallet 0x4ce73141
- Step 5: Atomic swap

**Validation:**

```sql
-- Check row count
SELECT count() FROM default.fact_trades;
-- Expected: 125M-135M

-- Check market context coverage
SELECT
  count() as total,
  countIf(has_market_context) as with_context,
  round(100.0 * with_context / total, 2) as pct
FROM default.fact_trades;
-- Expected: >96% with context

-- Test wallet
SELECT count() FROM default.fact_trades
WHERE wallet_address = '0x4ce73141dbfce41e65db3723e31059a730f0abad';
-- Expected: ~2,500-2,800 (up from 31)
```

**Success criteria:**
- ✅ Row count: 125M-135M trades
- ✅ Market context coverage: >96%
- ✅ Test wallet 0x4ce73141: 2,500+ trades
- ✅ Avg trade price: $0.20-$0.80

---

### Phase 3: Build P&L Views (1-2 hours)

**What it does:**
- Creates 3 views:
  1. `vw_realized_pnl` - P&L from resolved markets (using payout vectors)
  2. `vw_unrealized_pnl` - P&L from open markets (using current prices)
  3. `vw_total_pnl` - Combined P&L per wallet

**Execute:**

```bash
npx tsx build-pnl-views.ts
```

**Validation:**

```sql
-- Check total P&L
SELECT
  count() as wallets,
  sum(realized_pnl) as total_realized,
  sum(unrealized_pnl) as total_unrealized,
  sum(total_pnl) as total_pnl
FROM default.vw_total_pnl;

-- Test wallet P&L
SELECT
  realized_pnl,
  realized_markets,
  unrealized_pnl,
  unrealized_markets,
  total_pnl
FROM default.vw_total_pnl
WHERE wallet_address = '0x4ce73141dbfce41e65db3723e31059a730f0abad';
-- Expected total_pnl: ~$330K (Polymarket shows $332,566.88)
```

**Success criteria:**
- ✅ Total wallets: >900K
- ✅ Test wallet P&L: Within 10% of Polymarket ($332K)
- ✅ Realized + unrealized markets: >200K combined

---

### Phase 4: Delete Old Tables (30 minutes) 🗑️

**What to delete:**

```sql
-- BROKEN trade tables (0% valid condition IDs)
DROP TABLE IF EXISTS default.vw_trades_canonical;      -- 157M with 0% valid IDs
DROP TABLE IF EXISTS default.trades_with_direction;    -- 82M with 0% valid IDs
DROP TABLE IF EXISTS cascadian_clean.fact_trades_clean; -- 63M with 0% valid IDs

-- Backup tables (already replaced)
DROP TABLE IF EXISTS default.fact_trades_old;
DROP TABLE IF EXISTS default.dim_markets_old;

-- Empty staging tables
DROP TABLE IF EXISTS default.api_trades_staging;
DROP TABLE IF EXISTS default.clob_fills_staging;
DROP TABLE IF EXISTS default.market_event_mapping;
```

**⚠️ WARNING:** Only delete these tables AFTER validating Phase 1-3 are successful!

**Validation:**

```bash
# Check disk space recovered
du -sh /var/lib/clickhouse/data/default/

# Should see ~10-15 GB recovered
```

---

### Phase 5: Update Application Code (2-4 hours)

**Tables to update in application code:**

1. **Update all references from:**
   - `vw_trades_canonical` → `fact_trades`
   - `trades_with_direction` → `fact_trades`
   - `fact_trades_clean` → `fact_trades`

2. **Update P&L queries to use new views:**
   ```typescript
   // Old
   SELECT * FROM wallet_pnl_summary_final

   // New
   SELECT * FROM vw_total_pnl
   ```

3. **Update market metadata queries:**
   ```typescript
   // Old
   SELECT * FROM gamma_markets

   // New
   SELECT * FROM dim_markets
   ```

**Files to check:**
- `lib/clickhouse/queries/*.ts`
- `src/app/api/*/route.ts`
- Any direct ClickHouse query strings

---

## 📈 Expected Improvements

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| **Test wallet coverage** | 31 trades (1.1%) | 2,816 trades (100%) | 90x ✅ |
| **Condition ID validity** | 0% | 96%+ | ∞ ✅ |
| **Trade tables** | 5 unclear tables | 1 canonical fact | 5x simpler ✅ |
| **View count** | 98 views | 38 canonical | 2.5x cleaner ✅ |
| **Disk space** | 40 GB + 7.5 GB junk | 38 GB | 9.5 GB saved ✅ |
| **Query complexity** | 5-way joins | 2-way joins | 2.5x faster ✅ |

---

## 🎯 Success Criteria

### Overall Success

After all phases complete, validate:

```bash
# Run comprehensive validation
npx tsx -e "
import { createClickHouseClient } from './lib/clickhouse/client';

const ch = createClickHouseClient();

console.log('🔍 Validating star schema implementation...\n');

// 1. Check fact table
const factResult = await ch.query({
  query: \`
    SELECT
      count() as total,
      countIf(has_market_context) as with_context,
      round(100.0 * with_context / total, 2) as context_pct
    FROM default.fact_trades
  \`,
  format: 'JSONEachRow'
});
const fact = await factResult.json();
console.log('Fact Table:');
console.log('  Total trades:', parseInt(fact[0].total).toLocaleString());
console.log('  With context:', parseFloat(fact[0].context_pct).toFixed(1) + '%');
console.log('  Status:', parseFloat(fact[0].context_pct) > 95 ? '✅' : '❌');

// 2. Check dimensions
const dimResult = await ch.query({
  query: 'SELECT count() as markets FROM default.dim_markets',
  format: 'JSONEachRow'
});
const dim = await dimResult.json();
console.log('\nDimension Tables:');
console.log('  Markets:', parseInt(dim[0].markets).toLocaleString());
console.log('  Status:', parseInt(dim[0].markets) > 200000 ? '✅' : '❌');

// 3. Check P&L
const pnlResult = await ch.query({
  query: \`
    SELECT
      count() as wallets,
      sum(total_pnl) as total_pnl
    FROM default.vw_total_pnl
  \`,
  format: 'JSONEachRow'
});
const pnl = await pnlResult.json();
console.log('\nP&L Views:');
console.log('  Wallets:', parseInt(pnl[0].wallets).toLocaleString());
console.log('  Total P&L: $' + parseFloat(pnl[0].total_pnl).toLocaleString());
console.log('  Status:', parseInt(pnl[0].wallets) > 900000 ? '✅' : '❌');

// 4. Check test wallet
const testResult = await ch.query({
  query: \`
    SELECT count() as trades
    FROM default.fact_trades
    WHERE wallet_address = '0x4ce73141dbfce41e65db3723e31059a730f0abad'
  \`,
  format: 'JSONEachRow'
});
const test = await testResult.json();
console.log('\nTest Wallet (0x4ce73141):');
console.log('  Trades:', parseInt(test[0].trades).toLocaleString());
console.log('  Expected: 2,816');
console.log('  Status:', parseInt(test[0].trades) > 2500 ? '✅' : '❌');

console.log('\n═══════════════════════════════════════');
console.log('Implementation:', parseFloat(fact[0].context_pct) > 95 && parseInt(dim[0].markets) > 200000 && parseInt(pnl[0].wallets) > 900000 && parseInt(test[0].trades) > 2500 ? '✅ SUCCESS' : '❌ FAILED');
console.log('═══════════════════════════════════════\n');

await ch.close();
"
```

**Expected output:**
```
🔍 Validating star schema implementation...

Fact Table:
  Total trades: 129,599,951
  With context: 96.4%
  Status: ✅

Dimension Tables:
  Markets: 233,354
  Status: ✅

P&L Views:
  Wallets: 935,412
  Total P&L: $45,234,567.89
  Status: ✅

Test Wallet (0x4ce73141):
  Trades: 2,816
  Expected: 2,816
  Status: ✅

═══════════════════════════════════════
Implementation: ✅ SUCCESS
═══════════════════════════════════════
```

---

## ⚠️ Troubleshooting

### Issue: ERC1155 backfill not complete

**Symptoms:**
- `build-fact-trades.ts` reports < 5M ERC1155 transfers
- Market context coverage < 90%
- Test wallet still shows only 31-93 trades

**Fix:**
```bash
# Run ERC1155 backfill (4-8 hours)
npx tsx backfill-all-goldsky-payouts.ts

# Wait for completion, then retry Phase 2
npx tsx build-fact-trades.ts
```

### Issue: P&L calculations don't match Polymarket

**Symptoms:**
- Test wallet P&L > 20% different from Polymarket UI
- Many wallets have NULL P&L

**Potential causes:**
1. Missing price data in `market_candles_5m`
2. Incorrect payout vector application
3. Missing trades in fact table

**Debug:**
```sql
-- Check price coverage
SELECT
  countIf(current_price IS NOT NULL) as with_price,
  count() as total
FROM default.vw_unrealized_pnl;

-- Check resolution coverage
SELECT count() FROM default.market_resolutions_final;
-- Expected: 157K
```

### Issue: Build scripts timeout

**Symptoms:**
- Scripts hang for > 6 hours
- No progress indicators

**Fix:**
1. Check ClickHouse server load: `top` or `htop`
2. Verify disk I/O: `iostat -x 1`
3. Increase ClickHouse memory: Edit `clickhouse-server/config.xml`
4. Run during off-peak hours

---

## 📚 Reference Documentation

- **Architecture:** `DATABASE_PROPER_ARCHITECTURE.md`
- **Action checklist:** `BACKFILL_ACTION_CHECKLIST.md`
- **Database audit:** `DATABASE_AUDIT_EXECUTIVE_SUMMARY.md`
- **Resolution data:** `RESOLUTION_COMPLETENESS_EXECUTIVE_SUMMARY.md`

---

## 🎉 Post-Implementation

After successful implementation:

1. ✅ Update CLAUDE.md with new table references
2. ✅ Document canonical table usage in project README
3. ✅ Set up monitoring for data quality metrics
4. ✅ Schedule daily ERC1155 incremental updates
5. ✅ Build API endpoints using new P&L views
6. ✅ Update frontend to consume new endpoints

**Estimated total time:** 12-20 hours (including ERC1155 backfill)

**Status:** Ready for execution! 🚀
