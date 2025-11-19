#!/usr/bin/env tsx
/**
 * pm_trades_canonical_v3_sandbox Build - Testing trades_with_direction Integration
 *
 * Test Scope: August-October 2024 (202408, 202409, 202410)
 * Expected Improvement: 12% → 68% coverage
 *
 * Key Changes from v2:
 * - Adds LEFT JOIN to trades_with_direction (Priority 2 repair source)
 * - Updates COALESCE to prioritize: original > twd > erc1155 > clob
 * - Adds 'twd_join' to id_repair_source enum
 *
 * Crash Protection:
 * - Processes one partition at a time
 * - Saves progress checkpoint after each partition
 * - Can resume from last checkpoint if interrupted
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

const CHECKPOINT_FILE = 'reports/pm_trades_canonical_v3_sandbox_build_checkpoint.json';

// Expanded test scope: Jan, Jul, Aug, Sep, Oct, Nov 2024
// Covers: earliest (Jan), pre-tested (Jul), tested (Aug-Oct), recent (Nov)
const TEST_PARTITIONS = ['202401', '202407', '202408', '202409', '202410', '202411'];

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

async function createTable() {
  console.log('📦 Creating pm_trades_canonical_v3_sandbox table...');

  const ddl = fs.readFileSync('sql/ddl_pm_trades_canonical_v3_sandbox.sql', 'utf-8');

  await clickhouse.command({ query: ddl });
  console.log('✅ Table created successfully');
}

async function insertPartition(partition: string): Promise<number> {
  console.log(`\n📥 Processing partition ${partition}...`);

  const insertQuery = `
    INSERT INTO pm_trades_canonical_v3_sandbox
    SELECT
      vt.trade_id,
      vt.trade_key,
      vt.transaction_hash,
      vt.wallet_address_norm AS wallet_address,

      -- Repair condition_id (Priority: original > twd > erc1155 > clob > NULL)
      COALESCE(
        CASE
          WHEN vt.condition_id_norm IS NOT NULL
            AND vt.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
            AND vt.condition_id_norm != ''
            THEN vt.condition_id_norm
          ELSE NULL
        END,
        twd.condition_id_norm,        -- NEW: Priority 2
        erc.condition_id_decoded,
        clob.condition_id_decoded
      ) AS condition_id_norm_v2,

      -- Repair outcome_index (Priority: original > twd > erc1155 > clob > -1)
      COALESCE(
        CASE WHEN vt.outcome_index >= 0 THEN vt.outcome_index ELSE NULL END,
        twd.outcome_index,             -- NEW: Priority 2
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

      -- Track repair source (UPDATED to include twd_join)
      CASE
        WHEN vt.condition_id_norm IS NOT NULL
          AND vt.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
          AND vt.condition_id_norm != ''
          THEN 'original'
        WHEN twd.condition_id_norm IS NOT NULL THEN 'twd_join'      -- NEW
        WHEN erc.condition_id_decoded IS NOT NULL THEN 'erc1155_decode'
        WHEN clob.condition_id_decoded IS NOT NULL THEN 'clob_decode'
        ELSE 'unknown'
      END AS id_repair_source,

      -- Repair confidence (UPDATED to mark twd as HIGH)
      CASE
        WHEN vt.condition_id_norm IS NOT NULL
          AND vt.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
          THEN 'HIGH'
        WHEN twd.condition_id_norm IS NOT NULL THEN 'HIGH'          -- NEW
        WHEN erc.condition_id_decoded IS NOT NULL THEN 'HIGH'
        WHEN clob.condition_id_decoded IS NOT NULL THEN 'MEDIUM'
        ELSE 'LOW'
      END AS id_repair_confidence,

      -- Mark as orphan if condition_id still null
      CASE
        WHEN COALESCE(
          CASE WHEN vt.condition_id_norm IS NOT NULL AND vt.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000' AND vt.condition_id_norm != '' THEN vt.condition_id_norm ELSE NULL END,
          twd.condition_id_norm,      -- NEW
          erc.condition_id_decoded,
          clob.condition_id_decoded
        ) IS NULL THEN 1
        ELSE 0
      END AS is_orphan,

      -- Orphan reason
      CASE
        WHEN COALESCE(
          CASE WHEN vt.condition_id_norm IS NOT NULL AND vt.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000' AND vt.condition_id_norm != '' THEN vt.condition_id_norm ELSE NULL END,
          twd.condition_id_norm,      -- NEW
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

    -- LEFT JOIN to trades_with_direction (NEW - Priority 2 repair source)
    -- IMPORTANT: GROUP BY to avoid duplicates when multiple outcomes exist per tx
    LEFT JOIN (
      SELECT
        tx_hash,
        wallet_address_lower,
        any(outcome_index) as outcome_index,
        lower(any(condition_id_norm)) AS condition_id_norm
      FROM (
        SELECT
          tx_hash,
          lower(wallet_address) AS wallet_address_lower,
          outcome_index,
          condition_id_norm
        FROM trades_with_direction
        WHERE
          confidence IN ('HIGH', 'MEDIUM')
          AND condition_id_norm != ''
          AND condition_id_norm IS NOT NULL
          AND length(condition_id_norm) = 64
          AND tx_hash IN (
            SELECT DISTINCT transaction_hash
            FROM vw_trades_canonical
            WHERE toYYYYMM(timestamp) = ${partition}
          )
      )
      GROUP BY tx_hash, wallet_address_lower
    ) twd
      ON vt.transaction_hash = twd.tx_hash
      AND vt.wallet_address_norm = twd.wallet_address_lower

    WHERE toYYYYMM(vt.timestamp) = ${partition}
  `;

  await clickhouse.command({ query: insertQuery });

  // Get row count for this partition
  const countQuery = `
    SELECT COUNT(*) AS count
    FROM pm_trades_canonical_v3_sandbox
    WHERE toYYYYMM(timestamp) = ${partition}
  `;

  const countResult = await clickhouse.query({ query: countQuery, format: 'JSONEachRow' });
  const countData = (await countResult.json())[0];
  const rowCount = parseInt(countData.count);

  console.log(`✅ Partition ${partition}: ${rowCount.toLocaleString()} rows inserted`);

  return rowCount;
}

async function main() {
  console.log('🚀 PM Trades Canonical V3 Sandbox - Testing trades_with_direction Integration');
  console.log('='.repeat(80));
  console.log('Test Scope: August-October 2024 (202408, 202409, 202410)');
  console.log('Expected: 12% → 68% coverage improvement');
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

  // Filter to only pending partitions
  const pendingPartitions = TEST_PARTITIONS.filter(p => !progress.completed_partitions.includes(p));

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
  console.log('✅ SANDBOX BUILD COMPLETE');
  console.log('='.repeat(80));
  console.log(`Total rows inserted: ${progress.total_rows_inserted.toLocaleString()}`);
  console.log(`Partitions processed: ${progress.completed_partitions.length}`);
  console.log('');

  // Validation queries
  console.log('📊 Running validation queries...');
  console.log('');

  // Total row count
  const totalQuery = `SELECT COUNT(*) AS count FROM pm_trades_canonical_v3_sandbox`;
  const totalResult = await clickhouse.query({ query: totalQuery, format: 'JSONEachRow' });
  const totalData = (await totalResult.json())[0];
  console.log(`Total rows: ${parseInt(totalData.count).toLocaleString()}`);

  // Repair source breakdown
  const repairQuery = `
    SELECT
      id_repair_source,
      COUNT(*) as count,
      COUNT(*) / (SELECT COUNT(*) FROM pm_trades_canonical_v3_sandbox) * 100 as pct
    FROM pm_trades_canonical_v3_sandbox
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
      COUNT(*) / (SELECT COUNT(*) FROM pm_trades_canonical_v3_sandbox) * 100 as pct
    FROM pm_trades_canonical_v3_sandbox
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

  // Compare to v2 for same scope
  console.log('');
  console.log('='.repeat(80));
  console.log('📊 COVERAGE COMPARISON (v2 vs v3 sandbox)');
  console.log('='.repeat(80));

  const v2Query = `
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN is_orphan = 0 THEN 1 ELSE 0 END) as repaired,
      SUM(CASE WHEN is_orphan = 1 THEN 1 ELSE 0 END) as orphaned,
      (SUM(CASE WHEN is_orphan = 0 THEN 1 ELSE 0 END) / COUNT(*)) * 100 as coverage_pct
    FROM pm_trades_canonical_v2
    WHERE toYYYYMM(timestamp) IN (202408, 202409, 202410)
  `;

  const v2Result = await clickhouse.query({ query: v2Query, format: 'JSONEachRow' });
  const v2Data = (await v2Result.json())[0];

  const v3Query = `
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN is_orphan = 0 THEN 1 ELSE 0 END) as repaired,
      SUM(CASE WHEN is_orphan = 1 THEN 1 ELSE 0 END) as orphaned,
      (SUM(CASE WHEN is_orphan = 0 THEN 1 ELSE 0 END) / COUNT(*)) * 100 as coverage_pct
    FROM pm_trades_canonical_v3_sandbox
  `;

  const v3Result = await clickhouse.query({ query: v3Query, format: 'JSONEachRow' });
  const v3Data = (await v3Result.json())[0];

  console.log('');
  console.log('                           v2 (Current)        v3 (Sandbox)       Improvement');
  console.log('─'.repeat(80));
  console.log(`Total trades:              ${parseInt(v2Data.total).toLocaleString().padStart(15)} ${parseInt(v3Data.total).toLocaleString().padStart(18)}`);
  console.log(`Repaired:                  ${parseInt(v2Data.repaired).toLocaleString().padStart(15)} ${parseInt(v3Data.repaired).toLocaleString().padStart(18)} ${(parseInt(v3Data.repaired) - parseInt(v2Data.repaired)).toLocaleString().padStart(12)}`);
  console.log(`Orphaned:                  ${parseInt(v2Data.orphaned).toLocaleString().padStart(15)} ${parseInt(v3Data.orphaned).toLocaleString().padStart(18)} ${(parseInt(v2Data.orphaned) - parseInt(v3Data.orphaned)).toLocaleString().padStart(12)}`);
  console.log(`Coverage:                  ${parseFloat(v2Data.coverage_pct).toFixed(2).padStart(14)}% ${parseFloat(v3Data.coverage_pct).toFixed(2).padStart(17)}% ${(parseFloat(v3Data.coverage_pct) - parseFloat(v2Data.coverage_pct)).toFixed(2).padStart(11)}%`);

  console.log('');
  console.log('Next Step: Review results and create /tmp/PM_TRADES_V3_SANDBOX_RESULTS.md');
}

main().catch((error) => {
  console.error('\n❌ Fatal error:', error.message);
  process.exit(1);
});
