/**
 * FIFO Recovery - Phase 1: Build Optimized January Table
 *
 * Creates tmp_fills_2026_01_by_condition with condition_id as first sort key.
 * This enables efficient granule pruning when filtering by condition_id.
 *
 * ONE-TIME OPERATION - Run this before processing chunks.
 *
 * Expected runtime: 10-15 minutes
 * Expected result: ~50-80M rows, ~12-15GB
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';
import * as fs from 'fs';

async function main() {
  const startTime = Date.now();

  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║   FIFO RECOVERY - PHASE 1: BUILD OPTIMIZED   ║');
  console.log('╚═══════════════════════════════════════════════╝');
  console.log(`Started: ${new Date().toISOString()}\n`);

  // Step 1: Drop existing table if it exists
  console.log('[Step 1/3] Dropping existing table...');
  try {
    await clickhouse.command({
      query: 'DROP TABLE IF EXISTS tmp_fills_2026_01_by_condition'
    });
    console.log('✓ Existing table dropped\n');
  } catch (err: any) {
    console.log(`⚠ Warning: ${err.message}\n`);
  }

  // Step 2: Create optimized table with condition_id first
  console.log('[Step 2/3] Creating optimized table structure...');
  await clickhouse.command({
    query: `
      CREATE TABLE tmp_fills_2026_01_by_condition (
        fill_id String,
        tx_hash String,
        wallet String,
        condition_id String,
        outcome_index UInt8,
        tokens_delta Float64,
        usdc_delta Float64,
        event_time DateTime,
        is_maker UInt8,
        is_self_fill UInt8,
        payout_numerators String,
        resolved_at DateTime
      )
      ENGINE = MergeTree
      ORDER BY (condition_id, wallet, outcome_index, event_time, fill_id)
      SETTINGS index_granularity = 8192
    `
  });
  console.log('✓ Table created with condition_id-first ordering\n');

  // Step 3: Populate table from pm_canonical_fills_v4
  console.log('[Step 3/3] Populating table from January 2026 fills...');
  console.log('This will take 10-15 minutes. Scanning 286M rows...\n');

  const populateStart = Date.now();

  await clickhouse.command({
    query: `
      INSERT INTO tmp_fills_2026_01_by_condition
      SELECT
        f.fill_id,
        f.tx_hash,
        lower(f.wallet) AS wallet,
        f.condition_id,
        f.outcome_index,
        f.tokens_delta,
        f.usdc_delta,
        f.event_time,
        f.is_maker,
        f.is_self_fill,
        r.payout_numerators,
        r.resolved_at
      FROM pm_canonical_fills_v4 f
      INNER JOIN pm_condition_resolutions r ON f.condition_id = r.condition_id
      WHERE f.source = 'clob'
        AND f.event_time >= toDateTime('2026-01-01 00:00:00')
        AND f.event_time < toDateTime('2026-01-28 00:00:00')
        AND r.is_deleted = 0
        AND r.payout_numerators != ''
    `,
    clickhouse_settings: {
      max_execution_time: 1200,  // 20 minutes
      max_threads: 8,
      max_memory_usage: 10000000000,  // 10GB
    }
  });

  const populateDuration = ((Date.now() - populateStart) / 1000 / 60).toFixed(1);
  console.log(`✓ Table populated in ${populateDuration} minutes\n`);

  // Step 4: Verify row count
  console.log('[Verification] Checking row count...');
  const result = await clickhouse.query({
    query: 'SELECT COUNT(*) as count FROM tmp_fills_2026_01_by_condition',
    format: 'JSONEachRow'
  });

  const rows = await result.json();
  const rowCount = rows[0]?.count || 0;

  console.log(`✓ Row count: ${rowCount.toLocaleString()}\n`);

  if (rowCount < 40000000) {
    console.log('⚠ WARNING: Row count lower than expected (40M+)');
    console.log('Expected: 50-80M rows for January 2026\n');
  }

  // Step 5: Check table size
  console.log('[Verification] Checking table size...');
  const sizeResult = await clickhouse.query({
    query: `
      SELECT
        formatReadableSize(sum(bytes)) as size,
        formatReadableSize(sum(bytes_on_disk)) as compressed_size
      FROM system.parts
      WHERE database = 'default'
        AND table = 'tmp_fills_2026_01_by_condition'
        AND active = 1
    `,
    format: 'JSONEachRow'
  });

  const sizeRows = await sizeResult.json();
  const size = sizeRows[0]?.size || '0 B';
  const compressedSize = sizeRows[0]?.compressed_size || '0 B';

  console.log(`✓ Uncompressed size: ${size}`);
  console.log(`✓ Compressed size: ${compressedSize}\n`);

  // Step 6: Write checkpoint
  const checkpoint = {
    phase: 1,
    completed: true,
    started_at: new Date(startTime).toISOString(),
    completed_at: new Date().toISOString(),
    duration_minutes: ((Date.now() - startTime) / 1000 / 60).toFixed(1),
    row_count: rowCount,
    table_size: size,
    compressed_size: compressedSize,
  };

  fs.writeFileSync(
    '/tmp/fifo-recovery-checkpoint.json',
    JSON.stringify(checkpoint, null, 2)
  );

  console.log('[Checkpoint] Progress saved to /tmp/fifo-recovery-checkpoint.json\n');

  const totalDuration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║           PHASE 1 COMPLETE                    ║');
  console.log('╚═══════════════════════════════════════════════╝');
  console.log(`Duration: ${totalDuration} minutes`);
  console.log(`Rows: ${rowCount.toLocaleString()}`);
  console.log(`Size: ${size} (${compressedSize} compressed)\n`);
  console.log('✓ Ready for Phase 2: process-fifo-from-optimized.ts\n');
}

main().catch(err => {
  console.error('\n❌ FATAL ERROR:', err.message);
  console.error(err.stack);
  process.exit(1);
});
