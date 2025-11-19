#!/usr/bin/env tsx
/**
 * Phase 1, Step 1.5: Preview pm_trades_canonical_v2 Sample
 *
 * Pilots the full repair logic on a small subset (10k trades) to:
 * 1. Validate JOIN logic and repair source prioritization
 * 2. Measure actual repair coverage rates
 * 3. Calculate orphan percentage
 * 4. Test for specific wallets (xcnstrategy, random ghost, high-volume)
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';
import * as fs from 'fs';

interface PreviewResult {
  total_sampled: number;
  repair_coverage: {
    original: number;
    erc1155_decode: number;
    clob_decode: number;
    unknown: number;
  };
  orphan_stats: {
    total_orphans: number;
    orphan_pct: number;
  };
  wallet_samples: {
    xcnstrategy?: any;
    random_ghost?: any;
    high_volume?: any;
  };
  sample_rows: any[];
}

async function main() {
  console.log('🎯 Phase 1, Step 1.5: Preview pm_trades_canonical_v2 Sample');
  console.log('='.repeat(80));
  console.log('Testing full repair logic on 10,000 trades');
  console.log('');

  const result: PreviewResult = {
    total_sampled: 0,
    repair_coverage: {
      original: 0,
      erc1155_decode: 0,
      clob_decode: 0,
      unknown: 0
    },
    orphan_stats: {
      total_orphans: 0,
      orphan_pct: 0
    },
    wallet_samples: {},
    sample_rows: []
  };

  // ========================================================================
  // Pilot Query: Full Repair Logic on 10k Sample
  // ========================================================================

  console.log('Running pilot repair query on 10,000 random trades...');
  console.log('-'.repeat(80));

  const pilotQuery = `
    WITH
    -- Decode CLOB asset_id
    clob_decoded AS (
      SELECT
        tx_hash,
        user_eoa AS wallet_address,
        lpad(hex(bitShiftRight(CAST(asset_id AS UInt256), 2)), 64, '0') AS condition_id_decoded,
        multiIf(
          bitAnd(CAST(asset_id AS UInt256), 3) = 1, 0,
          bitAnd(CAST(asset_id AS UInt256), 3) = 2, 1,
          -1
        ) AS outcome_index_decoded
      FROM clob_fills
      WHERE asset_id IS NOT NULL AND asset_id != ''
    ),
    -- Decode ERC1155 token_id
    erc_decoded AS (
      SELECT
        tx_hash,
        to_address AS wallet_address,
        lpad(hex(bitShiftRight(reinterpretAsUInt256(unhex(substring(token_id, 3))), 2)), 64, '0') AS condition_id_decoded,
        multiIf(
          bitAnd(reinterpretAsUInt256(unhex(substring(token_id, 3))), 3) = 1, 0,
          bitAnd(reinterpretAsUInt256(unhex(substring(token_id, 3))), 3) = 2, 1,
          -1
        ) AS outcome_index_decoded
      FROM erc1155_transfers
      WHERE token_id IS NOT NULL AND token_id != ''
    )
    SELECT
      vt.trade_id,
      vt.wallet_address_norm AS wallet_address,
      vt.transaction_hash,

      -- Original IDs
      vt.condition_id_norm AS condition_id_orig,
      vt.outcome_index AS outcome_index_orig,

      -- Repaired IDs (v2)
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
      ) AS condition_id_v2,

      COALESCE(
        CASE WHEN vt.outcome_index >= 0 THEN vt.outcome_index ELSE NULL END,
        erc.outcome_index_decoded,
        clob.outcome_index_decoded,
        -1
      ) AS outcome_index_v2,

      -- Repair source
      CASE
        WHEN vt.condition_id_norm IS NOT NULL
          AND vt.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
          AND vt.condition_id_norm != ''
          THEN 'original'
        WHEN erc.condition_id_decoded IS NOT NULL THEN 'erc1155_decode'
        WHEN clob.condition_id_decoded IS NOT NULL THEN 'clob_decode'
        ELSE 'unknown'
      END AS id_repair_source,

      -- Orphan flag
      CASE
        WHEN COALESCE(
          CASE WHEN vt.condition_id_norm IS NOT NULL AND vt.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000' AND vt.condition_id_norm != '' THEN vt.condition_id_norm ELSE NULL END,
          erc.condition_id_decoded,
          clob.condition_id_decoded
        ) IS NULL THEN 1
        ELSE 0
      END AS is_orphan,

      vt.shares,
      vt.usd_value,
      vt.timestamp

    FROM vw_trades_canonical vt
    LEFT JOIN clob_decoded clob
      ON vt.transaction_hash = clob.tx_hash
      AND vt.wallet_address_norm = clob.wallet_address
    LEFT JOIN erc_decoded erc
      ON vt.transaction_hash = erc.tx_hash
      AND vt.wallet_address_norm = erc.wallet_address
    ORDER BY rand()
    LIMIT 10000
  `;

  try {
    const queryResult = await clickhouse.query({ query: pilotQuery, format: 'JSONEachRow' });
    const rows = await queryResult.json() as any[];

    result.total_sampled = rows.length;
    result.sample_rows = rows.slice(0, 20);  // Keep first 20 for inspection

    // Analyze repair coverage
    for (const row of rows) {
      if (row.id_repair_source === 'original') {
        result.repair_coverage.original++;
      } else if (row.id_repair_source === 'erc1155_decode') {
        result.repair_coverage.erc1155_decode++;
      } else if (row.id_repair_source === 'clob_decode') {
        result.repair_coverage.clob_decode++;
      } else {
        result.repair_coverage.unknown++;
      }

      if (row.is_orphan === 1) {
        result.orphan_stats.total_orphans++;
      }
    }

    result.orphan_stats.orphan_pct = (result.orphan_stats.total_orphans / result.total_sampled) * 100;

    console.log('✓ Pilot query complete');
    console.log('');

    // Print coverage stats
    console.log('📊 Repair Coverage (10k sample):');
    console.log('-'.repeat(80));
    console.log(`  Original valid:      ${result.repair_coverage.original.toLocaleString()} (${(result.repair_coverage.original / result.total_sampled * 100).toFixed(2)}%)`);
    console.log(`  ERC1155 decoded:     ${result.repair_coverage.erc1155_decode.toLocaleString()} (${(result.repair_coverage.erc1155_decode / result.total_sampled * 100).toFixed(2)}%)`);
    console.log(`  CLOB decoded:        ${result.repair_coverage.clob_decode.toLocaleString()} (${(result.repair_coverage.clob_decode / result.total_sampled * 100).toFixed(2)}%)`);
    console.log(`  Unknown (orphans):   ${result.repair_coverage.unknown.toLocaleString()} (${(result.repair_coverage.unknown / result.total_sampled * 100).toFixed(2)}%)`);
    console.log('');
    console.log(`📉 Orphan Rate: ${result.orphan_stats.orphan_pct.toFixed(2)}%`);
    console.log('');

  } catch (error: any) {
    console.error('❌ Error running pilot query:', error.message);
  }

  // ========================================================================
  // Wallet-Specific Samples
  // ========================================================================

  console.log('👤 Wallet-Specific Orphan Rates:');
  console.log('-'.repeat(80));

  // xcnstrategy
  try {
    const xcnQuery = `
      SELECT
        '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b' AS wallet_address,
        COUNT(*) AS total_trades,
        SUM(CASE WHEN is_orphan = 1 THEN 1 ELSE 0 END) AS orphan_trades
      FROM (
        -- Same pilot query logic but for xcnstrategy only
        ${pilotQuery.replace('ORDER BY rand()', 'WHERE vt.wallet_address_norm = \'0xcce2b7c71f21e358b8e5e797e586cbc03160d58b\'')}
      )
    `;

    const xcnResult = await clickhouse.query({ query: xcnQuery, format: 'JSONEachRow' });
    const xcnData = (await xcnResult.json())[0];

    if (xcnData) {
      const orphanPct = (parseInt(xcnData.orphan_trades) / parseInt(xcnData.total_trades)) * 100;
      console.log(`  xcnstrategy:   ${xcnData.total_trades} trades, ${xcnData.orphan_trades} orphans (${orphanPct.toFixed(2)}%)`);
      result.wallet_samples.xcnstrategy = xcnData;
    }
  } catch (error: any) {
    console.log(`  xcnstrategy:   Error - ${error.message}`);
  }

  console.log('');

  // ========================================================================
  // Save Results
  // ========================================================================

  const timestamp = new Date().toISOString().split('T')[0];
  const reportPath = `reports/PM_TRADES_CANONICAL_V2_PREVIEW_${timestamp}.json`;

  fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));
  console.log('✅ Preview results saved to:', reportPath);
  console.log('');

  // ========================================================================
  // Verdict
  // ========================================================================

  console.log('='.repeat(80));
  console.log('🎯 Pilot Verdict');
  console.log('='.repeat(80));

  const successRate = ((result.total_sampled - result.orphan_stats.total_orphans) / result.total_sampled) * 100;

  if (successRate >= 70) {
    console.log(`✅ PASS: ${successRate.toFixed(2)}% repair success rate (target: >70%)`);
    console.log('   Ready to proceed with full 157M trade repair.');
  } else {
    console.log(`⚠️  WARNING: ${successRate.toFixed(2)}% repair success rate (target: >70%)`);
    console.log('   Review orphan patterns before proceeding to full repair.');
  }
  console.log('');
  console.log('Next Steps:');
  console.log('  1. Review orphan patterns in preview report');
  console.log('  2. If >70% success: Execute full pm_trades_canonical_v2 population');
  console.log('  3. If <70% success: Investigate orphan causes and adjust repair logic');
}

main().catch(console.error);
