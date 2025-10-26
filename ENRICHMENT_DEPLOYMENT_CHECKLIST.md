# Trade Enrichment System - Deployment Checklist

## Pre-Deployment Verification

### 1. Test Logic (No Database Required)
```bash
npx tsx scripts/test-enrichment-logic.ts
```
**Expected:** ✅ All 8 tests pass

### 2. Verify ClickHouse Schema
```bash
# Check if metric fields exist
npx tsx -e "
import { clickhouse } from './lib/clickhouse/client';
(async () => {
  const result = await clickhouse.query({
    query: 'DESCRIBE trades_raw',
    format: 'JSONEachRow',
  });
  const fields = await result.json();
  const requiredFields = ['outcome', 'pnl_net', 'pnl_gross', 'fee_usd', 'return_pct', 'hours_held', 'close_price', 'is_closed'];
  const missing = requiredFields.filter(f => !fields.some(field => field.name === f));
  if (missing.length > 0) {
    console.log('❌ Missing fields:', missing);
    process.exit(1);
  }
  console.log('✅ All required fields exist');
})();
"
```
**Expected:** ✅ All required fields exist

**If missing fields:**
```bash
# Run migration
npx tsx -e "
import { clickhouse } from './lib/clickhouse/client';
import { readFileSync } from 'fs';
(async () => {
  const sql = readFileSync('migrations/clickhouse/002_add_metric_fields.sql', 'utf-8');
  await clickhouse.exec({ query: sql });
  console.log('✅ Schema updated');
})();
"
```

### 3. Check Data Availability
```bash
# Verify trades exist
npx tsx -e "
import { clickhouse } from './lib/clickhouse/client';
(async () => {
  const result = await clickhouse.query({
    query: 'SELECT COUNT(*) as count FROM trades_raw',
    format: 'JSONEachRow',
  });
  const data = await result.json();
  const count = parseInt(data[0].count);
  console.log('Trades in ClickHouse:', count);
  if (count === 0) {
    console.log('⚠️  No trades found. Run sync-wallet-trades.ts first.');
  }
})();
"
```
**Expected:** Trades count > 0

**If no trades:**
```bash
npx tsx scripts/sync-wallet-trades.ts 0xWALLET_ADDRESS
```

### 4. Check Market Data
```bash
# Verify resolved markets exist in Supabase
npx tsx -e "
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
(async () => {
  const { data, error } = await supabase
    .from('markets')
    .select('market_id')
    .eq('closed', true)
    .limit(1);
  if (error || !data || data.length === 0) {
    console.log('⚠️  No resolved markets found. Run sync-markets-from-polymarket.ts first.');
  } else {
    console.log('✅ Resolved markets available');
  }
})();
"
```
**Expected:** ✅ Resolved markets available

**If no markets:**
```bash
npx tsx scripts/sync-markets-from-polymarket.ts
```

## Deployment Steps

### Step 1: Test Run (Small Batch)
```bash
# Process first 100 trades as test
npx tsx scripts/enrich-trades.ts --limit 100
```
**Expected output:**
```
═══════════════════════════════════════════════════════════
           TRADE ENRICHMENT PIPELINE
═══════════════════════════════════════════════════════════

📡 Fetching resolved markets from Supabase...
✅ Fetched X resolved markets
📊 Indexed X markets by condition_id

📡 Fetching trades to enrich from ClickHouse...
✅ Found 100 trades to enrich

🔄 Processing in batches of 10,000...

[Batch 1/1] Processing 100 trades...
   💾 [1/1] Updating 100 trades in ClickHouse...
   ✅ Batch 1/1 updated successfully

✅ Total trades processed: 100
✅ Successfully enriched: X (X%)
```

### Step 2: Verify Test Results
```bash
npx tsx scripts/verify-enrichment.ts
```
**Expected:** ✅ All checks pass (or only minor warnings)

### Step 3: Full Production Run
```bash
# Enrich all trades
npx tsx scripts/enrich-trades.ts
```

**Monitor output for:**
- ✅ Enrichment rate > 50%
- ✅ Reasonable win rate (20-80%)
- ✅ No fatal errors
- ✅ Progress tracking working

### Step 4: Final Verification
```bash
npx tsx scripts/verify-enrichment.ts
```

**Check for:**
- ✅ No errors (only warnings acceptable)
- ✅ Sample trades have correct calculations
- ✅ P&L statistics look reasonable

## Post-Deployment Validation

### 1. Data Quality Check
```sql
-- Run in ClickHouse console
SELECT
  COUNT(*) as total_trades,
  COUNTIF(outcome IS NOT NULL) as enriched,
  ROUND(COUNTIF(outcome IS NOT NULL) * 100.0 / COUNT(*), 2) as pct_enriched,
  COUNTIF(outcome = 1) as wins,
  COUNTIF(outcome = 0) as losses,
  ROUND(COUNTIF(outcome = 1) * 100.0 / COUNTIF(outcome IS NOT NULL), 2) as win_rate,
  ROUND(AVG(pnl_net), 2) as avg_pnl,
  ROUND(SUM(pnl_net), 2) as total_pnl
FROM trades_raw
```

**Expected:**
- `pct_enriched` > 50%
- `win_rate` between 20-80%
- `avg_pnl` reasonable (not extreme)
- `total_pnl` reasonable (can be positive or negative)

### 2. Wallet Metrics Test
```sql
-- Test wallet aggregation
SELECT
  wallet_address,
  COUNT(*) as trades,
  COUNTIF(outcome = 1) as wins,
  COUNTIF(outcome = 0) as losses,
  ROUND(COUNTIF(outcome = 1) * 100.0 / COUNT(*), 2) as win_rate,
  ROUND(SUM(pnl_net), 2) as total_pnl,
  ROUND(AVG(return_pct), 2) as avg_return
FROM trades_raw
WHERE outcome IS NOT NULL
GROUP BY wallet_address
ORDER BY total_pnl DESC
LIMIT 10
```

**Expected:** Top wallets show meaningful metrics

### 3. Category Performance Test
```sql
-- Join with markets to test category analysis
SELECT
  m.category,
  COUNT(t.trade_id) as trades,
  ROUND(AVG(t.pnl_net), 2) as avg_pnl,
  ROUND(SUM(t.pnl_net), 2) as total_pnl
FROM trades_raw t
JOIN markets m ON t.condition_id = m.condition_id
WHERE t.outcome IS NOT NULL
GROUP BY m.category
ORDER BY total_pnl DESC
```

**Expected:** Categories show distributed performance

## Monitoring

### Daily Health Check
```bash
# Add to cron (daily at 6 AM)
0 6 * * * cd /path/to/app && npx tsx scripts/verify-enrichment.ts >> /var/log/enrichment-health.log 2>&1
```

### Automated Enrichment
```bash
# Add to cron (daily at 2 AM)
0 2 * * * cd /path/to/app && npx tsx scripts/enrich-trades.ts >> /var/log/enrichment.log 2>&1
```

### Alert Conditions
Monitor for:
- Enrichment rate drops below 40%
- Verification errors appear
- Processing time exceeds 30 minutes
- Win rate goes outside 15-85% range

## Rollback Procedure

If enrichment causes issues:

### Option 1: Clear Enriched Data
```sql
-- Reset all enriched fields to defaults
ALTER TABLE trades_raw
UPDATE
  outcome = NULL,
  is_closed = false,
  close_price = 0.0,
  pnl_gross = 0.0,
  pnl_net = 0.0,
  fee_usd = 0.0,
  hours_held = 0.0,
  return_pct = 0.0
WHERE outcome IS NOT NULL
```

### Option 2: Restore from Backup
```bash
# If you backed up before enrichment
clickhouse-client --query "
  INSERT INTO trades_raw
  SELECT * FROM trades_raw_backup
"
```

## Troubleshooting

### Issue: Low enrichment rate
**Check:**
```sql
SELECT
  COUNT(*) as total,
  COUNTIF(condition_id = '') as missing_condition_id,
  COUNTIF(condition_id != '' AND outcome IS NULL) as need_enrichment
FROM trades_raw
```
**Fix:** If `missing_condition_id` is high, trades don't have condition_id. Re-sync trades.

### Issue: Verification errors
**Check:** Review error output from `verify-enrichment.ts`
**Fix:** Look for specific field mentioned in error, investigate sample trades

### Issue: Ambiguous resolutions
**Check:**
```sql
SELECT
  market_id,
  title,
  closed,
  current_price
FROM markets
WHERE closed = true
  AND current_price > 0.1
  AND current_price < 0.9
LIMIT 10
```
**Fix:** These markets need manual review. They may be invalid/cancelled markets.

### Issue: Performance slow
**Check:** ClickHouse server load
**Fix:** Reduce batch sizes in script:
```typescript
const BATCH_SIZE = 1000              // Reduce from 10000
const CLICKHOUSE_BATCH_SIZE = 500    // Reduce from 5000
```

## Success Criteria

✅ **Deployment Successful If:**
1. Test logic passes all 8 tests
2. Enrichment rate > 50%
3. No critical errors in verification
4. Win rate between 20-80%
5. Sample trades have correct P&L
6. Wallet metrics queries work
7. Category analysis queries work
8. No schema errors

## Next Steps After Deployment

1. **Enable wallet analytics:**
   ```bash
   npx tsx scripts/calculate-wallet-metrics.ts
   ```

2. **Calculate Omega scores:**
   ```bash
   npx tsx scripts/calculate-omega-scores.ts
   ```

3. **Set up automated enrichment** (cron job)

4. **Monitor enrichment health** (daily checks)

5. **Build dashboard queries** using enriched data

## Support

If you encounter issues:

1. Check verification output: `npx tsx scripts/verify-enrichment.ts`
2. Review logs: Check error messages in enrichment output
3. Test with small batch: `npx tsx scripts/enrich-trades.ts --limit 10`
4. Check sample data: Run SQL queries above
5. Review documentation: `TRADE_ENRICHMENT_PIPELINE.md`

## Checklist Summary

- [ ] Test logic passes (8/8 tests)
- [ ] ClickHouse schema has metric fields
- [ ] Trades exist in ClickHouse
- [ ] Resolved markets exist in Supabase
- [ ] Test run successful (--limit 100)
- [ ] Test verification passes
- [ ] Full enrichment run successful
- [ ] Final verification passes
- [ ] Data quality check passes
- [ ] Wallet metrics query works
- [ ] Category analysis query works
- [ ] Monitoring set up (optional)
- [ ] Automated enrichment scheduled (optional)

**Status:** Ready for production deployment ✅
