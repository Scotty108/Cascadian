#!/usr/bin/env npx tsx
/**
 * Test Sample Wallets Coverage Analysis
 *
 * Tests the 11 sample wallets provided to determine:
 * - Which have good resolution coverage (>80% = leaderboard ready)
 * - Which are stuck in unresolved markets
 * - Whether the "problem" is data or expectations
 *
 * Run: npx tsx test-sample-wallets-coverage.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { clickhouse } from './lib/clickhouse/client';

config({ path: resolve(process.cwd(), '.env.local') });

const SAMPLE_WALLETS = [
  '0x4ce73141dbfce41e65db3723e31059a730f0abad', // $332,563
  '0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144', // $114,087
  '0x1f0a343513aa6060488fabe96960e6d1e177f7aa', // $101,576
  '0x06dcaa14f57d8a0573f5dc5940565e6de667af59', // $216,892
  '0xa9b44dca52ed35e59ac2a6f49d1203b8155464ed', // $211,748
  '0x8f42ae0a01c0383c7ca8bd060b86a645ee74b88f', // $163,277
  '0xe542afd3881c4c330ba0ebbb603bb470b2ba0a37', // $73,231
  '0x12d6cccfc7470a3f4bafc53599a4779cbf2cf2a8', // $150,023
  '0x7c156bb0dbb44dcb7387a78778e0da313bf3c9db', // $114,134
  '0xc02147dee42356b7a4edbb1c35ac4ffa95f61fa8', // $135,153
  '0x662244931c392df70bd064fa91f838eea0bfd7a9', // $131,523
];

async function analyzeWalletCoverage() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('SAMPLE WALLET COVERAGE ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Query 1: Basic coverage per wallet
  const coverageQuery = `
    SELECT
      wallet_id,
      COUNT(DISTINCT condition_id) as total_markets,
      COUNT(DISTINCT CASE
        WHEN payout_denominator > 0 THEN condition_id
      END) as resolved_markets,
      ROUND(resolved_markets / total_markets * 100, 2) as coverage_pct
    FROM (
      SELECT DISTINCT
        wallet_id,
        condition_id,
        0 as payout_denominator  -- placeholder, will be joined
      FROM fact_trades_clean
      WHERE wallet_id IN (${SAMPLE_WALLETS.map(w => `'${w}'`).join(',')})
    ) t
    LEFT JOIN (
      SELECT DISTINCT
        condition_id,
        payout_denominator
      FROM market_resolutions_final
      WHERE payout_denominator > 0
    ) r USING (condition_id)
    GROUP BY wallet_id
    ORDER BY coverage_pct DESC
  `;

  console.log('🔍 Analyzing wallet coverage...\n');
  const coverage = await clickhouse.query({ query: coverageQuery, format: 'JSONEachRow' });
  const coverageData = await coverage.json() as Array<{
    wallet_id: string;
    total_markets: string;
    resolved_markets: string;
    coverage_pct: string;
  }>;

  // Print results
  console.log('WALLET ADDRESS                             | MARKETS | RESOLVED | COVERAGE | STATUS');
  console.log('-------------------------------------------|---------|----------|----------|------------------');

  let leaderboardReady = 0;
  let needsWork = 0;

  for (const row of coverageData) {
    const pct = parseFloat(row.coverage_pct);
    const status = pct >= 80 ? '✅ READY' : pct >= 50 ? '⚠️  PARTIAL' : '❌ BLOCKED';

    if (pct >= 80) leaderboardReady++;
    else needsWork++;

    console.log(
      `${row.wallet_id} | ${row.total_markets.padStart(7)} | ${row.resolved_markets.padStart(8)} | ${row.coverage_pct.padStart(7)}% | ${status}`
    );
  }

  console.log('\n═══════════════════════════════════════════════════════════\n');
  console.log(`✅ Leaderboard Ready (≥80%): ${leaderboardReady} wallets`);
  console.log(`⚠️  Needs Work (50-80%):      ${needsWork} wallets`);
  console.log(`❌ Blocked (<50%):            ${coverageData.length - leaderboardReady - needsWork} wallets\n`);

  // Query 2: Detailed analysis for blocked wallets
  const blockedWallets = coverageData
    .filter(w => parseFloat(w.coverage_pct) < 50)
    .map(w => w.wallet_id);

  if (blockedWallets.length > 0) {
    console.log('🔬 DEEP DIVE: Blocked Wallets\n');

    for (const wallet of blockedWallets) {
      const detailQuery = `
        SELECT
          COUNT(*) as total_trades,
          COUNT(DISTINCT condition_id) as unique_markets,
          MIN(block_timestamp) as first_trade,
          MAX(block_timestamp) as last_trade,
          SUM(CASE WHEN direction = 'BUY' THEN usdc_amount ELSE 0 END) as total_bought,
          SUM(CASE WHEN direction = 'SELL' THEN usdc_amount ELSE 0 END) as total_sold
        FROM fact_trades_clean
        WHERE wallet_id = '${wallet}'
      `;

      const detail = await clickhouse.query({ query: detailQuery, format: 'JSONEachRow' });
      const detailData = await detail.json() as Array<any>;
      const d = detailData[0];

      console.log(`Wallet: ${wallet}`);
      console.log(`  Total Trades:    ${d.total_trades}`);
      console.log(`  Unique Markets:  ${d.unique_markets}`);
      console.log(`  Trading Period:  ${d.first_trade} to ${d.last_trade}`);
      console.log(`  Volume Bought:   $${parseFloat(d.total_bought).toLocaleString()}`);
      console.log(`  Volume Sold:     $${parseFloat(d.total_sold).toLocaleString()}`);
      console.log('');
    }
  }

  // Query 3: Overall system stats
  console.log('═══════════════════════════════════════════════════════════');
  console.log('OVERALL SYSTEM STATISTICS\n');

  const systemQuery = `
    SELECT
      COUNT(DISTINCT condition_id) as total_markets_in_trades,
      COUNT(DISTINCT CASE
        WHEN r.payout_denominator > 0 THEN t.condition_id
      END) as resolved_in_trades,
      ROUND(resolved_in_trades / total_markets_in_trades * 100, 2) as system_coverage
    FROM (
      SELECT DISTINCT condition_id
      FROM fact_trades_clean
    ) t
    LEFT JOIN (
      SELECT DISTINCT condition_id, payout_denominator
      FROM market_resolutions_final
      WHERE payout_denominator > 0
    ) r USING (condition_id)
  `;

  const systemStats = await clickhouse.query({ query: systemQuery, format: 'JSONEachRow' });
  const systemData = await systemStats.json() as Array<any>;
  const sys = systemData[0];

  console.log(`Total Markets Traded:        ${parseInt(sys.total_markets_in_trades).toLocaleString()}`);
  console.log(`Markets with Resolutions:    ${parseInt(sys.resolved_in_trades).toLocaleString()}`);
  console.log(`System Coverage:             ${sys.system_coverage}%`);

  console.log('\n═══════════════════════════════════════════════════════════\n');

  // Final recommendations
  console.log('📋 RECOMMENDATIONS\n');

  if (leaderboardReady > 0) {
    console.log(`✅ SHIP LEADERBOARDS NOW with ${leaderboardReady} wallet${leaderboardReady > 1 ? 's' : ''}`);
    console.log('   - Filter to wallets with ≥80% coverage');
    console.log('   - Add "Pending Resolution" labels for others\n');
  }

  if (needsWork > 0 || (coverageData.length - leaderboardReady - needsWork) > 0) {
    console.log(`⚠️  FOR ${needsWork + (coverageData.length - leaderboardReady - needsWork)} REMAINING WALLETS:`);
    console.log('   1. Integrate PNL Subgraph (2-4 hours) for additional payouts');
    console.log('   2. Deploy redemption detection (15-30 min) for +1,443 markets');
    console.log('   3. Build unrealized P&L views (4 hours) to show mark-to-market\n');
  }

  console.log('📊 NEXT STEPS:');
  console.log('   1. Review BREAKTHROUGH_INVESTIGATION_COMPLETE.md');
  console.log('   2. Run: npx tsx scripts/backfill-payout-vectors.ts');
  console.log('   3. Deploy redemption SQL views');
  console.log('   4. Re-run this script to see improvement\n');

  console.log('═══════════════════════════════════════════════════════════\n');
}

analyzeWalletCoverage()
  .then(() => {
    console.log('✅ Analysis complete!');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
