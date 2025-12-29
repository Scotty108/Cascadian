#!/usr/bin/env npx tsx
/**
 * Build Full HC Leaderboard Cohort (ALL wallets meeting filters)
 *
 * Filters:
 * - HC (has_clob AND no_transfer_in AND no_split_merge)
 * - is_active_30d = true (traded in last 30 days)
 * - realized_pnl >= 500 (profitable wallets)
 * - omega > 1
 *
 * NO LIMIT - returns however many wallets meet the filters.
 * Rank column added for convenience (can filter to top N later).
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 600000,
});

async function main() {
  console.log('BUILD FULL HC LEADERBOARD COHORT');
  console.log('='.repeat(80));
  console.log('Filters:');
  console.log('  - HC (has_clob AND no_transfer_in AND no_split_merge)');
  console.log('  - is_active_30d = true (traded in last 30 days)');
  console.log('  - realized_pnl >= $500 (profitable)');
  console.log('  - omega > 1');
  console.log('  - NO LIMIT - all qualifying wallets included');
  console.log('');

  // Verify base tables exist
  const checkQ = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_wallet_realized_pnl_hc_v1`,
    format: 'JSONEachRow'
  });
  const baseCount = Number((await checkQ.json() as any[])[0].cnt);
  console.log(`Base table pm_wallet_realized_pnl_hc_v1: ${baseCount.toLocaleString()} wallets`);

  // Drop and recreate
  console.log('\nCreating pm_hc_leaderboard_cohort_all_v1...');
  await clickhouse.command({ query: `DROP TABLE IF EXISTS pm_hc_leaderboard_cohort_all_v1` });

  await clickhouse.command({
    query: `
      CREATE TABLE pm_hc_leaderboard_cohort_all_v1
      ENGINE = MergeTree()
      ORDER BY (rank, wallet)
      AS
      SELECT
        wallet,
        rn as rank,
        omega,
        realized_pnl,
        trade_count_total,
        trade_count_30d,
        last_trade_at,
        is_active_30d,
        realized_buy_usdc,
        realized_sell_usdc,
        redemption_payout,
        now() as created_at
      FROM (
        SELECT
          p.wallet as wallet,
          o.omega as omega,
          p.realized_pnl as realized_pnl,
          p.trade_count_total as trade_count_total,
          p.trade_count_30d as trade_count_30d,
          p.last_trade_at as last_trade_at,
          c.is_active_30d as is_active_30d,
          p.realized_buy_usdc as realized_buy_usdc,
          p.realized_sell_usdc as realized_sell_usdc,
          p.redemption_payout as redemption_payout,
          row_number() OVER (ORDER BY o.omega DESC, p.realized_pnl DESC) as rn
        FROM pm_wallet_realized_pnl_hc_v1 p
        JOIN pm_wallet_omega_hc_v1 o ON p.wallet = o.wallet
        JOIN pm_wallet_classification_v1 c ON p.wallet = c.wallet
        WHERE c.is_hc = 1
          AND c.is_active_30d = 1
          AND p.realized_pnl >= 500
          AND o.omega > 1
      )
    `
  });

  // Get total count
  const totalQ = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_hc_leaderboard_cohort_all_v1`,
    format: 'JSONEachRow'
  });
  const totalCount = Number((await totalQ.json() as any[])[0].cnt);

  console.log('\n' + '='.repeat(80));
  console.log('COHORT RESULTS');
  console.log('='.repeat(80));
  console.log(`\n  TOTAL WALLETS MEETING ALL FILTERS: ${totalCount.toLocaleString()}`);

  // Active 30d count (should be 100% since it's a filter)
  const activeQ = await clickhouse.query({
    query: `SELECT sum(toUInt8(is_active_30d)) as cnt FROM pm_hc_leaderboard_cohort_all_v1`,
    format: 'JSONEachRow'
  });
  const activeCount = Number((await activeQ.json() as any[])[0].cnt);
  console.log(`  Active (30d): ${activeCount.toLocaleString()} (${(activeCount/totalCount*100).toFixed(1)}%)`);

  // PnL distribution
  console.log('\n  PnL Distribution:');
  const pnlDistQ = await clickhouse.query({
    query: `
      SELECT
        countIf(realized_pnl >= 500 AND realized_pnl < 1000) as pnl_500_1k,
        countIf(realized_pnl >= 1000 AND realized_pnl < 5000) as pnl_1k_5k,
        countIf(realized_pnl >= 5000 AND realized_pnl < 10000) as pnl_5k_10k,
        countIf(realized_pnl >= 10000 AND realized_pnl < 50000) as pnl_10k_50k,
        countIf(realized_pnl >= 50000 AND realized_pnl < 100000) as pnl_50k_100k,
        countIf(realized_pnl >= 100000) as pnl_100k_plus,
        round(min(realized_pnl), 2) as min_pnl,
        round(avg(realized_pnl), 2) as avg_pnl,
        round(median(realized_pnl), 2) as median_pnl,
        round(max(realized_pnl), 2) as max_pnl
      FROM pm_hc_leaderboard_cohort_all_v1
    `,
    format: 'JSONEachRow'
  });
  const pnlDist = (await pnlDistQ.json() as any[])[0];

  console.log(`    $500-$1,000:      ${Number(pnlDist.pnl_500_1k).toLocaleString()}`);
  console.log(`    $1,000-$5,000:    ${Number(pnlDist.pnl_1k_5k).toLocaleString()}`);
  console.log(`    $5,000-$10,000:   ${Number(pnlDist.pnl_5k_10k).toLocaleString()}`);
  console.log(`    $10,000-$50,000:  ${Number(pnlDist.pnl_10k_50k).toLocaleString()}`);
  console.log(`    $50,000-$100,000: ${Number(pnlDist.pnl_50k_100k).toLocaleString()}`);
  console.log(`    $100,000+:        ${Number(pnlDist.pnl_100k_plus).toLocaleString()}`);
  console.log('');
  console.log(`    Min PnL:    $${Number(pnlDist.min_pnl).toLocaleString()}`);
  console.log(`    Avg PnL:    $${Number(pnlDist.avg_pnl).toLocaleString()}`);
  console.log(`    Median PnL: $${Number(pnlDist.median_pnl).toLocaleString()}`);
  console.log(`    Max PnL:    $${Number(pnlDist.max_pnl).toLocaleString()}`);

  // Omega summary
  console.log('\n  Omega Distribution:');
  const omegaQ = await clickhouse.query({
    query: `
      SELECT
        round(min(omega), 3) as min_omega,
        round(avg(omega), 3) as avg_omega,
        round(median(omega), 3) as median_omega,
        round(quantile(0.95)(omega), 3) as p95_omega,
        round(max(omega), 3) as max_omega,
        countIf(omega > 2) as omega_gt_2,
        countIf(omega > 5) as omega_gt_5,
        countIf(omega > 10) as omega_gt_10
      FROM pm_hc_leaderboard_cohort_all_v1
      WHERE omega < 1000000  -- Exclude extreme outliers for summary stats
    `,
    format: 'JSONEachRow'
  });
  const omegaDist = (await omegaQ.json() as any[])[0];

  console.log(`    Min Omega:    ${omegaDist.min_omega}`);
  console.log(`    Avg Omega:    ${omegaDist.avg_omega}`);
  console.log(`    Median Omega: ${omegaDist.median_omega}`);
  console.log(`    P95 Omega:    ${omegaDist.p95_omega}`);
  console.log(`    Max Omega:    ${omegaDist.max_omega} (capped at <1M for stats)`);
  console.log('');
  console.log(`    Omega > 2:  ${Number(omegaDist.omega_gt_2).toLocaleString()}`);
  console.log(`    Omega > 5:  ${Number(omegaDist.omega_gt_5).toLocaleString()}`);
  console.log(`    Omega > 10: ${Number(omegaDist.omega_gt_10).toLocaleString()}`);

  // Top 10 preview
  console.log('\n' + '='.repeat(80));
  console.log('TOP 10 PREVIEW (by Omega, then PnL):');
  console.log('-'.repeat(80));

  const topQ = await clickhouse.query({
    query: `
      SELECT wallet, rank, omega, realized_pnl, trade_count_total, trade_count_30d
      FROM pm_hc_leaderboard_cohort_all_v1
      ORDER BY rank
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const topWallets = await topQ.json() as any[];

  for (const w of topWallets) {
    const omegaStr = Number(w.omega) > 1000000 ? '>1M' : Number(w.omega).toFixed(2);
    console.log(`  #${w.rank} ${w.wallet.slice(0, 24)}... | Ω=${omegaStr.padStart(10)} | PnL=$${Number(w.realized_pnl).toLocaleString().padStart(12)} | Trades=${w.trade_count_total}`);
  }

  // Create view for top 20K convenience
  console.log('\n' + '='.repeat(80));
  console.log('Creating VIEW for top 20K (convenience):');
  await clickhouse.command({ query: `DROP VIEW IF EXISTS pm_hc_leaderboard_top20k_v1` });
  await clickhouse.command({
    query: `
      CREATE VIEW pm_hc_leaderboard_top20k_v1 AS
      SELECT * FROM pm_hc_leaderboard_cohort_all_v1 WHERE rank <= 20000
    `
  });
  console.log('  Created: pm_hc_leaderboard_top20k_v1');

  // Final summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`
  Table: pm_hc_leaderboard_cohort_all_v1

  Filters applied:
    - HC (CLOB only, no transfers in, no split/merge)
    - Active in last 30 days
    - Realized PnL >= $500
    - Omega > 1

  TOTAL QUALIFYING WALLETS: ${totalCount.toLocaleString()}

  Query examples:
    -- Get all wallets
    SELECT * FROM pm_hc_leaderboard_cohort_all_v1 ORDER BY rank;

    -- Get top 1000
    SELECT * FROM pm_hc_leaderboard_cohort_all_v1 WHERE rank <= 1000;

    -- Use the view for top 20K
    SELECT * FROM pm_hc_leaderboard_top20k_v1;
`);

  await clickhouse.close();
}

main().catch(console.error);
