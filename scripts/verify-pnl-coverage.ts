#!/usr/bin/env npx tsx

/**
 * Step 2: P&L Reconciliation - Data Completeness & Join Coverage Analysis
 * Snapshot: 2025-10-31 23:59:59
 *
 * Verifies:
 * - 2A: Condition ID completeness in trades_raw
 * - 2B: Direct join coverage to winning_index
 * - 2C: Market bridge join coverage (fallback)
 * - 2D: Snapshot filtering impact
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const SNAPSHOT_CUTOFF = '2025-10-31 23:59:59';

const TARGET_WALLETS = {
  'HolyMoses7': '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
  'niggemon': '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
};

interface WalletStats {
  wallet_name: string;
  wallet_address: string;
  total_fills: number;
  nonempty_condition_id: number;
  condition_id_pct: number;
  direct_match_count: number;
  direct_match_pct: number;
  bridge_match_count: number;
  bridge_match_pct: number;
  snapshot_fills: number;
  snapshot_direct_match: number;
  snapshot_direct_pct: number;
  snapshot_bridge_match: number;
  snapshot_bridge_pct: number;
}

interface MissingFill {
  wallet: string;
  timestamp: string;
  market_id: string;
  condition_id: string;
  side: string;
  size: number;
  price: number;
}

async function runAnalysis() {
  const client = createClient({
    host: process.env.CLICKHOUSE_HOST,
    username: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD || '',
    database: process.env.CLICKHOUSE_DATABASE || 'default',
  });

  console.log('='.repeat(80));
  console.log('P&L RECONCILIATION - STEP 2: DATA COMPLETENESS & JOIN COVERAGE');
  console.log('='.repeat(80));
  console.log(`Snapshot cutoff: ${SNAPSHOT_CUTOFF}`);
  console.log(`Target wallets: ${Object.keys(TARGET_WALLETS).join(', ')}\n`);

  const results: WalletStats[] = [];
  const missingFills: MissingFill[] = [];

  for (const [name, address] of Object.entries(TARGET_WALLETS)) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`WALLET: ${name} (${address})`);
    console.log('='.repeat(80));

    // Step 2A: Condition ID Completeness
    console.log('\n--- Step 2A: Condition ID Completeness ---');
    const completenessQuery = `
      SELECT
        COUNT(*) as total_fills,
        countIf(condition_id != '' AND condition_id IS NOT NULL) as nonempty_condition_id
      FROM trades_raw
      WHERE lower(wallet_address) = lower('${address}')
    `;

    const completenessResult = await client.query({
      query: completenessQuery,
      format: 'JSONEachRow'
    });
    const completeness = (await completenessResult.json() as any)[0];
    const totalFills = parseInt(completeness.total_fills);
    const nonemptyConditionId = parseInt(completeness.nonempty_condition_id);
    const conditionIdPct = totalFills > 0 ? (nonemptyConditionId / totalFills * 100) : 0;

    console.log(`  Total fills: ${totalFills.toLocaleString()}`);
    console.log(`  Fills with condition_id: ${nonemptyConditionId.toLocaleString()}`);
    console.log(`  Coverage: ${conditionIdPct.toFixed(2)}%`);
    console.log(`  Target: 95%+ - ${conditionIdPct >= 95 ? '✓ PASS' : '✗ FAIL'}`);

    // Step 2B: Direct Join Coverage to market_resolutions_final
    console.log('\n--- Step 2B: Direct Join Coverage to market_resolutions_final ---');
    const directJoinQuery = `
      SELECT
        COUNT(*) as match_count
      FROM trades_raw tr
      INNER JOIN market_resolutions_final mrf
        ON lower(replaceAll(tr.condition_id, '0x', '')) = mrf.condition_id_norm
      WHERE lower(tr.wallet_address) = lower('${address}')
    `;

    const directJoinResult = await client.query({
      query: directJoinQuery,
      format: 'JSONEachRow'
    });
    const directMatch = (await directJoinResult.json() as any)[0];
    const directMatchCount = parseInt(directMatch.match_count);
    const directMatchPct = totalFills > 0 ? (directMatchCount / totalFills * 100) : 0;

    console.log(`  Direct matches: ${directMatchCount.toLocaleString()}`);
    console.log(`  Total fills: ${totalFills.toLocaleString()}`);
    console.log(`  Direct coverage: ${directMatchPct.toFixed(2)}%`);
    console.log(`  Target: 95%+ - ${directMatchPct >= 95 ? '✓ PASS' : '✗ FAIL'}`);

    // Step 2C: Market Bridge Join Coverage (if needed)
    console.log('\n--- Step 2C: Market Bridge Join Coverage ---');
    const bridgeJoinQuery = `
      SELECT
        COUNT(*) as match_count
      FROM trades_raw tr
      LEFT JOIN canonical_condition cc
        ON tr.market_id = cc.market_id
      INNER JOIN market_resolutions_final mrf
        ON COALESCE(lower(replaceAll(tr.condition_id, '0x', '')), cc.condition_id_norm) = mrf.condition_id_norm
      WHERE lower(tr.wallet_address) = lower('${address}')
    `;

    const bridgeJoinResult = await client.query({
      query: bridgeJoinQuery,
      format: 'JSONEachRow'
    });
    const bridgeMatch = (await bridgeJoinResult.json() as any)[0];
    const bridgeMatchCount = parseInt(bridgeMatch.match_count);
    const bridgeMatchPct = totalFills > 0 ? (bridgeMatchCount / totalFills * 100) : 0;

    console.log(`  Bridge matches: ${bridgeMatchCount.toLocaleString()}`);
    console.log(`  Total fills: ${totalFills.toLocaleString()}`);
    console.log(`  Bridge coverage: ${bridgeMatchPct.toFixed(2)}%`);
    console.log(`  Improvement: +${(bridgeMatchPct - directMatchPct).toFixed(2)}%`);
    console.log(`  Target: 95%+ - ${bridgeMatchPct >= 95 ? '✓ PASS' : '✗ FAIL'}`);

    // Step 2D: Snapshot Filtering
    console.log('\n--- Step 2D: Snapshot Filtering ---');
    const snapshotQuery = `
      SELECT
        COUNT(*) as snapshot_fills,
        countIf(direct_match = 1) as snapshot_direct_match,
        countIf(bridge_match = 1) as snapshot_bridge_match
      FROM (
        SELECT
          tr.*,
          if(replaceAll(mrf_direct.condition_id_norm, '\\0', '') != '', 1, 0) as direct_match,
          if(replaceAll(mrf_bridge.condition_id_norm, '\\0', '') != '', 1, 0) as bridge_match
        FROM trades_raw tr
        LEFT JOIN market_resolutions_final mrf_direct
          ON lower(replaceAll(tr.condition_id, '0x', '')) = mrf_direct.condition_id_norm
        LEFT JOIN canonical_condition cc
          ON tr.market_id = cc.market_id
        LEFT JOIN market_resolutions_final mrf_bridge
          ON COALESCE(lower(replaceAll(tr.condition_id, '0x', '')), cc.condition_id_norm) = mrf_bridge.condition_id_norm
        WHERE lower(tr.wallet_address) = lower('${address}')
          AND tr.timestamp <= toDateTime('${SNAPSHOT_CUTOFF}')
      )
    `;

    const snapshotResult = await client.query({
      query: snapshotQuery,
      format: 'JSONEachRow'
    });
    const snapshot = (await snapshotResult.json() as any)[0];
    const snapshotFills = parseInt(snapshot.snapshot_fills);
    const snapshotDirectMatch = parseInt(snapshot.snapshot_direct_match);
    const snapshotBridgeMatch = parseInt(snapshot.snapshot_bridge_match);
    const snapshotDirectPct = snapshotFills > 0 ? (snapshotDirectMatch / snapshotFills * 100) : 0;
    const snapshotBridgePct = snapshotFills > 0 ? (snapshotBridgeMatch / snapshotFills * 100) : 0;

    console.log(`  Fills at snapshot: ${snapshotFills.toLocaleString()}`);
    console.log(`  Percent of total: ${totalFills > 0 ? (snapshotFills / totalFills * 100).toFixed(2) : 0}%`);
    console.log(`  Direct matches at snapshot: ${snapshotDirectMatch.toLocaleString()} (${snapshotDirectPct.toFixed(2)}%)`);
    console.log(`  Bridge matches at snapshot: ${snapshotBridgeMatch.toLocaleString()} (${snapshotBridgePct.toFixed(2)}%)`);
    console.log(`  Target: 95%+ - ${snapshotBridgePct >= 95 ? '✓ PASS' : '✗ FAIL'}`);

    // Store results
    results.push({
      wallet_name: name,
      wallet_address: address,
      total_fills: totalFills,
      nonempty_condition_id: nonemptyConditionId,
      condition_id_pct: conditionIdPct,
      direct_match_count: directMatchCount,
      direct_match_pct: directMatchPct,
      bridge_match_count: bridgeMatchCount,
      bridge_match_pct: bridgeMatchPct,
      snapshot_fills: snapshotFills,
      snapshot_direct_match: snapshotDirectMatch,
      snapshot_direct_pct: snapshotDirectPct,
      snapshot_bridge_match: snapshotBridgeMatch,
      snapshot_bridge_pct: snapshotBridgePct
    });

    // If coverage is still < 95%, collect example missing fills
    if (bridgeMatchPct < 95) {
      console.log('\n--- Missing Fills Sample (5 examples) ---');
      const missingQuery = `
        SELECT
          '${name}' as wallet,
          toString(tr.timestamp) as timestamp,
          tr.market_id,
          tr.condition_id,
          toString(tr.side) as side,
          tr.shares as size,
          tr.entry_price as price
        FROM trades_raw tr
        LEFT JOIN canonical_condition cc
          ON tr.market_id = cc.market_id
        LEFT JOIN market_resolutions_final mrf
          ON COALESCE(lower(replaceAll(tr.condition_id, '0x', '')), cc.condition_id_norm) = mrf.condition_id_norm
        WHERE lower(tr.wallet_address) = lower('${address}')
          AND replaceAll(mrf.condition_id_norm, '\\0', '') = ''
        ORDER BY tr.timestamp DESC
        LIMIT 5
      `;

      const missingResult = await client.query({
        query: missingQuery,
        format: 'JSONEachRow'
      });
      const missing = await missingResult.json() as any[];

      missing.forEach((fill: any, idx: number) => {
        console.log(`  ${idx + 1}. ${fill.timestamp} | Market: ${fill.market_id} | Condition: ${fill.condition_id || 'NULL'} | ${fill.side} ${fill.size} @ ${fill.price}`);
        missingFills.push(fill);
      });
    }
  }

  // Summary Report
  console.log('\n\n');
  console.log('='.repeat(80));
  console.log('SUMMARY REPORT');
  console.log('='.repeat(80));
  console.log('\nPer-Wallet Results:');
  console.log('-'.repeat(80));

  results.forEach(r => {
    console.log(`\n${r.wallet_name} (${r.wallet_address}):`);
    console.log(`  Total fills: ${r.total_fills.toLocaleString()}`);
    console.log(`  Fills with condition_id: ${r.nonempty_condition_id.toLocaleString()} (${r.condition_id_pct.toFixed(2)}%)`);
    console.log(`  Direct match coverage: ${r.direct_match_count.toLocaleString()} (${r.direct_match_pct.toFixed(2)}%)`);
    console.log(`  Bridge match coverage: ${r.bridge_match_count.toLocaleString()} (${r.bridge_match_pct.toFixed(2)}%)`);
    console.log(`  Snapshot fills: ${r.snapshot_fills.toLocaleString()}`);
    console.log(`  Snapshot direct coverage: ${r.snapshot_direct_match.toLocaleString()} (${r.snapshot_direct_pct.toFixed(2)}%)`);
    console.log(`  Snapshot bridge coverage: ${r.snapshot_bridge_match.toLocaleString()} (${r.snapshot_bridge_pct.toFixed(2)}%)`);

    const passAll = r.condition_id_pct >= 95 && r.snapshot_bridge_pct >= 95;
    console.log(`  Status: ${passAll ? '✓ PASS' : '✗ FAIL'}`);
  });

  // Overall status
  const allPass = results.every(r => r.condition_id_pct >= 95 && r.snapshot_bridge_pct >= 95);
  console.log('\n' + '='.repeat(80));
  console.log(`OVERALL STATUS: ${allPass ? '✓ ALL TARGETS MET' : '✗ COVERAGE BELOW 95%'}`);
  console.log('='.repeat(80));

  if (!allPass) {
    console.log('\nACTION REQUIRED: Coverage below 95% threshold');
    console.log(`Missing fills sample count: ${missingFills.length}`);
  } else {
    console.log('\n✓ Data completeness verified');
    console.log('✓ Join coverage meets 95%+ target');
    console.log('✓ Ready for P&L reconciliation');
  }

  await client.close();
}

// Execute
runAnalysis().catch(err => {
  console.error('Error running analysis:', err);
  process.exit(1);
});
