#!/usr/bin/env npx tsx
/**
 * CHECK: Does the role='maker' filter gap affect our Dome validation wallets?
 *
 * If the same wallets that fail Dome validation ALSO have large taker event gaps,
 * then the root cause is the same: missing CLOB events in unified ledger.
 *
 * Terminal: Claude 2
 * Date: 2025-12-07
 */

import { createClient } from '@clickhouse/client';
import fs from 'fs';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 60000,
});

async function main() {
  console.log('');
  console.log('='.repeat(80));
  console.log('CHECKING: Do Dome mismatch wallets have the same role filter gap?');
  console.log('='.repeat(80));

  // Load the Dome mismatch classification
  const classFile = 'tmp/dome_mismatch_classification.json';
  if (!fs.existsSync(classFile)) {
    console.error('Run classify-dome-mismatches.ts first');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(classFile, 'utf-8'));
  const classifications = data.classifications;

  // Get the failing wallets
  const failing = classifications.filter((c: any) => c.category !== 'PASS');
  console.log(`\nAnalyzing ${failing.length} failing wallets...\n`);

  interface GapAnalysis {
    wallet: string;
    category: string;
    delta: number;
    unifiedClobCount: number;
    traderEventsCount: number;
    makerCount: number;
    takerCount: number;
    gapPercent: number;
    takerPercent: number;
  }

  const results: GapAnalysis[] = [];

  for (const c of failing.slice(0, 10)) { // Check first 10 failing wallets
    const wallet = c.wallet;
    console.log(`Checking ${wallet.slice(0, 15)}...`);

    try {
      // Get unified ledger CLOB count
      const unifiedResult = await clickhouse.query({
        query: `
          SELECT countDistinct(event_id) as cnt
          FROM pm_unified_ledger_v8_tbl
          WHERE wallet_address = '${wallet}'
            AND source_type = 'CLOB'
        `,
        format: 'JSONEachRow',
      });
      const unifiedData = await unifiedResult.json<{ cnt: string }[]>();
      const unifiedCount = parseInt(unifiedData[0]?.cnt || '0');

      // Get trader_events breakdown by role
      const roleResult = await clickhouse.query({
        query: `
          SELECT
            role,
            countDistinct(event_id) as cnt
          FROM pm_trader_events_v2
          WHERE trader_wallet = '${wallet}'
            AND is_deleted = 0
          GROUP BY role
        `,
        format: 'JSONEachRow',
      });
      const roleData = await roleResult.json<{ role: string; cnt: string }[]>();

      let makerCount = 0;
      let takerCount = 0;
      for (const row of roleData) {
        if (row.role === 'maker') makerCount = parseInt(row.cnt);
        if (row.role === 'taker') takerCount = parseInt(row.cnt);
      }
      const traderTotal = makerCount + takerCount;

      const gapPercent = unifiedCount > 0
        ? ((traderTotal - unifiedCount) / unifiedCount) * 100
        : (traderTotal > 0 ? 9999 : 0);

      const takerPercent = traderTotal > 0 ? (takerCount / traderTotal) * 100 : 0;

      results.push({
        wallet,
        category: c.category,
        delta: c.delta,
        unifiedClobCount: unifiedCount,
        traderEventsCount: traderTotal,
        makerCount,
        takerCount,
        gapPercent,
        takerPercent,
      });
    } catch (err: any) {
      console.log(`  Error: ${err.message}`);
    }
  }

  await clickhouse.close();

  // Print results
  console.log('\n');
  console.log('='.repeat(120));
  console.log('DOME FAILING WALLETS - EVENT COVERAGE ANALYSIS');
  console.log('='.repeat(120));
  console.log('');
  console.log('Wallet           | Category                | Dome Delta | Unified | Maker  | Taker  | Gap %  | Taker %');
  console.log('-'.repeat(120));

  for (const r of results) {
    console.log(
      `${r.wallet.slice(0, 15)}... | ${r.category.padEnd(22)} | ${('$' + r.delta.toFixed(0)).padStart(10)} | ${r.unifiedClobCount.toString().padStart(7)} | ${r.makerCount.toString().padStart(6)} | ${r.takerCount.toString().padStart(6)} | ${r.gapPercent.toFixed(0).padStart(5)}% | ${r.takerPercent.toFixed(0).padStart(6)}%`
    );
  }

  // Correlation analysis
  console.log('\n');
  console.log('='.repeat(80));
  console.log('CORRELATION ANALYSIS');
  console.log('='.repeat(80));

  const highGap = results.filter(r => r.gapPercent > 50);
  const lowGap = results.filter(r => r.gapPercent <= 50);

  console.log(`\nWallets with >50% event gap: ${highGap.length}/${results.length} (${(highGap.length/results.length*100).toFixed(0)}%)`);
  console.log(`Wallets with <=50% event gap: ${lowGap.length}/${results.length}`);

  if (highGap.length > 0) {
    const avgHighGapDelta = highGap.reduce((s, r) => s + Math.abs(r.delta), 0) / highGap.length;
    console.log(`\nAvg absolute Dome delta (high gap wallets): $${avgHighGapDelta.toFixed(0)}`);
  }
  if (lowGap.length > 0) {
    const avgLowGapDelta = lowGap.reduce((s, r) => s + Math.abs(r.delta), 0) / lowGap.length;
    console.log(`Avg absolute Dome delta (low gap wallets): $${avgLowGapDelta.toFixed(0)}`);
  }

  // Key insight
  const takerHeavy = results.filter(r => r.takerPercent > 60);
  console.log(`\nWallets where >60% of events are TAKER: ${takerHeavy.length}/${results.length}`);

  if (takerHeavy.length > 0) {
    console.log('\nThese wallets would be most affected by the role=maker filter:');
    for (const r of takerHeavy) {
      console.log(`  ${r.wallet.slice(0, 15)}... - ${r.takerPercent.toFixed(0)}% taker, missing ~${r.takerCount} events`);
    }
  }

  // Conclusion
  console.log('\n');
  console.log('='.repeat(80));
  console.log('CONCLUSION');
  console.log('='.repeat(80));

  const sameRootCause = highGap.length >= results.length * 0.5;
  if (sameRootCause) {
    console.log('\n✅ YES - The SAME data gap (role=maker filter) is likely affecting Dome validation!');
    console.log(`   ${(highGap.length/results.length*100).toFixed(0)}% of failing wallets have >50% event coverage gap.`);
    console.log('\n   FIX: Re-materialize unified ledger WITHOUT role=maker filter.');
    console.log('   This should improve BOTH Dome and UI validation accuracy.');
  } else {
    console.log('\n❌ NO - The Dome mismatches have a different root cause than the UI validation gaps.');
    console.log(`   Only ${(highGap.length/results.length*100).toFixed(0)}% of failing wallets have event coverage gaps.`);
  }

  // Save results
  fs.writeFileSync('tmp/dome_role_filter_analysis.json', JSON.stringify(results, null, 2));
  console.log('\n\nResults saved to: tmp/dome_role_filter_analysis.json');
}

main().catch(console.error);
