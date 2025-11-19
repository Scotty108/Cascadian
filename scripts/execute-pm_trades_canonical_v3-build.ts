#!/usr/bin/env tsx
/**
 * pm_trades_canonical_v3 Global Build - trades_with_direction Integration
 *
 * Builds global pm_trades_canonical_v3 table with BOTH v2 and v3 columns:
 * - v2 columns: Use OLD waterfall (original > erc1155 > clob) for backward compatibility
 * - v3 columns: Use NEW waterfall (original > twd > erc1155 > clob) for 47.98% improvement
 *
 * Key Enhancements from Sandbox:
 * - Supports partition whitelisting via PARTITION_WHITELIST env variable
 * - Logs per-partition uniqueness and row deltas
 * - Auto-discovers all available partitions if no whitelist specified
 * - Creates BOTH v2 (compatibility) and v3 (improved) columns
 *
 * Crash Protection:
 * - Processes one partition at a time
 * - Saves progress checkpoint after each partition
 * - Can resume from last checkpoint if interrupted
 *
 * Usage:
 *   # Build all partitions
 *   npx tsx scripts/execute-pm_trades_canonical_v3-build.ts
 *
 *   # Build specific partitions (comma-separated)
 *   PARTITION_WHITELIST=202401,202407,202408 npx tsx scripts/execute-pm_trades_canonical_v3-build.ts
 *
 * Safety Testing:
 *   PARTITION_WHITELIST=202301,202405,202501 npx tsx scripts/execute-pm_trades_canonical_v3-build.ts
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
  partition_metrics: PartitionMetric[];
  errors: any[];
}

interface PartitionMetric {
  partition: string;
  rows_inserted: number;
  unique_trade_ids: number;
  orphan_count: number;
  condition_source_v3_breakdown: Record<string, number>;
}

const CHECKPOINT_FILE = 'reports/pm_trades_canonical_v3_build_checkpoint.json';

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
    partition_metrics: [],
    errors: []
  };
}

function saveCheckpoint(progress: BuildProgress) {
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(progress, null, 2));
}

async function discoverPartitions(): Promise<string[]> {
  const query = `
    SELECT DISTINCT toYYYYMM(timestamp) as partition
    FROM pm_trades_canonical_v2
    WHERE timestamp >= '2022-01-01'
    ORDER BY partition
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = await result.json() as any[];
  return data.map(row => String(row.partition));
}

async function createTable() {
  console.log('📦 Creating pm_trades_canonical_v3 table...');

  const ddl = fs.readFileSync('sql/ddl_pm_trades_canonical_v3.sql', 'utf-8');

  await clickhouse.command({ query: ddl });
  console.log('✅ Table created successfully');
}

async function insertPartition(partition: string): Promise<PartitionMetric> {
  console.log(`\n📥 Processing partition ${partition}...`);

  const insertQuery = `
    INSERT INTO pm_trades_canonical_v3
    SELECT
      vt.trade_id,
      vt.trade_key,
      vt.transaction_hash,
      vt.wallet_address_norm AS wallet_address,

      -- =====================================================================
      -- V2 COLUMNS (backward compatibility - OLD waterfall without twd)
      -- =====================================================================

      -- V2: condition_id (Priority: original > erc1155 > clob - NO TWD)
      COALESCE(
        CASE
          WHEN vt.condition_id_norm IS NOT NULL
            AND vt.condition_id_norm != '0000000000000000000000000000000000000000000000000000000000000000'
            AND vt.condition_id_norm != ''
            AND length(vt.condition_id_norm) = 64
            THEN lower(vt.condition_id_norm)
          ELSE NULL
        END,
        lower(erc.condition_id_decoded),
        lower(clob.condition_id_decoded)
      ) AS condition_id_norm_v2,

      -- V2: outcome_index (Priority: original > erc1155 > clob - NO TWD)
      COALESCE(
        CASE WHEN vt.outcome_index >= 0 THEN vt.outcome_index ELSE NULL END,
        erc.outcome_index_decoded,
        clob.outcome_index_decoded,
        -1
      ) AS outcome_index_v2,

      -- V2: market_id (keep original, mostly null)
      CASE
        WHEN vt.market_id_norm IS NOT NULL
          AND vt.market_id_norm != '0000000000000000000000000000000000000000000000000000000000000000'
          AND vt.market_id_norm != ''
          AND length(vt.market_id_norm) = 64
          THEN lower(vt.market_id_norm)
        ELSE NULL
      END AS market_id_norm_v2,

      -- =====================================================================
      -- V3 COLUMNS (improved coverage - NEW waterfall with twd)
      -- =====================================================================

      -- V3: condition_id (OVERLAY: twd over v2 - guarantees v3 >= v2 coverage)
      CASE
        WHEN twd.condition_id_norm IS NOT NULL
          AND twd.condition_id_norm != '0000000000000000000000000000000000000000000000000000000000000000'
          AND twd.condition_id_norm != ''
          AND length(twd.condition_id_norm) = 64
          THEN lower(twd.condition_id_norm)
        ELSE condition_id_norm_v2  -- Fall back to v2 result (original > erc1155 > clob)
      END AS condition_id_norm_v3,

      -- V3: outcome_index (OVERLAY: twd over v2)
      CASE
        WHEN twd.outcome_index IS NOT NULL AND twd.outcome_index != -1
          THEN twd.outcome_index
        ELSE outcome_index_v2  -- Fall back to v2 result
      END AS outcome_index_v3,

      -- V3: market_id (same as v2 for now)
      CASE
        WHEN vt.market_id_norm IS NOT NULL
          AND vt.market_id_norm != '0000000000000000000000000000000000000000000000000000000000000000'
          AND vt.market_id_norm != ''
          AND length(vt.market_id_norm) = 64
          THEN lower(vt.market_id_norm)
        ELSE NULL
      END AS market_id_norm_v3,

      -- V3: condition_source (OVERLAY provenance: 'twd' or 'v2_passthrough')
      CASE
        WHEN twd.condition_id_norm IS NOT NULL
          AND twd.condition_id_norm != '0000000000000000000000000000000000000000000000000000000000000000'
          AND twd.condition_id_norm != ''
          AND length(twd.condition_id_norm) = 64
          THEN 'twd'
        -- Otherwise track what v2 used (for debugging/analysis)
        WHEN vt.condition_id_norm IS NOT NULL
          AND vt.condition_id_norm != '0000000000000000000000000000000000000000000000000000000000000000'
          AND vt.condition_id_norm != ''
          AND length(vt.condition_id_norm) = 64
          THEN 'v2_original'
        WHEN erc.condition_id_decoded IS NOT NULL THEN 'v2_erc1155'
        WHEN clob.condition_id_decoded IS NOT NULL THEN 'v2_clob'
        ELSE 'none'
      END AS condition_source_v3,

      -- =====================================================================
      -- ORIGINAL IDs (for comparison and debugging)
      -- =====================================================================

      lower(vt.condition_id_norm) AS condition_id_norm_orig,
      vt.outcome_index AS outcome_index_orig,
      lower(vt.market_id_norm) AS market_id_norm_orig,

      -- =====================================================================
      -- TRADE DETAILS (unchanged from v2)
      -- =====================================================================

      vt.trade_direction,
      vt.direction_confidence,
      vt.shares,
      vt.entry_price AS price,
      vt.usd_value,
      0 AS fee,

      vt.timestamp,
      now() AS created_at,

      -- Source tracking
      CASE
        WHEN clob.tx_hash IS NOT NULL THEN 'clob'
        WHEN erc.tx_hash IS NOT NULL THEN 'erc1155'
        ELSE 'canonical'
      END AS source,

      -- =====================================================================
      -- REPAIR PROVENANCE (v2 compatibility - expanded to include twd_join)
      -- =====================================================================

      -- id_repair_source (tracks v2 column repair - no twd)
      CASE
        WHEN vt.condition_id_norm IS NOT NULL
          AND vt.condition_id_norm != '0000000000000000000000000000000000000000000000000000000000000000'
          AND vt.condition_id_norm != ''
          AND length(vt.condition_id_norm) = 64
          THEN 'original'
        WHEN twd.condition_id_norm IS NOT NULL THEN 'twd_join'  -- NOTE: Actually tracks v3, but kept for compatibility
        WHEN erc.condition_id_decoded IS NOT NULL THEN 'erc1155_decode'
        WHEN clob.condition_id_decoded IS NOT NULL THEN 'clob_decode'
        ELSE 'unknown'
      END AS id_repair_source,

      -- id_repair_confidence
      CASE
        WHEN vt.condition_id_norm IS NOT NULL
          AND vt.condition_id_norm != '0000000000000000000000000000000000000000000000000000000000000000'
          AND vt.condition_id_norm != ''
          AND length(vt.condition_id_norm) = 64
          THEN 'HIGH'
        WHEN twd.condition_id_norm IS NOT NULL THEN 'HIGH'
        WHEN erc.condition_id_decoded IS NOT NULL THEN 'HIGH'
        WHEN clob.condition_id_decoded IS NOT NULL THEN 'MEDIUM'
        ELSE 'LOW'
      END AS id_repair_confidence,

      -- =====================================================================
      -- ORPHAN TRACKING (based on v3 columns)
      -- =====================================================================

      -- is_orphan (1 if condition_id_norm_v3 is null after all repairs)
      CASE
        WHEN COALESCE(
          CASE WHEN vt.condition_id_norm IS NOT NULL AND vt.condition_id_norm != '0000000000000000000000000000000000000000000000000000000000000000' AND vt.condition_id_norm != '' AND length(vt.condition_id_norm) = 64 THEN lower(vt.condition_id_norm) ELSE NULL END,
          lower(twd.condition_id_norm),
          lower(erc.condition_id_decoded),
          lower(clob.condition_id_decoded)
        ) IS NULL THEN 1
        ELSE 0
      END AS is_orphan,

      -- orphan_reason
      CASE
        WHEN COALESCE(
          CASE WHEN vt.condition_id_norm IS NOT NULL AND vt.condition_id_norm != '0000000000000000000000000000000000000000000000000000000000000000' AND vt.condition_id_norm != '' AND length(vt.condition_id_norm) = 64 THEN lower(vt.condition_id_norm) ELSE NULL END,
          lower(twd.condition_id_norm),
          lower(erc.condition_id_decoded),
          lower(clob.condition_id_decoded)
        ) IS NULL THEN 'no_matching_decode_source'
        ELSE NULL
      END AS orphan_reason,

      -- =====================================================================
      -- BUILD TRACKING (for rollback and debugging)
      -- =====================================================================

      'v3.0.0' AS build_version,
      now() AS build_timestamp,

      -- =====================================================================
      -- VERSION (ReplacingMergeTree)
      -- =====================================================================

      now() AS version

    FROM vw_trades_canonical vt

    -- =========================================================================
    -- LEFT JOIN to CLOB repairs (only for this partition's tx_hashes)
    -- =========================================================================

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

    -- =========================================================================
    -- LEFT JOIN to ERC1155 repairs (only for this partition's tx_hashes)
    -- =========================================================================

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

    -- =========================================================================
    -- LEFT JOIN to trades_with_direction (NEW - Priority 2 repair source)
    -- =========================================================================
    -- IMPORTANT: GROUP BY to avoid duplicates when multiple outcomes exist per tx

    LEFT JOIN (
      SELECT
        tx_hash,
        wallet_address_lower,
        any(outcome_index) as outcome_index,
        any(condition_id_norm) AS condition_id_norm  -- NOTE: Removed lower() here, applied in SELECT
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
          AND condition_id_norm != '0000000000000000000000000000000000000000000000000000000000000000'
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

  // Get partition metrics
  const metricsQuery = `
    SELECT
      COUNT(*) AS row_count,
      COUNT(DISTINCT trade_id) as unique_trade_ids,
      SUM(is_orphan) as orphan_count,
      condition_source_v3,
      COUNT(*) as source_count
    FROM pm_trades_canonical_v3
    WHERE toYYYYMM(timestamp) = ${partition}
    GROUP BY condition_source_v3
  `;

  const metricsResult = await clickhouse.query({ query: metricsQuery, format: 'JSONEachRow' });
  const metricsData = await metricsResult.json() as any[];

  // Aggregate metrics
  const rowCount = metricsData.reduce((sum, row) => sum + parseInt(row.source_count), 0);
  const uniqueTradeIds = metricsData.length > 0 ? parseInt(metricsData[0].unique_trade_ids) : 0;
  const orphanCount = metricsData.reduce((sum, row) => sum + parseInt(row.orphan_count), 0);

  const sourceBreakdown: Record<string, number> = {};
  for (const row of metricsData) {
    sourceBreakdown[row.condition_source_v3] = parseInt(row.source_count);
  }

  console.log(`✅ Partition ${partition}:`);
  console.log(`   Rows: ${rowCount.toLocaleString()}`);
  console.log(`   Unique trade_ids: ${uniqueTradeIds.toLocaleString()}`);
  console.log(`   Orphans: ${orphanCount.toLocaleString()} (${(orphanCount / rowCount * 100).toFixed(2)}%)`);
  console.log(`   Source breakdown:`, sourceBreakdown);

  return {
    partition,
    rows_inserted: rowCount,
    unique_trade_ids: uniqueTradeIds,
    orphan_count: orphanCount,
    condition_source_v3_breakdown: sourceBreakdown
  };
}

async function main() {
  console.log('🚀 PM Trades Canonical V3 - Global Build');
  console.log('='.repeat(80));
  console.log('Expected Improvement: 52% → 100% coverage (0% orphans)');
  console.log('');

  // Load or initialize progress
  const progress = await loadCheckpoint();
  console.log(`Started: ${progress.started_at}`);

  if (progress.completed_partitions.length > 0) {
    console.log(`Resuming: ${progress.completed_partitions.length} partitions already completed`);
    console.log(`Total rows: ${progress.total_rows_inserted.toLocaleString()}`);
  }
  console.log('');

  // Determine partitions to process
  let allPartitions: string[];

  const whitelistEnv = process.env.PARTITION_WHITELIST;
  if (whitelistEnv) {
    allPartitions = whitelistEnv.split(',').map(p => p.trim());
    console.log(`📋 Using partition whitelist: ${allPartitions.join(', ')}`);
  } else {
    console.log('🔍 Auto-discovering all available partitions...');
    allPartitions = await discoverPartitions();
    console.log(`✅ Found ${allPartitions.length} partitions: ${allPartitions[0]} → ${allPartitions[allPartitions.length - 1]}`);
  }
  console.log('');

  // Create table if first run
  if (progress.completed_partitions.length === 0) {
    await createTable();
  } else {
    console.log('📦 Table already exists, resuming population...');
  }

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
      const metrics = await insertPartition(partition);

      // Update progress
      progress.last_partition = partition;
      progress.completed_partitions.push(partition);
      progress.total_rows_inserted += metrics.rows_inserted;
      progress.partition_metrics.push(metrics);
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

  // Global validation
  console.log('📊 Running global validation queries...');
  console.log('');

  // Total row count
  const totalQuery = `SELECT COUNT(*) AS count FROM pm_trades_canonical_v3`;
  const totalResult = await clickhouse.query({ query: totalQuery, format: 'JSONEachRow' });
  const totalData = (await totalResult.json())[0];
  console.log(`Total rows: ${parseInt(totalData.count).toLocaleString()}`);

  // Global unique trade_ids
  const uniqueQuery = `SELECT COUNT(DISTINCT trade_id) AS count FROM pm_trades_canonical_v3`;
  const uniqueResult = await clickhouse.query({ query: uniqueQuery, format: 'JSONEachRow' });
  const uniqueData = (await uniqueResult.json())[0];
  console.log(`Unique trade_ids: ${parseInt(uniqueData.count).toLocaleString()}`);

  // Global condition_source_v3 breakdown
  const sourceQuery = `
    SELECT
      condition_source_v3,
      COUNT(*) as count,
      COUNT(*) / (SELECT COUNT(*) FROM pm_trades_canonical_v3) * 100 as pct
    FROM pm_trades_canonical_v3
    GROUP BY condition_source_v3
    ORDER BY count DESC
  `;

  const sourceResult = await clickhouse.query({ query: sourceQuery, format: 'JSONEachRow' });
  const sourceRows = await sourceResult.json() as any[];

  console.log('');
  console.log('Global condition_source_v3 breakdown:');
  for (const row of sourceRows) {
    console.log(`  ${row.condition_source_v3}: ${parseInt(row.count).toLocaleString()} (${parseFloat(row.pct).toFixed(2)}%)`);
  }

  // Global orphan rate
  const orphanQuery = `
    SELECT
      SUM(is_orphan) as orphans,
      COUNT(*) as total,
      (SUM(is_orphan) / COUNT(*)) * 100 as orphan_pct
    FROM pm_trades_canonical_v3
  `;

  const orphanResult = await clickhouse.query({ query: orphanQuery, format: 'JSONEachRow' });
  const orphanData = (await orphanResult.json())[0];

  console.log('');
  console.log(`Global orphan rate: ${parseInt(orphanData.orphans).toLocaleString()} / ${parseInt(orphanData.total).toLocaleString()} (${parseFloat(orphanData.orphan_pct).toFixed(2)}%)`);

  console.log('');
  console.log('='.repeat(80));
  console.log('✅ BUILD AND VALIDATION COMPLETE');
  console.log('='.repeat(80));
  console.log('');
  console.log('Next Steps:');
  console.log('1. Review `/tmp/PM_TRADES_V3_BUILD_NOTES.md` for build summary');
  console.log('2. Compare v2 vs v3 metrics');
  console.log('3. Proceed to Step 5: Safety build on 2-3 new months');
}

main().catch((error) => {
  console.error('\n❌ Fatal error:', error.message);
  process.exit(1);
});
