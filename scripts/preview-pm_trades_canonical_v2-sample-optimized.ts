#!/usr/bin/env tsx
/**
 * Phase 1, Step 1.5: Preview pm_trades_canonical_v2 Sample (Optimized)
 *
 * Memory-optimized version that samples first, then decodes only for those tx_hashes
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
  console.log('🎯 Phase 1, Step 1.5: Preview pm_trades_canonical_v2 Sample (Optimized)');
  console.log('='.repeat(80));
  console.log('Testing full repair logic on 10,000 trades (memory-optimized)');
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
  // Step 1: Sample 10k trades first to get tx_hashes
  // ========================================================================

  console.log('Step 1: Sampling 10,000 random trades...');
  console.log('-'.repeat(80));

  const sampleQuery = `
    SELECT
      trade_id,
      wallet_address_norm,
      transaction_hash,
      condition_id_norm,
      outcome_index,
      shares,
      usd_value,
      timestamp
    FROM vw_trades_canonical
    ORDER BY rand()
    LIMIT 10000
  `;

  const sampleResult = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
  const sampleTrades = await sampleResult.json() as any[];

  console.log(`✓ Sampled ${sampleTrades.length} trades`);
  console.log('');

  // Extract unique tx_hashes
  const txHashes = [...new Set(sampleTrades.map(t => t.transaction_hash))];
  console.log(`✓ Found ${txHashes.length} unique tx_hashes`);
  console.log('');

  // ========================================================================
  // Step 2: Decode CLOB fills for sampled tx_hashes only
  // ========================================================================

  console.log('Step 2: Decoding CLOB fills for sampled transactions...');
  console.log('-'.repeat(80));

  const clobDecodeQuery = `
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
    WHERE
      asset_id IS NOT NULL
      AND asset_id != ''
      AND tx_hash IN (${txHashes.map(h => `'${h}'`).join(',')})
  `;

  const clobDecodeResult = await clickhouse.query({ query: clobDecodeQuery, format: 'JSONEachRow' });
  const clobDecoded = await clobDecodeResult.json() as any[];

  console.log(`✓ Decoded ${clobDecoded.length} CLOB fills`);
  console.log('');

  // Create lookup map: tx_hash+wallet -> decoded data
  const clobMap = new Map<string, any>();
  for (const row of clobDecoded) {
    const key = `${row.tx_hash}:${row.wallet_address.toLowerCase()}`;
    clobMap.set(key, row);
  }

  // ========================================================================
  // Step 3: Decode ERC1155 transfers for sampled tx_hashes only
  // ========================================================================

  console.log('Step 3: Decoding ERC1155 transfers for sampled transactions...');
  console.log('-'.repeat(80));

  const ercDecodeQuery = `
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
    WHERE
      token_id IS NOT NULL
      AND token_id != ''
      AND tx_hash IN (${txHashes.map(h => `'${h}'`).join(',')})
  `;

  const ercDecodeResult = await clickhouse.query({ query: ercDecodeQuery, format: 'JSONEachRow' });
  const ercDecoded = await ercDecodeResult.json() as any[];

  console.log(`✓ Decoded ${ercDecoded.length} ERC1155 transfers`);
  console.log('');

  // Create lookup map: tx_hash+wallet -> decoded data
  const ercMap = new Map<string, any>();
  for (const row of ercDecoded) {
    const key = `${row.tx_hash}:${row.wallet_address.toLowerCase()}`;
    ercMap.set(key, row);
  }

  // ========================================================================
  // Step 4: Apply repair logic to sampled trades
  // ========================================================================

  console.log('Step 4: Applying repair logic...');
  console.log('-'.repeat(80));

  const repairedTrades = sampleTrades.map(trade => {
    const key = `${trade.transaction_hash}:${trade.wallet_address_norm.toLowerCase()}`;
    const clobData = clobMap.get(key);
    const ercData = ercMap.get(key);

    // Original condition_id (if valid)
    const originalValid = trade.condition_id_norm &&
                         trade.condition_id_norm !== '' &&
                         trade.condition_id_norm !== '0x0000000000000000000000000000000000000000000000000000000000000000';

    // Repair logic: COALESCE(original, erc1155, clob)
    let condition_id_v2 = null;
    let outcome_index_v2 = -1;
    let id_repair_source = 'unknown';

    if (originalValid) {
      condition_id_v2 = trade.condition_id_norm;
      outcome_index_v2 = trade.outcome_index ?? -1;
      id_repair_source = 'original';
    } else if (ercData && ercData.condition_id_decoded) {
      condition_id_v2 = ercData.condition_id_decoded;
      outcome_index_v2 = ercData.outcome_index_decoded;
      id_repair_source = 'erc1155_decode';
    } else if (clobData && clobData.condition_id_decoded) {
      condition_id_v2 = clobData.condition_id_decoded;
      outcome_index_v2 = clobData.outcome_index_decoded;
      id_repair_source = 'clob_decode';
    }

    const is_orphan = condition_id_v2 ? 0 : 1;

    return {
      ...trade,
      condition_id_v2,
      outcome_index_v2,
      id_repair_source,
      is_orphan
    };
  });

  result.total_sampled = repairedTrades.length;
  result.sample_rows = repairedTrades.slice(0, 20);

  // Analyze repair coverage
  for (const row of repairedTrades) {
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

  console.log('✓ Repair logic applied');
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

  // ========================================================================
  // Wallet-Specific Samples
  // ========================================================================

  console.log('👤 Wallet-Specific Orphan Rates:');
  console.log('-'.repeat(80));

  // xcnstrategy
  const xcnTrades = repairedTrades.filter(t =>
    t.wallet_address_norm.toLowerCase() === '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
  );

  if (xcnTrades.length > 0) {
    const xcnOrphans = xcnTrades.filter(t => t.is_orphan === 1).length;
    const xcnOrphanPct = (xcnOrphans / xcnTrades.length) * 100;
    console.log(`  xcnstrategy:   ${xcnTrades.length} trades, ${xcnOrphans} orphans (${xcnOrphanPct.toFixed(2)}%)`);

    result.wallet_samples.xcnstrategy = {
      total_trades: xcnTrades.length,
      orphan_trades: xcnOrphans,
      orphan_pct: xcnOrphanPct
    };
  } else {
    console.log(`  xcnstrategy:   0 trades in sample`);
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
  console.log('  1. Review orphan patterns in preview report');
  console.log('  2. If ≥70% success: Execute full pm_trades_canonical_v2 population');
  console.log('  3. If <70% success: Investigate orphan causes and adjust repair logic');
}

main().catch(console.error);
