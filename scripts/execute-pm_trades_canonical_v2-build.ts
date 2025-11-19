#!/usr/bin/env tsx
/**
 * Phase 1, Step 1.8: Execute Full pm_trades_canonical_v2 Build
 *
 * Builds pm_trades_canonical_v2 from vw_trades_canonical with token decode repair.
 * Uses monthly partition batches to avoid ClickHouse memory limits (14.4 GB ceiling).
 *
 * Crash Protection:
 * - Processes one partition at a time
 * - Saves progress checkpoint after each partition
 * - Can resume from last checkpoint if interrupted
 *
 * Expected Runtime: 20-90 minutes for 157M trades (36 monthly partitions)
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

const CHECKPOINT_FILE = 'reports/pm_trades_canonical_v2_build_checkpoint.json';

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

async function createTable() {
  console.log('📦 Creating pm_trades_canonical_v2 table...');

  const ddl = fs.readFileSync('sql/ddl_pm_trades_canonical_v2.sql', 'utf-8');

  // Extract just the CREATE TABLE portion (before the commented INSERT)
  const createTableSQL = ddl.split('-- ============================================================================\n-- Population Query')[0];

  await clickhouse.command({ query: createTableSQL });
  console.log('✅ Table created successfully');
}

async function insertPartition(partition: string): Promise<number> {
  console.log(`\n📥 Processing partition ${partition}...`);

  const partitionYear = partition.slice(0, 4);
  const partitionMonth = partition.slice(4, 6);

  const insertQuery = `
    INSERT INTO pm_trades_canonical_v2
    SELECT
      vt.trade_id,
      vt.trade_key,
      vt.transaction_hash,
      vt.wallet_address_norm AS wallet_address,

      -- Repair condition_id (Priority: original > erc1155 > clob > NULL)
      COALESCE(
        CASE
          WHEN vt.condition_id_norm IS NOT NULL
            AND vt.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
            AND vt.condition_id_norm != ''
            THEN vt.condition_id_norm
          ELSE NULL
        END,
        erc.condition_id_decoded,
        clob.condition_id_decoded
      ) AS condition_id_norm_v2,

      -- Repair outcome_index
      COALESCE(
        CASE WHEN vt.outcome_index >= 0 THEN vt.outcome_index ELSE NULL END,
        erc.outcome_index_decoded,
        clob.outcome_index_decoded,
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
        WHEN clob.tx_hash IS NOT NULL THEN 'clob'
        WHEN erc.tx_hash IS NOT NULL THEN 'erc1155'
        ELSE 'canonical'
      END AS source,

      -- Track repair source
      CASE
        WHEN vt.condition_id_norm IS NOT NULL
          AND vt.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
          AND vt.condition_id_norm != ''
          THEN 'original'
        WHEN erc.condition_id_decoded IS NOT NULL THEN 'erc1155_decode'
        WHEN clob.condition_id_decoded IS NOT NULL THEN 'clob_decode'
        ELSE 'unknown'
      END AS id_repair_source,

      -- Repair confidence
      CASE
        WHEN vt.condition_id_norm IS NOT NULL
          AND vt.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
          THEN 'HIGH'
        WHEN erc.condition_id_decoded IS NOT NULL THEN 'HIGH'
        WHEN clob.condition_id_decoded IS NOT NULL THEN 'MEDIUM'
        ELSE 'LOW'
      END AS id_repair_confidence,

      -- Mark as orphan if condition_id still null
      CASE
        WHEN COALESCE(
          CASE WHEN vt.condition_id_norm IS NOT NULL AND vt.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000' AND vt.condition_id_norm != '' THEN vt.condition_id_norm ELSE NULL END,
          erc.condition_id_decoded,
          clob.condition_id_decoded
        ) IS NULL THEN 1
        ELSE 0
      END AS is_orphan,

      -- Orphan reason
      CASE
        WHEN COALESCE(
          CASE WHEN vt.condition_id_norm IS NOT NULL AND vt.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000' AND vt.condition_id_norm != '' THEN vt.condition_id_norm ELSE NULL END,
          erc.condition_id_decoded,
          clob.condition_id_decoded
        ) IS NULL THEN 'no_matching_decode_source'
        ELSE NULL
      END AS orphan_reason,

      now() AS version

    FROM vw_trades_canonical vt

    -- LEFT JOIN to CLOB repairs (only for this partition's tx_hashes)
    LEFT JOIN (
      SELECT
        cf.tx_hash,
        cf.user_eoa AS wallet_address,
        lpad(hex(bitShiftRight(CAST(cf.asset_id AS UInt256), 2)), 64, '0') AS condition_id_decoded,
        multiIf(
          bitAnd(CAST(cf.asset_id AS UInt256), 3) = 1, 0,
          bitAnd(CAST(cf.asset_id AS UInt256), 3) = 2, 1,
          -1
        ) AS outcome_index_decoded
      FROM clob_fills cf
      WHERE
        cf.asset_id IS NOT NULL
        AND cf.asset_id != ''
        AND cf.tx_hash IN (
          SELECT DISTINCT transaction_hash
          FROM vw_trades_canonical
          WHERE toYYYYMM(timestamp) = ${partition}
        )
    ) clob
      ON vt.transaction_hash = clob.tx_hash
      AND vt.wallet_address_norm = clob.wallet_address

    -- LEFT JOIN to ERC1155 repairs (only for this partition's tx_hashes)
    LEFT JOIN (
      SELECT
        et.tx_hash,
        et.to_address AS wallet_address,
        lpad(hex(bitShiftRight(reinterpretAsUInt256(unhex(substring(et.token_id, 3))), 2)), 64, '0') AS condition_id_decoded,
        multiIf(
          bitAnd(reinterpretAsUInt256(unhex(substring(et.token_id, 3))), 3) = 1, 0,
          bitAnd(reinterpretAsUInt256(unhex(substring(et.token_id, 3))), 3) = 2, 1,
          -1
        ) AS outcome_index_decoded
      FROM erc1155_transfers et
      WHERE
        et.token_id IS NOT NULL
        AND et.token_id != ''
        AND et.tx_hash IN (
          SELECT DISTINCT transaction_hash
          FROM vw_trades_canonical
          WHERE toYYYYMM(timestamp) = ${partition}
        )
    ) erc
      ON vt.transaction_hash = erc.tx_hash
      AND vt.wallet_address_norm = erc.wallet_address

    WHERE toYYYYMM(vt.timestamp) = ${partition}
  `;

  await clickhouse.command({ query: insertQuery });

  // Get row count for this partition
  const countQuery = `
    SELECT COUNT(*) AS count
    FROM pm_trades_canonical_v2
    WHERE toYYYYMM(timestamp) = ${partition}
  `;

  const countResult = await clickhouse.query({ query: countQuery, format: 'JSONEachRow' });
  const countData = (await countResult.json())[0];
  const rowCount = parseInt(countData.count);

  console.log(`✅ Partition ${partition}: ${rowCount.toLocaleString()} rows inserted`);

  return rowCount;
}

async function main() {
  console.log('🚀 PM Trades Canonical V2 - Full Build');
  console.log('='.repeat(80));
  console.log('Building pm_trades_canonical_v2 with token decode repair');
  console.log('Source: vw_trades_canonical (157M trades)');
  console.log('Method: Monthly partition batches (crash-protected)');
  console.log('');

  // Load or initialize progress
  const progress = await loadCheckpoint();
  console.log(`Started: ${progress.started_at}`);

  if (progress.completed_partitions.length > 0) {
    console.log(`Resuming: ${progress.completed_partitions.length} partitions already completed`);
    console.log(`Total rows: ${progress.total_rows_inserted.toLocaleString()}`);
  }
  console.log('');

  // Create table if first run
  if (progress.completed_partitions.length === 0) {
    await createTable();
  } else {
    console.log('📦 Table already exists, resuming population...');
  }

  // Get all partitions
  console.log('📅 Fetching partition list...');
  const allPartitions = await getPartitions();
  console.log(`✅ Found ${allPartitions.length} monthly partitions`);
  console.log('');

  // Filter to only pending partitions
  const pendingPartitions = allPartitions.filter(p => !progress.completed_partitions.includes(p));

  if (pendingPartitions.length === 0) {
    console.log('✅ All partitions already completed!');
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
  console.log(`Total rows: ${parseInt(totalData.count).toLocaleString()}`);

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
  console.log('Next Step: Review coverage report and proceed to orphan table creation');
}

main().catch((error) => {
  console.error('\n❌ Fatal error:', error.message);
  process.exit(1);
});
