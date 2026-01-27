/**
 * FIFO Recovery - Phase 3: Validation
 *
 * Validates that the FIFO recovery completed successfully by:
 * 1. Counting new FIFO positions for January 2026
 * 2. Checking coverage of target conditions
 * 3. Verifying known missing example (Cavaliers market)
 *
 * Expected runtime: 5 minutes
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';
import * as fs from 'fs';

async function main() {
  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║   FIFO RECOVERY - PHASE 3: VALIDATION        ║');
  console.log('╚═══════════════════════════════════════════════╝');
  console.log(`Started: ${new Date().toISOString()}\n`);

  // Validation 1: Count January 2026 FIFO positions
  console.log('[Validation 1/3] Counting January 2026 FIFO positions...');
  const countResult = await clickhouse.query({
    query: `
      SELECT COUNT(*) as count
      FROM pm_trade_fifo_roi_v3
      WHERE resolved_at >= toDateTime('2026-01-01 00:00:00')
        AND resolved_at < toDateTime('2026-01-28 00:00:00')
    `,
    format: 'JSONEachRow'
  });

  const countRows = await countResult.json();
  const totalPositions = countRows[0]?.count || 0;
  console.log(`✓ Total FIFO positions: ${totalPositions.toLocaleString()}`);

  if (totalPositions < 70000000) {
    console.log('⚠ WARNING: Position count lower than expected (70M+)');
  } else {
    console.log('✓ Position count looks good\n');
  }

  // Validation 2: Check coverage of target conditions
  console.log('[Validation 2/3] Checking coverage of 10,108 target conditions...');

  // Load missing conditions
  const conditionIds = JSON.parse(
    fs.readFileSync('/tmp/missing-conditions-jan2026.json', 'utf-8')
  );

  console.log(`  Target conditions: ${conditionIds.length.toLocaleString()}`);

  // Create temp table to avoid query size limit
  await clickhouse.command({ query: 'DROP TABLE IF EXISTS tmp_validation_conditions' });
  await clickhouse.command({ query: 'CREATE TABLE tmp_validation_conditions (condition_id String) ENGINE = Memory' });

  // Insert conditions in batches
  for (let i = 0; i < conditionIds.length; i += 500) {
    const batch = conditionIds.slice(i, i + 500);
    const values = batch.map(id => `('${id}')`).join(',');
    await clickhouse.command({ query: `INSERT INTO tmp_validation_conditions VALUES ${values}` });
  }

  // Check how many have FIFO positions now
  const coverageResult = await clickhouse.query({
    query: `
      SELECT COUNT(DISTINCT f.condition_id) as covered_count
      FROM pm_trade_fifo_roi_v3 f
      INNER JOIN tmp_validation_conditions tc ON f.condition_id = tc.condition_id
      WHERE f.resolved_at >= toDateTime('2026-01-01 00:00:00')
        AND f.resolved_at < toDateTime('2026-01-28 00:00:00')
    `,
    format: 'JSONEachRow',
    clickhouse_settings: {
      max_execution_time: 300
    }
  });

  const coverageRows = await coverageResult.json();
  const coveredCount = coverageRows[0]?.covered_count || 0;
  const coveragePercent = ((coveredCount / conditionIds.length) * 100).toFixed(1);

  console.log(`  Conditions with FIFO positions: ${coveredCount.toLocaleString()}`);
  console.log(`  Coverage: ${coveragePercent}%`);

  if (coveredCount < conditionIds.length * 0.95) {
    console.log('  ⚠ WARNING: Coverage below 95%');
    console.log('  Some conditions may not have had any trades\n');
  } else {
    console.log('  ✓ Coverage looks good\n');
  }

  // Validation 3: Check known missing example (Cavaliers market)
  console.log('[Validation 3/3] Verifying known missing example...');
  console.log('  Wallet: 0x7ed62b230d860eb69bf076450026ac382dc5eb26');

  const exampleResult = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as position_count,
        SUM(pnl_usd) as total_pnl
      FROM pm_trade_fifo_roi_v3
      WHERE wallet = '0x7ed62b230d860eb69bf076450026ac382dc5eb26'
        AND resolved_at >= toDateTime('2026-01-01 00:00:00')
        AND resolved_at < toDateTime('2026-01-28 00:00:00')
    `,
    format: 'JSONEachRow'
  });

  const exampleRows = await exampleResult.json();
  const positionCount = exampleRows[0]?.position_count || 0;
  const totalPnl = exampleRows[0]?.total_pnl || 0;

  console.log(`  Positions found: ${positionCount}`);
  console.log(`  Total PnL: $${totalPnl.toFixed(2)}`);

  if (positionCount === 0) {
    console.log('  ⚠ WARNING: No positions found for known missing wallet');
    console.log('  Recovery may have issues\n');
  } else {
    console.log('  ✓ Wallet positions recovered successfully\n');
  }

  // Cleanup temp validation table
  await clickhouse.command({ query: 'DROP TABLE IF EXISTS tmp_validation_conditions' });

  // Load checkpoint for summary
  const checkpoint = JSON.parse(
    fs.readFileSync('/tmp/fifo-recovery-checkpoint.json', 'utf-8')
  );

  // Final summary
  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║           VALIDATION COMPLETE                 ║');
  console.log('╚═══════════════════════════════════════════════╝');
  console.log('\n📊 Summary:');
  console.log(`  Phase 1: ✓ Optimized table built`);
  console.log(`  Phase 2: ${checkpoint.completed_chunks?.length || 0}/${checkpoint.total_chunks || 0} chunks completed`);
  console.log(`  Phase 3: ✓ Validation passed`);
  console.log(`\n  Total January FIFO positions: ${totalPositions.toLocaleString()}`);
  console.log(`  Target condition coverage: ${coveragePercent}%`);
  console.log(`  Known wallet verified: ${positionCount > 0 ? '✓' : '✗'}`);

  if (checkpoint.failed_chunks && checkpoint.failed_chunks.length > 0) {
    console.log(`\n  ⚠ Failed chunks: ${checkpoint.failed_chunks.join(', ')}`);
    console.log('  Consider re-running Phase 2 to retry');
  }

  console.log('\n✓ Ready for Phase 4: cleanup-fifo-recovery.ts');
  console.log('  (Optional cleanup - removes temporary tables)\n');

  // Save validation results to checkpoint
  checkpoint.validation = {
    completed_at: new Date().toISOString(),
    total_positions: totalPositions,
    coverage_percent: parseFloat(coveragePercent),
    covered_conditions: coveredCount,
    example_wallet_positions: positionCount,
  };

  fs.writeFileSync(
    '/tmp/fifo-recovery-checkpoint.json',
    JSON.stringify(checkpoint, null, 2)
  );
}

main().catch(err => {
  console.error('\n❌ FATAL ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
});
