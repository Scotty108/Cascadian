#!/usr/bin/env npx tsx
/**
 * Export HC Cohort for Leaderboard (v1)
 *
 * Exports the validated HC cohort to a permanent table.
 * Uses tmp_flat_pnl_v4 from compute-hc-cohort-v4.ts
 *
 * Filters:
 * - HC (no transfers, no splits, 10+ trades)
 * - Flat inventory (no open positions)
 * - realized_pnl >= $500 (profitable wallets only - Omega > 1 proxy)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

async function main() {
  console.log('EXPORT HC COHORT FOR LEADERBOARD (v1)');
  console.log('='.repeat(80));

  // Check if source table exists
  const checkQ = await clickhouse.query({
    query: `SELECT count() as cnt FROM tmp_flat_pnl_v4`,
    format: 'JSONEachRow'
  });
  const sourceCount = Number((await checkQ.json() as any[])[0].cnt);
  console.log(`Source table tmp_flat_pnl_v4: ${sourceCount.toLocaleString()} wallets\n`);

  if (sourceCount === 0) {
    console.log('ERROR: Source table is empty. Run compute-hc-cohort-v4.ts first.');
    await clickhouse.close();
    return;
  }

  // Define cohort thresholds
  const PNL_MIN = 500;  // Minimum PnL to be in cohort (profitable wallets)

  console.log('Creating cohort with filters:');
  console.log(`  - HC: no transfers, no splits, 10+ trades`);
  console.log(`  - Flat inventory: all positions closed/redeemed`);
  console.log(`  - realized_pnl >= $${PNL_MIN} (profitable wallets only)`);
  console.log('');

  // Count cohort size
  const countQ = await clickhouse.query({
    query: `SELECT count() as cnt FROM tmp_flat_pnl_v4 WHERE realized_pnl >= ${PNL_MIN}`,
    format: 'JSONEachRow'
  });
  const cohortSize = Number((await countQ.json() as any[])[0].cnt);
  console.log(`Cohort size: ${cohortSize.toLocaleString()} wallets\n`);

  // Create permanent table
  console.log('Creating permanent table: pm_hc_leaderboard_cohort_v1');
  await clickhouse.command({
    query: `DROP TABLE IF EXISTS pm_hc_leaderboard_cohort_v1`
  });
  await clickhouse.command({
    query: `
      CREATE TABLE pm_hc_leaderboard_cohort_v1
      ENGINE = MergeTree()
      ORDER BY (realized_pnl, wallet)
      AS
      SELECT
        wallet,
        trade_count,
        net_cash,
        redemption_payout,
        realized_pnl,
        now() as export_time
      FROM tmp_flat_pnl_v4
      WHERE realized_pnl >= ${PNL_MIN}
    `
  });

  // Verify
  const verifyQ = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_hc_leaderboard_cohort_v1`,
    format: 'JSONEachRow'
  });
  const exportedCount = Number((await verifyQ.json() as any[])[0].cnt);
  console.log(`Exported: ${exportedCount.toLocaleString()} wallets\n`);

  // Show distribution
  const distQ = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        countIf(realized_pnl >= 500 AND realized_pnl < 1000) as pnl_500_1k,
        countIf(realized_pnl >= 1000 AND realized_pnl < 5000) as pnl_1k_5k,
        countIf(realized_pnl >= 5000 AND realized_pnl < 10000) as pnl_5k_10k,
        countIf(realized_pnl >= 10000 AND realized_pnl < 50000) as pnl_10k_50k,
        countIf(realized_pnl >= 50000 AND realized_pnl < 100000) as pnl_50k_100k,
        countIf(realized_pnl >= 100000) as pnl_100k_plus,
        round(avg(realized_pnl), 2) as avg_pnl,
        round(median(realized_pnl), 2) as median_pnl,
        round(max(realized_pnl), 2) as max_pnl
      FROM pm_hc_leaderboard_cohort_v1
    `,
    format: 'JSONEachRow'
  });
  const dist = (await distQ.json() as any[])[0];

  console.log('COHORT DISTRIBUTION:');
  console.log('-'.repeat(60));
  console.log(`  $500-$1,000:      ${Number(dist.pnl_500_1k).toLocaleString()}`);
  console.log(`  $1,000-$5,000:    ${Number(dist.pnl_1k_5k).toLocaleString()}`);
  console.log(`  $5,000-$10,000:   ${Number(dist.pnl_5k_10k).toLocaleString()}`);
  console.log(`  $10,000-$50,000:  ${Number(dist.pnl_10k_50k).toLocaleString()}`);
  console.log(`  $50,000-$100,000: ${Number(dist.pnl_50k_100k).toLocaleString()}`);
  console.log(`  $100,000+:        ${Number(dist.pnl_100k_plus).toLocaleString()}`);
  console.log('');
  console.log(`  Average PnL:  $${Number(dist.avg_pnl).toLocaleString()}`);
  console.log(`  Median PnL:   $${Number(dist.median_pnl).toLocaleString()}`);
  console.log(`  Max PnL:      $${Number(dist.max_pnl).toLocaleString()}`);

  // Show top 10
  console.log('\n' + '='.repeat(80));
  console.log('TOP 10 WALLETS IN COHORT:');
  console.log('-'.repeat(80));

  const topQ = await clickhouse.query({
    query: `
      SELECT wallet, trade_count, realized_pnl
      FROM pm_hc_leaderboard_cohort_v1
      ORDER BY realized_pnl DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const topWallets = await topQ.json() as any[];

  for (const w of topWallets) {
    console.log(`  ${w.wallet} | PnL: $${Number(w.realized_pnl).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} | Trades: ${w.trade_count}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('EXPORT COMPLETE');
  console.log('-'.repeat(80));
  console.log(`Table: pm_hc_leaderboard_cohort_v1`);
  console.log(`Wallets: ${exportedCount.toLocaleString()}`);
  console.log(`Filters: HC + flat_inventory + realized_pnl >= $${PNL_MIN}`);
  console.log('');
  console.log('Use this cohort for:');
  console.log('  - Leaderboard display');
  console.log('  - Playwright N=200 validation sampling');
  console.log('  - Smart money analysis');

  await clickhouse.close();
}

main().catch(console.error);
