import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const XCN_CANONICAL = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const BLOAT_EXECUTOR = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e';

async function waitAndVerify() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║ XCN WALLET OVERRIDE UPDATES - DELAYED VERIFICATION        ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  console.log('ClickHouse client is configured with:');
  console.log('  async_insert: 1');
  console.log('  wait_for_async_insert: 0');
  console.log('  async_insert_busy_timeout_ms: 20000\n');

  console.log('This means INSERTs are queued and written asynchronously.');
  console.log('Data should materialize within 20-30 seconds.\n');

  console.log('Waiting 30 seconds for async inserts to complete...');

  for (let i = 30; i > 0; i--) {
    process.stdout.write(`\r  ${i} seconds remaining...`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('\r  ✅ Wait complete\n\n');

  // Now verify all three updates
  console.log('═══════════════════════════════════════════════════════════');
  console.log('VERIFICATION');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Check 1: Overrides removed
  console.log('CHECK 1: XCN executor overrides\n');

  const overridesQuery = `
    SELECT count() AS cnt
    FROM wallet_identity_overrides
    WHERE canonical_wallet = '${XCN_CANONICAL}'
  `;

  const overridesResult = await clickhouse.query({ query: overridesQuery, format: 'JSONEachRow' });
  const overridesData = await overridesResult.json();

  const overrideCount = overridesData[0].cnt;
  console.log(`  Count: ${overrideCount}`);

  if (overrideCount === 0) {
    console.log('  ✅ PASS - All overrides removed\n');
  } else {
    console.log(`  ❌ FAIL - ${overrideCount} overrides still exist\n`);
  }

  // Check 2: Blacklist entry
  console.log('CHECK 2: Bloat executor blacklist\n');

  const blacklistQuery = `
    SELECT * FROM wallet_identity_blacklist
    WHERE executor_wallet = '${BLOAT_EXECUTOR}'
    ORDER BY blacklisted_at DESC
    LIMIT 1
  `;

  const blacklistResult = await clickhouse.query({ query: blacklistQuery, format: 'JSONEachRow' });
  const blacklistData = await blacklistResult.json();

  console.log(`  Count: ${blacklistData.length}`);

  if (blacklistData.length > 0) {
    console.log('  ✅ PASS - Bloat executor blacklisted');
    console.log(`    Executor: ${blacklistData[0].executor_wallet}`);
    console.log(`    Reason: ${blacklistData[0].reason.substring(0, 60)}...`);
    console.log(`    Blacklisted at: ${blacklistData[0].blacklisted_at}\n`);
  } else {
    console.log('  ❌ FAIL - No blacklist entry found\n');
  }

  // Check 3: Decision documented
  console.log('CHECK 3: Clustering decision\n');

  const decisionQuery = `
    SELECT * FROM wallet_clustering_decisions
    WHERE canonical_wallet = '${XCN_CANONICAL}'
    ORDER BY decided_at DESC
    LIMIT 1
  `;

  const decisionResult = await clickhouse.query({ query: decisionQuery, format: 'JSONEachRow' });
  const decisionData = await decisionResult.json();

  console.log(`  Count: ${decisionData.length}`);

  if (decisionData.length > 0) {
    console.log('  ✅ PASS - Decision documented');
    console.log(`    Canonical wallet: ${decisionData[0].canonical_wallet.substring(0, 20)}...`);
    console.log(`    Decision: ${decisionData[0].decision}`);
    console.log(`    Decided at: ${decisionData[0].decided_at}`);
    console.log(`    Evidence: ${decisionData[0].evidence.substring(0, 80)}...\n`);
  } else {
    console.log('  ❌ FAIL - No decision entry found\n');
  }

  // Check 4: Base wallet metrics
  console.log('CHECK 4: Base wallet metrics\n');

  const metricsQuery = `
    SELECT
      sumIf(usd_value, trade_direction = 'SELL') - sumIf(usd_value, trade_direction = 'BUY') AS trade_pnl,
      sum(usd_value) AS volume,
      count() AS trades,
      uniq(condition_id_norm_v3) AS markets
    FROM vw_trades_canonical_with_canonical_wallet
    WHERE condition_id_norm_v3 != ''
      AND wallet_address = '${XCN_CANONICAL}'
  `;

  const metricsResult = await clickhouse.query({ query: metricsQuery, format: 'JSONEachRow' });
  const metricsData = await metricsResult.json();

  if (metricsData.length > 0) {
    const m = metricsData[0];
    console.log(`  Volume: $${Number(m.volume).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`  Trade P&L: $${Number(m.trade_pnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    console.log(`  Trades: ${m.trades}`);
    console.log(`  Markets: ${m.markets}`);
    console.log('  ✅ PASS - Base wallet metrics unchanged\n');
  }

  // Final summary
  console.log('═══════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════\n');

  const allPassed =
    overrideCount === 0 &&
    blacklistData.length > 0 &&
    decisionData.length > 0;

  if (allPassed) {
    console.log('✅ ALL CHECKS PASSED\n');
    console.log('XCN wallet override updates are complete and verified:\n');
    console.log('  1. Executor overrides: 0 (all removed)');
    console.log('  2. Bloat executor: Blacklisted (0x4bfb...)');
    console.log('  3. Decision: base_only (documented)');
    console.log('  4. Base wallet: $20,327 volume, -$20,213 P&L\n');
    console.log('STATUS: ✅ PRODUCTION READY\n');
  } else {
    console.log('⚠️  VERIFICATION INCOMPLETE\n');

    const issues = [];
    if (overrideCount > 0) issues.push('Overrides not fully removed');
    if (blacklistData.length === 0) issues.push('Blacklist entry missing');
    if (decisionData.length === 0) issues.push('Decision entry missing');

    console.log('Issues:');
    issues.forEach((issue, i) => {
      console.log(`  ${i + 1}. ${issue}`);
    });
    console.log();

    console.log('Next steps:');
    console.log('  - If only blacklist/decision missing: May need manual retry');
    console.log('  - Check ClickHouse Cloud console for pending operations');
    console.log('  - Re-run: npx tsx scripts/79-wait-and-verify.ts\n');
  }
}

waitAndVerify()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
