#!/usr/bin/env npx tsx
/**
 * Reconcile Cohort Table with Profit-Based PnL
 *
 * Updates pm_hc_leaderboard_cohort_all_v1.realized_pnl to use
 * the correct profit-based values from pm_wallet_realized_profit_hc_v1.
 *
 * Steps:
 * 1. Create v2 as copy of v1 schema/data
 * 2. Update v2.realized_pnl from profit table
 * 3. Verify counts and no NULL joins
 * 4. Print before/after deltas
 * 5. Atomic swap (v1 -> backup, v2 -> v1)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';

const COHORT_TABLE_V1 = 'pm_hc_leaderboard_cohort_all_v1';
const COHORT_TABLE_V2 = 'pm_hc_leaderboard_cohort_all_v2';
const PROFIT_TABLE = 'pm_wallet_realized_profit_hc_v1';
const EXPECTED_WALLET_COUNT = 24514;

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 120000,
});

async function main() {
  console.log('RECONCILE COHORT TABLE WITH PROFIT-BASED PNL');
  console.log('='.repeat(80));
  console.log(`Source cohort:  ${COHORT_TABLE_V1}`);
  console.log(`Profit table:   ${PROFIT_TABLE}`);
  console.log(`Output:         ${COHORT_TABLE_V2}`);
  console.log('');

  const startTime = Date.now();

  // =========================================================================
  // STEP 1: Verify source tables exist and have expected counts
  // =========================================================================
  console.log('Step 1: Verifying source tables...');

  const v1CountQ = await clickhouse.query({
    query: `SELECT count() as cnt FROM ${COHORT_TABLE_V1}`,
    format: 'JSONEachRow'
  });
  const v1Count = Number((await v1CountQ.json() as any[])[0].cnt);

  const profitCountQ = await clickhouse.query({
    query: `SELECT count() as cnt FROM ${PROFIT_TABLE}`,
    format: 'JSONEachRow'
  });
  const profitCount = Number((await profitCountQ.json() as any[])[0].cnt);

  console.log(`  Cohort v1: ${v1Count} wallets`);
  console.log(`  Profit table: ${profitCount} wallets`);

  if (v1Count !== EXPECTED_WALLET_COUNT) {
    console.error(`FATAL: Expected ${EXPECTED_WALLET_COUNT} wallets in cohort, got ${v1Count}`);
    process.exit(1);
  }
  if (profitCount !== EXPECTED_WALLET_COUNT) {
    console.error(`FATAL: Expected ${EXPECTED_WALLET_COUNT} wallets in profit table, got ${profitCount}`);
    process.exit(1);
  }

  // =========================================================================
  // STEP 2: Capture before stats
  // =========================================================================
  console.log('\nStep 2: Capturing before stats...');

  const beforeStatsQ = await clickhouse.query({
    query: `
      SELECT
        round(sum(realized_pnl), 2) as total,
        round(avg(realized_pnl), 2) as avg,
        round(median(realized_pnl), 2) as median,
        round(quantile(0.50)(realized_pnl), 2) as p50,
        round(quantile(0.90)(realized_pnl), 2) as p90,
        round(quantile(0.99)(realized_pnl), 2) as p99,
        round(min(realized_pnl), 2) as min,
        round(max(realized_pnl), 2) as max
      FROM ${COHORT_TABLE_V1}
    `,
    format: 'JSONEachRow'
  });
  const beforeStats = (await beforeStatsQ.json() as any[])[0];
  console.log('  BEFORE (net-cash based):');
  console.log(`    Total:  $${Number(beforeStats.total).toLocaleString()}`);
  console.log(`    Avg:    $${beforeStats.avg}`);
  console.log(`    Median: $${beforeStats.median}`);
  console.log(`    p50:    $${beforeStats.p50}`);
  console.log(`    p90:    $${beforeStats.p90}`);
  console.log(`    p99:    $${beforeStats.p99}`);

  // =========================================================================
  // STEP 3: Create v2 with updated realized_pnl
  // =========================================================================
  console.log('\nStep 3: Creating v2 with profit-based realized_pnl...');

  await clickhouse.command({ query: `DROP TABLE IF EXISTS ${COHORT_TABLE_V2}` });

  // Create v2 by joining v1 with profit table
  await clickhouse.command({
    query: `
      CREATE TABLE ${COHORT_TABLE_V2}
      ENGINE = MergeTree()
      ORDER BY (wallet)
      AS
      SELECT
        c.wallet,
        c.rank,
        c.omega,
        p.realized_profit_usd as realized_pnl,
        c.trade_count_total,
        c.trade_count_30d,
        c.last_trade_at,
        c.is_active_30d,
        c.realized_buy_usdc,
        c.realized_sell_usdc,
        c.redemption_payout,
        c.created_at
      FROM ${COHORT_TABLE_V1} c
      INNER JOIN ${PROFIT_TABLE} p ON c.wallet = p.wallet
    `
  });

  // =========================================================================
  // STEP 4: Verify v2 counts and no NULL joins
  // =========================================================================
  console.log('\nStep 4: Verifying v2...');

  const v2CountQ = await clickhouse.query({
    query: `SELECT count() as cnt, countIf(isNull(realized_pnl)) as nulls FROM ${COHORT_TABLE_V2}`,
    format: 'JSONEachRow'
  });
  const v2Result = (await v2CountQ.json() as any[])[0];
  const v2Count = Number(v2Result.cnt);
  const v2Nulls = Number(v2Result.nulls);

  console.log(`  v2 wallet count: ${v2Count}`);
  console.log(`  v2 NULL realized_pnl: ${v2Nulls}`);

  if (v2Count !== EXPECTED_WALLET_COUNT) {
    console.error(`FATAL: v2 has ${v2Count} wallets, expected ${EXPECTED_WALLET_COUNT}`);
    console.error('  This means JOIN failed for some wallets. Aborting.');
    process.exit(1);
  }
  if (v2Nulls > 0) {
    console.error(`FATAL: v2 has ${v2Nulls} NULL realized_pnl values. Aborting.`);
    process.exit(1);
  }
  console.log('  All checks passed');

  // =========================================================================
  // STEP 5: Capture after stats and compute deltas
  // =========================================================================
  console.log('\nStep 5: Computing before/after deltas...');

  const afterStatsQ = await clickhouse.query({
    query: `
      SELECT
        round(sum(realized_pnl), 2) as total,
        round(avg(realized_pnl), 2) as avg,
        round(median(realized_pnl), 2) as median,
        round(quantile(0.50)(realized_pnl), 2) as p50,
        round(quantile(0.90)(realized_pnl), 2) as p90,
        round(quantile(0.99)(realized_pnl), 2) as p99,
        round(min(realized_pnl), 2) as min,
        round(max(realized_pnl), 2) as max
      FROM ${COHORT_TABLE_V2}
    `,
    format: 'JSONEachRow'
  });
  const afterStats = (await afterStatsQ.json() as any[])[0];

  console.log('  AFTER (profit-based):');
  console.log(`    Total:  $${Number(afterStats.total).toLocaleString()}`);
  console.log(`    Avg:    $${afterStats.avg}`);
  console.log(`    Median: $${afterStats.median}`);
  console.log(`    p50:    $${afterStats.p50}`);
  console.log(`    p90:    $${afterStats.p90}`);
  console.log(`    p99:    $${afterStats.p99}`);

  console.log('\n  DELTA (new - old):');
  console.log(`    Total:  $${(Number(afterStats.total) - Number(beforeStats.total)).toLocaleString()}`);
  console.log(`    Avg:    $${(Number(afterStats.avg) - Number(beforeStats.avg)).toFixed(2)}`);
  console.log(`    Median: $${(Number(afterStats.median) - Number(beforeStats.median)).toFixed(2)}`);

  // =========================================================================
  // STEP 6: Show top 20 wallets by absolute delta
  // =========================================================================
  console.log('\nStep 6: Top 20 wallets by absolute delta...');

  const topDeltaQ = await clickhouse.query({
    query: `
      SELECT
        c.wallet,
        round(c.realized_pnl, 2) as old_pnl,
        round(p.realized_profit_usd, 2) as new_pnl,
        round(p.realized_profit_usd - c.realized_pnl, 2) as delta,
        round(abs(p.realized_profit_usd - c.realized_pnl), 2) as abs_delta
      FROM ${COHORT_TABLE_V1} c
      JOIN ${PROFIT_TABLE} p ON c.wallet = p.wallet
      ORDER BY abs_delta DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });
  const topDeltas = await topDeltaQ.json() as any[];

  console.log('  ' + '-'.repeat(90));
  console.log('  wallet                                     | old_pnl       | new_pnl       | delta');
  console.log('  ' + '-'.repeat(90));
  for (const row of topDeltas) {
    const w = row.wallet.slice(0, 42).padEnd(42);
    const old_pnl = Number(row.old_pnl).toLocaleString().padStart(12);
    const new_pnl = Number(row.new_pnl).toLocaleString().padStart(12);
    const delta = Number(row.delta).toLocaleString().padStart(12);
    console.log(`  ${w} | ${old_pnl} | ${new_pnl} | ${delta}`);
  }
  console.log('  ' + '-'.repeat(90));

  // =========================================================================
  // STEP 7: Atomic swap
  // =========================================================================
  console.log('\nStep 7: Performing atomic swap...');

  const now = new Date();
  const backupSuffix = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  const backupTable = `${COHORT_TABLE_V1}_backup_${backupSuffix}`;

  console.log(`  Renaming ${COHORT_TABLE_V1} -> ${backupTable}`);
  await clickhouse.command({ query: `RENAME TABLE ${COHORT_TABLE_V1} TO ${backupTable}` });

  console.log(`  Renaming ${COHORT_TABLE_V2} -> ${COHORT_TABLE_V1}`);
  await clickhouse.command({ query: `RENAME TABLE ${COHORT_TABLE_V2} TO ${COHORT_TABLE_V1}` });

  console.log('  Swap complete!');

  // =========================================================================
  // FINAL SUMMARY
  // =========================================================================
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n' + '='.repeat(80));
  console.log('RECONCILIATION COMPLETE');
  console.log('='.repeat(80));
  console.log(`Cohort table: ${COHORT_TABLE_V1} (updated)`);
  console.log(`Backup table: ${backupTable}`);
  console.log(`Wallet count: ${v2Count}`);
  console.log(`Elapsed: ${elapsed}s`);
  console.log('');
  console.log('SUMMARY STATS:');
  console.log('  Metric      | Before (net-cash) | After (profit) | Delta');
  console.log('  ' + '-'.repeat(65));
  console.log(`  Total       | $${Number(beforeStats.total).toLocaleString().padStart(15)} | $${Number(afterStats.total).toLocaleString().padStart(13)} | $${(Number(afterStats.total) - Number(beforeStats.total)).toLocaleString()}`);
  console.log(`  Avg         | $${String(beforeStats.avg).padStart(15)} | $${String(afterStats.avg).padStart(13)} | $${(Number(afterStats.avg) - Number(beforeStats.avg)).toFixed(2)}`);
  console.log(`  Median      | $${String(beforeStats.median).padStart(15)} | $${String(afterStats.median).padStart(13)} | $${(Number(afterStats.median) - Number(beforeStats.median)).toFixed(2)}`);
  console.log(`  p90         | $${String(beforeStats.p90).padStart(15)} | $${String(afterStats.p90).padStart(13)} | $${(Number(afterStats.p90) - Number(beforeStats.p90)).toFixed(2)}`);
  console.log(`  p99         | $${String(beforeStats.p99).padStart(15)} | $${String(afterStats.p99).padStart(13)} | $${(Number(afterStats.p99) - Number(beforeStats.p99)).toFixed(2)}`);
  console.log('');

  await clickhouse.close();
}

main().catch(console.error);
