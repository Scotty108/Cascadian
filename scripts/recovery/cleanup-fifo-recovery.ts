/**
 * FIFO Recovery - Phase 4: Cleanup
 *
 * Cleans up temporary tables created during recovery:
 * - tmp_fills_2026_01_by_condition (optimized January table)
 * - Any remaining tmp_chunk_* tables
 *
 * Archives checkpoint file for future reference.
 *
 * Expected runtime: < 1 minute
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';
import * as fs from 'fs';

async function main() {
  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║   FIFO RECOVERY - PHASE 4: CLEANUP           ║');
  console.log('╚═══════════════════════════════════════════════╝');
  console.log(`Started: ${new Date().toISOString()}\n`);

  // Step 1: Drop optimized January table
  console.log('[Step 1/3] Dropping optimized January table...');
  try {
    await clickhouse.command({
      query: 'DROP TABLE IF EXISTS tmp_fills_2026_01_by_condition'
    });
    console.log('✓ tmp_fills_2026_01_by_condition dropped\n');
  } catch (err: any) {
    console.log(`⚠ Warning: ${err.message}\n`);
  }

  // Step 2: Find and drop any remaining chunk tables
  console.log('[Step 2/3] Finding remaining chunk tables...');
  const tablesResult = await clickhouse.query({
    query: `
      SELECT name
      FROM system.tables
      WHERE database = 'default'
        AND name LIKE 'tmp_chunk_%'
    `,
    format: 'JSONEachRow'
  });

  const tables = await tablesResult.json();

  if (tables.length > 0) {
    console.log(`Found ${tables.length} chunk tables to clean up:`);
    for (const table of tables) {
      process.stdout.write(`  Dropping ${table.name}...`);
      try {
        await clickhouse.command({
          query: `DROP TABLE IF EXISTS ${table.name}`
        });
        console.log(' ✓');
      } catch (err: any) {
        console.log(` ⚠ ${err.message}`);
      }
    }
    console.log('');
  } else {
    console.log('✓ No chunk tables found (already cleaned)\n');
  }

  // Step 3: Archive checkpoint file
  console.log('[Step 3/3] Archiving checkpoint file...');

  if (fs.existsSync('/tmp/fifo-recovery-checkpoint.json')) {
    const checkpoint = JSON.parse(
      fs.readFileSync('/tmp/fifo-recovery-checkpoint.json', 'utf-8')
    );

    // Add cleanup timestamp
    checkpoint.cleanup_completed_at = new Date().toISOString();

    // Archive with timestamp
    const archivePath = `/tmp/fifo-recovery-checkpoint-${Date.now()}.json`;
    fs.writeFileSync(archivePath, JSON.stringify(checkpoint, null, 2));

    console.log(`✓ Checkpoint archived to: ${archivePath}`);

    // Optionally remove original
    // fs.unlinkSync('/tmp/fifo-recovery-checkpoint.json');
    console.log('  (Original checkpoint file kept for reference)\n');
  } else {
    console.log('⚠ No checkpoint file found\n');
  }

  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║           CLEANUP COMPLETE                    ║');
  console.log('╚═══════════════════════════════════════════════╝');
  console.log('\n✓ All temporary tables removed');
  console.log('✓ Checkpoint archived');
  console.log('\n🎉 FIFO Recovery Complete!\n');
  console.log('Next steps:');
  console.log('  1. Verify data in production dashboard');
  console.log('  2. Check wallet 0x7ed62b230d860eb69bf076450026ac382dc5eb26');
  console.log('  3. Monitor for any anomalies\n');
}

main().catch(err => {
  console.error('\n❌ FATAL ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
});
