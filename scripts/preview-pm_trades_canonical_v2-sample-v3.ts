#!/usr/bin/env tsx
/**
 * Phase 1, Step 1.5: Preview pm_trades_canonical_v2 Sample (v3 - Temp Table)
 *
 * Uses temporary table to avoid query size limits
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
  };
  sample_rows: any[];
}

async function main() {
  console.log('🎯 Phase 1, Step 1.7: Run Pilot Preview (v3 - Smaller Sample)');
  console.log('='.repeat(80));
  console.log('Testing full repair logic on 1,000 trades (memory-optimized)');
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
  // Simplified Pilot: 1k sample with all logic in one query
  // ========================================================================

  console.log('Running pilot repair query on 1,000 random trades...');
  console.log('-'.repeat(80));

  // Simpler approach: Just sample and check original condition_id validity
  // Skip JOINs for initial pilot to avoid memory issues
  const pilotQuery = `
    SELECT
      trade_id,
      wallet_address_norm AS wallet_address,
      transaction_hash,
      condition_id_norm AS condition_id_orig,
      outcome_index AS outcome_index_orig,

      -- Check if original is valid
      CASE
        WHEN condition_id_norm IS NOT NULL
          AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
          AND condition_id_norm != ''
          THEN condition_id_norm
        ELSE NULL
      END AS condition_id_v2_original_only,

      -- Repair source (original only for now)
      CASE
        WHEN condition_id_norm IS NOT NULL
          AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
          AND condition_id_norm != ''
          THEN 'original'
        ELSE 'needs_repair'
      END AS id_repair_source,

      -- Orphan flag (if original only)
      CASE
        WHEN condition_id_norm IS NULL
          OR condition_id_norm = '0x0000000000000000000000000000000000000000000000000000000000000000'
          OR condition_id_norm = ''
          THEN 1
        ELSE 0
      END AS is_orphan_without_decode,

      shares,
      usd_value,
      timestamp

    FROM vw_trades_canonical
    ORDER BY rand()
    LIMIT 1000
  `;

  try {
    const queryResult = await clickhouse.query({ query: pilotQuery, format: 'JSONEachRow' });
    const rows = await queryResult.json() as any[];

    result.total_sampled = rows.length;
    result.sample_rows = rows.slice(0, 20);

    // Analyze what percentage needs repair
    let needsRepair = 0;
    for (const row of rows) {
      if (row.id_repair_source === 'original') {
        result.repair_coverage.original++;
      } else {
        needsRepair++;
      }

      if (row.is_orphan_without_decode === 1) {
        result.orphan_stats.total_orphans++;
      }
    }

    console.log(`✓ Pilot query complete: ${rows.length} trades sampled`);
    console.log('');

    // Print coverage stats (original only)
    console.log('📊 Current Coverage (without decode):');
    console.log('-'.repeat(80));
    console.log(`  Original valid:      ${result.repair_coverage.original.toLocaleString()} (${(result.repair_coverage.original / result.total_sampled * 100).toFixed(2)}%)`);
    console.log(`  Needs repair:        ${needsRepair.toLocaleString()} (${(needsRepair / result.total_sampled * 100).toFixed(2)}%)`);
    console.log('');
    console.log(`📉 Orphan Rate (without decode): ${(result.orphan_stats.total_orphans / result.total_sampled * 100).toFixed(2)}%`);
    console.log('');

    // Now test decode on a small subset of those that need repair
    console.log('Testing decode repair on trades that need repair...');
    console.log('-'.repeat(80));

    const needsRepairRows = rows.filter(r => r.id_repair_source === 'needs_repair').slice(0, 100);
    console.log(`  Found ${needsRepairRows.length} trades to test decode repair on`);

    let ercDecodeSuccess = 0;
    let clobDecodeSuccess = 0;
    let stillOrphan = 0;

    // Test ERC1155 decode on first 50
    if (needsRepairRows.length > 0) {
      const testTxHashes = needsRepairRows.slice(0, 50).map(r => r.transaction_hash);

      const ercTestQuery = `
        SELECT COUNT(*) AS count
        FROM erc1155_transfers
        WHERE token_id IS NOT NULL
          AND token_id != ''
          AND tx_hash IN (${testTxHashes.map(h => `'${h}'`).join(',')})
      `;

      try {
        const ercTestResult = await clickhouse.query({ query: ercTestQuery, format: 'JSONEachRow' });
        const ercTestData = (await ercTestResult.json())[0];
        ercDecodeSuccess = parseInt(ercTestData.count);
        console.log(`  ✓ ERC1155 decode: ${ercDecodeSuccess} / 50 trades have matching token_ids`);
      } catch (e: any) {
        console.log(`  ✗ ERC1155 test failed: ${e.message}`);
      }

      // Test CLOB decode on same 50
      const clobTestQuery = `
        SELECT COUNT(*) AS count
        FROM clob_fills
        WHERE asset_id IS NOT NULL
          AND asset_id != ''
          AND tx_hash IN (${testTxHashes.map(h => `'${h}'`).join(',')})
      `;

      try {
        const clobTestResult = await clickhouse.query({ query: clobTestQuery, format: 'JSONEachRow' });
        const clobTestData = (await clobTestResult.json())[0];
        clobDecodeSuccess = parseInt(clobTestData.count);
        console.log(`  ✓ CLOB decode: ${clobDecodeSuccess} / 50 trades have matching asset_ids`);
      } catch (e: any) {
        console.log(`  ✗ CLOB test failed: ${e.message}`);
      }

      stillOrphan = 50 - Math.min(ercDecodeSuccess + clobDecodeSuccess, 50);
      console.log(`  ✓ Estimated orphans after decode: ${stillOrphan} / 50`);
      console.log('');

      // Extrapolate to full dataset
      const totalNeedsRepair = needsRepair;
      const estimatedErcRepair = (ercDecodeSuccess / 50) * totalNeedsRepair;
      const estimatedClobRepair = (clobDecodeSuccess / 50) * totalNeedsRepair;
      const estimatedOrphans = (stillOrphan / 50) * totalNeedsRepair;

      result.repair_coverage.erc1155_decode = Math.round(estimatedErcRepair);
      result.repair_coverage.clob_decode = Math.round(estimatedClobRepair);
      result.repair_coverage.unknown = Math.round(estimatedOrphans);
      result.orphan_stats.total_orphans = Math.round(estimatedOrphans);
      result.orphan_stats.orphan_pct = (result.orphan_stats.total_orphans / result.total_sampled) * 100;

      console.log('📊 Estimated Full Coverage (with decode):');
      console.log('-'.repeat(80));
      console.log(`  Original valid:      ${result.repair_coverage.original.toLocaleString()} (${(result.repair_coverage.original / result.total_sampled * 100).toFixed(2)}%)`);
      console.log(`  ERC1155 decoded:     ~${result.repair_coverage.erc1155_decode.toLocaleString()} (${(result.repair_coverage.erc1155_decode / result.total_sampled * 100).toFixed(2)}%)`);
      console.log(`  CLOB decoded:        ~${result.repair_coverage.clob_decode.toLocaleString()} (${(result.repair_coverage.clob_decode / result.total_sampled * 100).toFixed(2)}%)`);
      console.log(`  Unknown (orphans):   ~${result.repair_coverage.unknown.toLocaleString()} (${(result.repair_coverage.unknown / result.total_sampled * 100).toFixed(2)}%)`);
      console.log('');
      console.log(`📉 Estimated Orphan Rate: ${result.orphan_stats.orphan_pct.toFixed(2)}%`);
      console.log('');
    }

  } catch (error: any) {
    console.error('❌ Error running pilot query:', error.message);
    throw error;
  }

  // ========================================================================
  // Wallet-Specific Samples
  // ========================================================================

  console.log('👤 Wallet-Specific Check (xcnstrategy):');
  console.log('-'.repeat(80));

  try {
    const xcnQuery = `
      SELECT
        '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b' AS wallet_address,
        COUNT(*) AS total_trades,
        SUM(CASE
          WHEN condition_id_norm IS NULL
            OR condition_id_norm = '0x0000000000000000000000000000000000000000000000000000000000000000'
            OR condition_id_norm = ''
            THEN 1
          ELSE 0
        END) AS orphan_trades_without_decode
      FROM vw_trades_canonical
      WHERE wallet_address_norm = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
    `;

    const xcnResult = await clickhouse.query({ query: xcnQuery, format: 'JSONEachRow' });
    const xcnData = (await xcnResult.json())[0];

    if (xcnData) {
      const orphanPct = (parseInt(xcnData.orphan_trades_without_decode) / parseInt(xcnData.total_trades)) * 100;
      console.log(`  xcnstrategy:   ${xcnData.total_trades} total trades, ${xcnData.orphan_trades_without_decode} need repair (${orphanPct.toFixed(2)}%)`);
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
    console.log(`✅ PASS: ${successRate.toFixed(2)}% repair success rate (target: ≥70%)`);
    console.log('   Ready to proceed with full 157M trade repair.');
  } else {
    console.log(`⚠️  WARNING: ${successRate.toFixed(2)}% repair success rate (target: ≥70%)`);
    console.log('   Review orphan patterns before proceeding to full repair.');
  }
  console.log('');
  console.log('Next Steps:');
  console.log('  1. If ≥70% success: Execute full pm_trades_canonical_v2 population');
  console.log('  2. If <70% success: Investigate orphan causes and adjust repair logic');
  console.log('');
  console.log('Note: This pilot used 1k sample with estimated decode coverage.');
  console.log('      Full execution will use actual JOINs for precise repair.');
}

main().catch(console.error);
