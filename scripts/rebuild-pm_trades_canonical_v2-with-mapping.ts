#!/usr/bin/env tsx
/**
 * Rebuild pm_trades_canonical_v2 with Mapping Join (No Fanout)
 *
 * This script rebuilds pm_trades_canonical_v2 using the pre-built repair mapping
 * to eliminate JOIN fanout issues that caused 25% row duplication.
 *
 * Key Fix:
 * - LEFT JOIN to pm_trade_id_repair_map (one row per trade_id)
 * - NO direct LEFT JOINs to clob_fills or erc1155_transfers
 * - Guaranteed 1:1 or 1:0 join relationship (no fanout)
 *
 * Expected Result: Exactly 157,541,131 rows (matches vw_trades_canonical)
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';
import * as fs from 'fs';

interface BuildProgress {
  started_at: string;
  last_partition: string | null;
  completed_partitions: string[];
  total_rows_inserted: number;
  errors: any[];
}

const CHECKPOINT_FILE = 'reports/pm_trades_canonical_v2_rebuild_checkpoint.json';

async function loadCheckpoint(): Promise<BuildProgress> {
  if (fs.existsSync(CHECKPOINT_FILE)) {
    console.log('📋 Found existing checkpoint, resuming from last partition...');
    return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf-8'));
  }

  return {
    started_at: new Date().toISOString(),
    last_partition: null,
    completed_partitions: [],
    total_rows_inserted: 0,
    errors: []
  };
}

function saveCheckpoint(progress: BuildProgress) {
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(progress, null, 2));
}

async function getPartitions(): Promise<string[]> {
  const query = `
    SELECT DISTINCT toYYYYMM(timestamp) AS partition
    FROM vw_trades_canonical
    ORDER BY partition ASC
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];
  return rows.map(r => String(r.partition));
}

async function dropBrokenTable() {
  console.log('🗑️  Dropping broken pm_trades_canonical_v2...');

  // Check if table exists
  const checkQuery = `
    SELECT count() AS count
    FROM system.tables
    WHERE database = 'default' AND name = 'pm_trades_canonical_v2'
  `;

  const checkResult = await clickhouse.query({ query: checkQuery, format: 'JSONEachRow' });
  const exists = parseInt((await checkResult.json())[0].count) > 0;

  if (exists) {
    await clickhouse.command({ query: 'DROP TABLE pm_trades_canonical_v2' });
    console.log('✓ Dropped broken table');
  } else {
    console.log('✓ Table does not exist (already dropped)');
  }
  console.log('');
}

async function createTable() {
  console.log('📦 Creating pm_trades_canonical_v2 (with mapping join)...');

  const ddl = fs.readFileSync('sql/ddl_pm_trades_canonical_v2.sql', 'utf-8');

  // Extract just the CREATE TABLE portion (before the commented INSERT)
  const createTableSQL = ddl.split('-- ============================================================================\n-- Population Query')[0];

  await clickhouse.command({ query: createTableSQL });
  console.log('✓ Table created successfully');
  console.log('');
}

async function insertPartition(partition: string): Promise<number> {
  console.log(`📥 Processing partition ${partition}...`);

  const insertQuery = `
    INSERT INTO pm_trades_canonical_v2
    SELECT
      vt.trade_id,
      vt.trade_key,
      vt.transaction_hash,
      vt.wallet_address_norm AS wallet_address,

      -- Repair condition_id using mapping (Priority: mapping > original > NULL)
      COALESCE(
        repair.condition_id_decoded,
        CASE
          WHEN vt.condition_id_norm IS NOT NULL
            AND vt.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
            AND vt.condition_id_norm != ''
            THEN vt.condition_id_norm
          ELSE NULL
        END
      ) AS condition_id_norm_v2,

      -- Repair outcome_index using mapping
      COALESCE(
        repair.outcome_index_decoded,
        CASE WHEN vt.outcome_index >= 0 THEN vt.outcome_index ELSE NULL END,
        -1
      ) AS outcome_index_v2,

      -- market_id: Keep original (mostly null)
      CASE
        WHEN vt.market_id_norm IS NOT NULL
          AND vt.market_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
          AND vt.market_id_norm != ''
          THEN vt.market_id_norm
        ELSE NULL
      END AS market_id_norm_v2,

      -- Store originals for comparison
      vt.condition_id_norm AS condition_id_norm_orig,
      vt.outcome_index AS outcome_index_orig,
      vt.market_id_norm AS market_id_norm_orig,

      -- Trade details
      vt.trade_direction,
      vt.direction_confidence,
      vt.shares,
      vt.entry_price AS price,
      vt.usd_value,
      0 AS fee,

      vt.timestamp,
      now() AS created_at,

      -- Determine source
      CASE
        WHEN repair.repair_source = 'erc1155' THEN 'erc1155'
        WHEN repair.repair_source = 'clob' THEN 'clob'
        ELSE 'canonical'
      END AS source,

      -- Track repair source
      CASE
        WHEN repair.repair_source = 'erc1155' THEN 'erc1155_decode'
        WHEN repair.repair_source = 'clob' THEN 'clob_decode'
        WHEN vt.condition_id_norm IS NOT NULL
          AND vt.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
          AND vt.condition_id_norm != ''
          THEN 'original'
        ELSE 'unknown'
      END AS id_repair_source,

      -- Repair confidence
      CASE
        WHEN repair.repair_confidence = 'HIGH' THEN 'HIGH'
        WHEN repair.repair_confidence = 'MEDIUM' THEN 'MEDIUM'
        WHEN vt.condition_id_norm IS NOT NULL
          AND vt.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
          THEN 'HIGH'
        ELSE 'LOW'
      END AS id_repair_confidence,

      -- Mark as orphan if condition_id still null
      CASE
        WHEN COALESCE(
          repair.condition_id_decoded,
          CASE WHEN vt.condition_id_norm IS NOT NULL AND vt.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000' AND vt.condition_id_norm != '' THEN vt.condition_id_norm ELSE NULL END
        ) IS NULL THEN 1
        ELSE 0
      END AS is_orphan,

      -- Orphan reason
      CASE
        WHEN COALESCE(
          repair.condition_id_decoded,
          CASE WHEN vt.condition_id_norm IS NOT NULL AND vt.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000' AND vt.condition_id_norm != '' THEN vt.condition_id_norm ELSE NULL END
        ) IS NULL THEN 'no_matching_decode_source'
        ELSE NULL
      END AS orphan_reason,

      now() AS version

    FROM vw_trades_canonical vt

    -- LEFT JOIN to repair mapping (one row per trade_id, NO fanout!)
    LEFT JOIN pm_trade_id_repair_map repair
      ON vt.trade_id = repair.trade_id

    WHERE toYYYYMM(vt.timestamp) = ${partition}
  `;

  const startTime = Date.now();
  await clickhouse.command({ query: insertQuery });
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  // Get row count for this partition
  const countQuery = `
    SELECT COUNT(*) AS count
    FROM pm_trades_canonical_v2
    WHERE toYYYYMM(timestamp) = ${partition}
  `;

  const countResult = await clickhouse.query({ query: countQuery, format: 'JSONEachRow' });
  const countData = (await countResult.json())[0];
  const rowCount = parseInt(countData.count);

  console.log(`✓ Partition ${partition}: ${rowCount.toLocaleString()} rows in ${elapsed}s`);

  return rowCount;
}

async function main() {
  console.log('🚀 PM Trades Canonical V2 - Rebuild with Mapping Join');
  console.log('='.repeat(80));
  console.log('Source: vw_trades_canonical (157.5M trades)');
  console.log('Mapping: pm_trade_id_repair_map (8.1M repairs, one row per trade_id)');
  console.log('Method: LEFT JOIN to mapping (NO fanout!)');
  console.log('');

  // Load or initialize progress
  const progress = await loadCheckpoint();
  console.log(`Started: ${progress.started_at}`);

  if (progress.completed_partitions.length > 0) {
    console.log(`Resuming: ${progress.completed_partitions.length} partitions already completed`);
    console.log(`Total rows: ${progress.total_rows_inserted.toLocaleString()}`);
  }
  console.log('');

  // Drop broken table and create new one
  if (progress.completed_partitions.length === 0) {
    await dropBrokenTable();
    await createTable();
  } else {
    console.log('📦 Table already exists, resuming population...');
    console.log('');
  }

  // Get all partitions
  console.log('📅 Fetching partition list...');
  const allPartitions = await getPartitions();
  console.log(`✓ Found ${allPartitions.length} monthly partitions`);
  console.log('');

  // Filter to only pending partitions
  const pendingPartitions = allPartitions.filter(p => !progress.completed_partitions.includes(p));

  if (pendingPartitions.length === 0) {
    console.log('✓ All partitions already completed!');
    return;
  }

  console.log(`Processing ${pendingPartitions.length} remaining partitions...`);
  console.log('');

  // Process each partition
  for (let i = 0; i < pendingPartitions.length; i++) {
    const partition = pendingPartitions[i];
    const partitionNum = i + 1;
    const totalPartitions = pendingPartitions.length;

    console.log(`[${partitionNum}/${totalPartitions}] Partition: ${partition}`);

    try {
      const rowCount = await insertPartition(partition);

      // Update progress
      progress.last_partition = partition;
      progress.completed_partitions.push(partition);
      progress.total_rows_inserted += rowCount;
      saveCheckpoint(progress);

      const progressPct = (partitionNum / totalPartitions * 100).toFixed(1);
      console.log(`Progress: ${progressPct}% (${partitionNum}/${totalPartitions} partitions)`);
      console.log('');

    } catch (error: any) {
      console.error(`❌ Error processing partition ${partition}:`, error.message);

      // Save error and checkpoint
      progress.errors.push({
        partition,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      saveCheckpoint(progress);

      console.log('');
      console.log('⚠️  Build failed. Progress saved to checkpoint.');
      console.log('    Run script again to resume from last successful partition.');
      throw error;
    }
  }

  // Build complete
  console.log('');
  console.log('='.repeat(80));
  console.log('✅ BUILD COMPLETE');
  console.log('='.repeat(80));
  console.log(`Total rows inserted: ${progress.total_rows_inserted.toLocaleString()}`);
  console.log(`Partitions processed: ${progress.completed_partitions.length}`);
  console.log('');

  // Validation queries
  console.log('📊 Running validation queries...');
  console.log('');

  // Total row count
  const totalQuery = `SELECT COUNT(*) AS count FROM pm_trades_canonical_v2`;
  const totalResult = await clickhouse.query({ query: totalQuery, format: 'JSONEachRow' });
  const totalData = (await totalResult.json())[0];
  const actualTotal = parseInt(totalData.count);
  const expectedTotal = 157541131;

  console.log(`Total rows: ${actualTotal.toLocaleString()}`);
  console.log(`Expected:   ${expectedTotal.toLocaleString()}`);

  if (actualTotal === expectedTotal) {
    console.log('✅ Row count matches exactly!');
  } else {
    const diff = actualTotal - expectedTotal;
    console.log(`❌ Row count mismatch: ${diff > 0 ? '+' : ''}${diff.toLocaleString()} rows`);
  }

  // Repair source breakdown
  const repairQuery = `
    SELECT
      id_repair_source,
      COUNT(*) as count,
      COUNT(*) / (SELECT COUNT(*) FROM pm_trades_canonical_v2) * 100 as pct
    FROM pm_trades_canonical_v2
    GROUP BY id_repair_source
    ORDER BY count DESC
  `;

  const repairResult = await clickhouse.query({ query: repairQuery, format: 'JSONEachRow' });
  const repairRows = await repairResult.json() as any[];

  console.log('');
  console.log('Repair source breakdown:');
  for (const row of repairRows) {
    console.log(`  ${row.id_repair_source}: ${parseInt(row.count).toLocaleString()} (${parseFloat(row.pct).toFixed(2)}%)`);
  }

  // Orphan stats
  const orphanQuery = `
    SELECT
      is_orphan,
      COUNT(*) as count,
      COUNT(*) / (SELECT COUNT(*) FROM pm_trades_canonical_v2) * 100 as pct
    FROM pm_trades_canonical_v2
    GROUP BY is_orphan
  `;

  const orphanResult = await clickhouse.query({ query: orphanQuery, format: 'JSONEachRow' });
  const orphanRows = await orphanResult.json() as any[];

  console.log('');
  console.log('Orphan stats:');
  for (const row of orphanRows) {
    const label = row.is_orphan === 1 ? 'Orphans' : 'Repaired';
    console.log(`  ${label}: ${parseInt(row.count).toLocaleString()} (${parseFloat(row.pct).toFixed(2)}%)`);
  }

  console.log('');
  console.log('Next Step: Create global repair coverage report');
}

main().catch((error) => {
  console.error('\n❌ Fatal error:', error.message);
  process.exit(1);
});
