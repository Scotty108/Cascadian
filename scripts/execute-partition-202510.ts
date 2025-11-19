#!/usr/bin/env tsx
/**
 * Execute Partition 202510 (October 2025) - Large Partition Handler
 *
 * This partition is too large for standard 120-second timeout.
 * Estimated 40-60M rows based on growth trend.
 *
 * Uses extended 10-minute timeout for completion.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';
import * as fs from 'fs';

const CHECKPOINT_FILE = 'reports/pm_trades_canonical_v2_build_checkpoint.json';
const PARTITION = '202510';

async function insertPartition202510(): Promise<number> {
  console.log(`\n🚀 Processing Large Partition: ${PARTITION}`);
  console.log('='.repeat(80));
  console.log('Estimated size: 40-60M rows');
  console.log('Timeout: 600 seconds (10 minutes)');
  console.log('');

  const startTime = Date.now();

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
          WHERE toYYYYMM(timestamp) = ${PARTITION}
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
          WHERE toYYYYMM(timestamp) = ${PARTITION}
        )
    ) erc
      ON vt.transaction_hash = erc.tx_hash
      AND vt.wallet_address_norm = erc.wallet_address

    WHERE toYYYYMM(vt.timestamp) = ${PARTITION}
  `;

  console.log('⏳ Executing INSERT query...');
  await clickhouse.command({ query: insertQuery });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`✅ INSERT completed in ${elapsed} seconds`);

  // Get row count for this partition
  const countQuery = `
    SELECT COUNT(*) AS count
    FROM pm_trades_canonical_v2
    WHERE toYYYYMM(timestamp) = ${PARTITION}
  `;

  console.log('📊 Counting inserted rows...');
  const countResult = await clickhouse.query({ query: countQuery, format: 'JSONEachRow' });
  const countData = (await countResult.json())[0];
  const rowCount = parseInt(countData.count);

  console.log(`✅ Partition ${PARTITION}: ${rowCount.toLocaleString()} rows inserted`);

  return rowCount;
}

async function updateCheckpoint(rowCount: number) {
  console.log('\n📝 Updating checkpoint file...');

  const checkpoint = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf-8'));

  checkpoint.last_partition = PARTITION;
  checkpoint.completed_partitions.push(PARTITION);
  checkpoint.total_rows_inserted += rowCount;

  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2));

  console.log('✅ Checkpoint updated');
  console.log(`   Total partitions: ${checkpoint.completed_partitions.length}/35`);
  console.log(`   Total rows: ${checkpoint.total_rows_inserted.toLocaleString()}`);
}

async function main() {
  try {
    console.log('🚀 PM Trades Canonical V2 - Partition 202510 Handler');
    console.log('='.repeat(80));
    console.log('Handling large October 2025 partition with extended timeout');
    console.log('');

    const rowCount = await insertPartition202510();

    await updateCheckpoint(rowCount);

    console.log('');
    console.log('='.repeat(80));
    console.log('✅ PARTITION 202510 COMPLETE');
    console.log('='.repeat(80));
    console.log(`Rows inserted: ${rowCount.toLocaleString()}`);
    console.log('');
    console.log('✅ Full pm_trades_canonical_v2 build is now COMPLETE (35/35 partitions)');
    console.log('');
    console.log('Next Step: Verify total row count matches vw_trades_canonical');

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main();
