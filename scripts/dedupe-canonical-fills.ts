#!/usr/bin/env npx tsx
/**
 * Atomic Deduplication of pm_canonical_fills_v4
 *
 * Strategy:
 * 1. Create clean table with same schema
 * 2. Copy data partition by partition using FINAL (deduplicates)
 * 3. Verify counts match (with FINAL)
 * 4. Atomic rename: old → backup, new → production
 * 5. Drop backup after verification
 *
 * Safe: No data loss. Backup kept until manual drop.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_VERIFY = process.argv.includes('--skip-verify');

async function getPartitions(): Promise<string[]> {
  const result = await clickhouse.query({
    query: `
      SELECT DISTINCT partition
      FROM system.parts
      WHERE database = 'default' AND table = 'pm_canonical_fills_v4' AND active
      ORDER BY partition
    `,
    format: 'JSONEachRow'
  });
  const rows = await result.json() as { partition: string }[];
  return rows.map(r => r.partition);
}

async function getTableCounts(): Promise<{ raw: number; deduped: number }> {
  const rawResult = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_canonical_fills_v4`,
    format: 'JSONEachRow'
  });
  const raw = ((await rawResult.json()) as any[])[0]?.cnt || 0;

  const dedupedResult = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_canonical_fills_v4 FINAL`,
    format: 'JSONEachRow',
    clickhouse_settings: { max_execution_time: 600 }
  });
  const deduped = ((await dedupedResult.json()) as any[])[0]?.cnt || 0;

  return { raw, deduped };
}

async function main() {
  console.log('=== DEDUPLICATE pm_canonical_fills_v4 ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE'}`);
  console.log(`Started: ${new Date().toISOString()}\n`);

  // Step 1: Get current state
  console.log('Step 1: Analyzing current table...');
  const partitions = await getPartitions();
  console.log(`  Partitions: ${partitions.length} (${partitions[0]} to ${partitions[partitions.length - 1]})`);

  const counts = await getTableCounts();
  console.log(`  Raw rows: ${counts.raw.toLocaleString()}`);
  console.log(`  Deduped rows: ${counts.deduped.toLocaleString()}`);
  console.log(`  Duplicate factor: ${(counts.raw / counts.deduped).toFixed(2)}x`);
  console.log(`  Space savings potential: ${((1 - counts.deduped / counts.raw) * 100).toFixed(1)}%`);

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Would perform the following:');
    console.log('  1. Create pm_canonical_fills_v4_clean with same schema');
    console.log(`  2. Copy ${partitions.length} partitions with FINAL deduplication`);
    console.log('  3. Verify deduped counts match');
    console.log('  4. Rename: v4 → v4_backup, v4_clean → v4');
    console.log('  5. Manual: DROP TABLE pm_canonical_fills_v4_backup after verification');
    return;
  }

  // Step 2: Create clean table
  console.log('\nStep 2: Creating clean table...');
  await clickhouse.command({
    query: `DROP TABLE IF EXISTS pm_canonical_fills_v4_clean`
  });
  await clickhouse.command({
    query: `
      CREATE TABLE pm_canonical_fills_v4_clean (
        fill_id String,
        event_time DateTime,
        block_number UInt64,
        tx_hash String,
        wallet LowCardinality(String),
        condition_id String,
        outcome_index UInt8,
        tokens_delta Float64,
        usdc_delta Float64,
        source LowCardinality(String),
        is_self_fill UInt8 DEFAULT 0,
        is_maker UInt8 DEFAULT 0,
        _version UInt64 DEFAULT toUnixTimestamp64Milli(now64())
      )
      ENGINE = SharedReplacingMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}', _version)
      PARTITION BY toYYYYMM(event_time)
      ORDER BY (wallet, condition_id, outcome_index, fill_id)
    `
  });
  console.log('  Created pm_canonical_fills_v4_clean');

  // Step 3: Copy each partition with FINAL
  console.log('\nStep 3: Copying partitions (with deduplication)...');
  let totalCopied = 0;

  for (let i = 0; i < partitions.length; i++) {
    const partition = partitions[i];
    const startTime = Date.now();

    // Extract year/month from partition (format: YYYYMM)
    const year = partition.slice(0, 4);
    const month = partition.slice(4, 6);
    const startDate = `${year}-${month}-01`;
    const endDate = month === '12'
      ? `${parseInt(year) + 1}-01-01`
      : `${year}-${String(parseInt(month) + 1).padStart(2, '0')}-01`;

    await clickhouse.command({
      query: `
        INSERT INTO pm_canonical_fills_v4_clean
        SELECT * FROM pm_canonical_fills_v4 FINAL
        WHERE event_time >= '${startDate}' AND event_time < '${endDate}'
      `,
      clickhouse_settings: { max_execution_time: 600 }
    });

    // Count copied rows
    const countResult = await clickhouse.query({
      query: `SELECT count() as cnt FROM pm_canonical_fills_v4_clean WHERE event_time >= '${startDate}' AND event_time < '${endDate}'`,
      format: 'JSONEachRow'
    });
    const copied = ((await countResult.json()) as any[])[0]?.cnt || 0;
    totalCopied += copied;

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    process.stdout.write(`\r  [${i + 1}/${partitions.length}] ${partition}: ${copied.toLocaleString()} rows (${elapsed}s) - Total: ${totalCopied.toLocaleString()}   `);
  }
  console.log('\n');

  // Step 4: Verify counts
  if (!SKIP_VERIFY) {
    console.log('Step 4: Verifying counts...');
    const cleanCount = await clickhouse.query({
      query: `SELECT count() as cnt FROM pm_canonical_fills_v4_clean`,
      format: 'JSONEachRow'
    });
    const cleanRows = ((await cleanCount.json()) as any[])[0]?.cnt || 0;

    console.log(`  Original (FINAL): ${counts.deduped.toLocaleString()}`);
    console.log(`  Clean table:      ${cleanRows.toLocaleString()}`);

    const diff = Math.abs(cleanRows - counts.deduped);
    const pctDiff = (diff / counts.deduped) * 100;

    if (pctDiff > 0.1) {
      console.log(`  ⚠️  WARNING: ${pctDiff.toFixed(2)}% difference (${diff.toLocaleString()} rows)`);
      console.log('  Aborting rename. Clean table preserved for investigation.');
      return;
    }
    console.log(`  ✓ Counts match within tolerance (diff: ${diff.toLocaleString()})`);
  }

  // Step 5: Atomic rename
  console.log('\nStep 5: Atomic rename...');

  // Check if backup already exists
  const backupExists = await clickhouse.query({
    query: `SELECT count() > 0 as exists FROM system.tables WHERE database = 'default' AND name = 'pm_canonical_fills_v4_backup'`,
    format: 'JSONEachRow'
  });
  if (((await backupExists.json()) as any[])[0]?.exists) {
    console.log('  Dropping old backup table...');
    await clickhouse.command({ query: `DROP TABLE pm_canonical_fills_v4_backup` });
  }

  console.log('  Renaming: pm_canonical_fills_v4 → pm_canonical_fills_v4_backup');
  await clickhouse.command({ query: `RENAME TABLE pm_canonical_fills_v4 TO pm_canonical_fills_v4_backup` });

  console.log('  Renaming: pm_canonical_fills_v4_clean → pm_canonical_fills_v4');
  await clickhouse.command({ query: `RENAME TABLE pm_canonical_fills_v4_clean TO pm_canonical_fills_v4` });

  console.log('\n✅ DEDUPLICATION COMPLETE');
  console.log(`  Old table backed up as: pm_canonical_fills_v4_backup`);
  console.log(`  Run 'DROP TABLE pm_canonical_fills_v4_backup' after verification`);

  // Final stats
  const newCounts = await getTableCounts();
  console.log(`\n  New table: ${newCounts.raw.toLocaleString()} rows (was ${counts.raw.toLocaleString()})`);
  console.log(`  Space saved: ~${(((counts.raw - newCounts.raw) / counts.raw) * 100).toFixed(1)}%`);
}

main().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
