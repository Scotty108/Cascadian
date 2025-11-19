import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';
import { writeFileSync } from 'fs';

interface TestResult {
  source: string;
  joinStrategy: string;
  totalOrphans: number;
  canRepair: number;
  repairPct: number;
  uniqueTxRepaired: number;
  ambiguousJoins: number;
  validConditionIds: number;
}

async function completeOrphanRepairTest() {
  console.log('PHASE 3: Complete Orphan Repair Test\n');
  console.log('='.repeat(80) + '\n');

  // PHASE 3A: Create orphan sample in a persistent table
  console.log('Phase 3A: Creating orphan sample (using Log engine for persistence)...\n');

  await clickhouse.command({
    query: 'DROP TABLE IF EXISTS tmp_v3_orphans_oct2024_persistent'
  });

  await clickhouse.command({
    query: `
      CREATE TABLE tmp_v3_orphans_oct2024_persistent
      ENGINE = MergeTree()
      ORDER BY transaction_hash AS
      SELECT
        transaction_hash,
        wallet_address,
        outcome_index_v2,
        timestamp,
        id_repair_source,
        market_id_norm_v2,
        trade_direction,
        shares,
        price
      FROM pm_trades_canonical_v3_sandbox
      WHERE toYYYYMM(timestamp) = 202410
        AND (condition_id_norm_v2 IS NULL
             OR condition_id_norm_v2 = ''
             OR condition_id_norm_v2 = '0000000000000000000000000000000000000000000000000000000000000000')
      LIMIT 10000
    `
  });

  const countResult = await clickhouse.query({
    query: 'SELECT count() as cnt FROM tmp_v3_orphans_oct2024_persistent',
    format: 'JSONEachRow'
  });
  const count = await countResult.json();
  console.log(`✓ Created tmp_v3_orphans_oct2024_persistent with ${count[0].cnt} orphans\n`);

  // Get a sample
  const sampleResult = await clickhouse.query({
    query: 'SELECT * FROM tmp_v3_orphans_oct2024_persistent LIMIT 3',
    format: 'JSONEachRow'
  });
  const sample = await sampleResult.json();
  console.log('Sample orphans:');
  console.log(JSON.stringify(sample, null, 2));

  // PHASE 3B: Test candidate sources
  console.log('\n' + '='.repeat(80));
  console.log('Phase 3B: Testing Candidate Sources\n');

  const results: TestResult[] = [];

  // Test 1: vw_trades_canonical (tx_hash + wallet)
  console.log('Test 1: vw_trades_canonical (tx_hash + wallet)...');
  try {
    const vtc1Result = await clickhouse.query({
      query: `
        SELECT
          count() AS total_orphans,
          countIf(vtc.condition_id_norm IS NOT NULL
                  AND vtc.condition_id_norm != ''
                  AND vtc.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
                  AND length(replace(vtc.condition_id_norm, '0x', '')) = 64) AS can_repair,
          round(100.0 * can_repair / total_orphans, 2) AS repair_pct,
          count(DISTINCT CASE
            WHEN vtc.condition_id_norm IS NOT NULL
              AND vtc.condition_id_norm != ''
              AND vtc.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
            THEN o.transaction_hash
          END) AS unique_tx_repaired
        FROM tmp_v3_orphans_oct2024_persistent o
        LEFT JOIN vw_trades_canonical vtc
          ON o.transaction_hash = vtc.transaction_hash
          AND o.wallet_address = vtc.wallet_address_norm
      `,
      format: 'JSONEachRow'
    });
    const vtc1 = await vtc1Result.json();

    results.push({
      source: 'vw_trades_canonical',
      joinStrategy: 'tx_hash + wallet',
      totalOrphans: vtc1[0].total_orphans,
      canRepair: vtc1[0].can_repair,
      repairPct: vtc1[0].repair_pct,
      uniqueTxRepaired: vtc1[0].unique_tx_repaired,
      ambiguousJoins: 0,
      validConditionIds: vtc1[0].can_repair
    });

    console.log(`   ✓ Can repair: ${vtc1[0].can_repair}/${vtc1[0].total_orphans} (${vtc1[0].repair_pct}%)`);
    console.log(`   ✓ Unique TXs repaired: ${vtc1[0].unique_tx_repaired}`);
  } catch (error) {
    console.log(`   ✗ Error: ${error.message}`);
  }

  // Test 2: vw_trades_canonical (tx_hash only)
  console.log('\nTest 2: vw_trades_canonical (tx_hash only)...');
  try {
    const vtc2Result = await clickhouse.query({
      query: `
        SELECT
          count() AS total_orphans,
          countIf(vtc.condition_id_norm IS NOT NULL
                  AND vtc.condition_id_norm != ''
                  AND vtc.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
                  AND length(replace(vtc.condition_id_norm, '0x', '')) = 64) AS can_repair,
          round(100.0 * can_repair / total_orphans, 2) AS repair_pct,
          count(DISTINCT CASE
            WHEN vtc.condition_id_norm IS NOT NULL
              AND vtc.condition_id_norm != ''
              AND vtc.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
            THEN o.transaction_hash
          END) AS unique_tx_repaired,
          -- Check for multi-match ambiguity
          countIf(vtc_count > 1) AS ambiguous_joins
        FROM tmp_v3_orphans_oct2024_persistent o
        LEFT JOIN vw_trades_canonical vtc
          ON o.transaction_hash = vtc.transaction_hash
        LEFT JOIN (
          SELECT transaction_hash, count() as vtc_count
          FROM vw_trades_canonical
          WHERE transaction_hash IN (SELECT transaction_hash FROM tmp_v3_orphans_oct2024_persistent)
          GROUP BY transaction_hash
          HAVING vtc_count > 1
        ) vtc_dup
          ON o.transaction_hash = vtc_dup.transaction_hash
      `,
      format: 'JSONEachRow'
    });
    const vtc2 = await vtc2Result.json();

    results.push({
      source: 'vw_trades_canonical',
      joinStrategy: 'tx_hash only',
      totalOrphans: vtc2[0].total_orphans,
      canRepair: vtc2[0].can_repair,
      repairPct: vtc2[0].repair_pct,
      uniqueTxRepaired: vtc2[0].unique_tx_repaired,
      ambiguousJoins: vtc2[0].ambiguous_joins,
      validConditionIds: vtc2[0].can_repair
    });

    console.log(`   ✓ Can repair: ${vtc2[0].can_repair}/${vtc2[0].total_orphans} (${vtc2[0].repair_pct}%)`);
    console.log(`   ✓ Unique TXs repaired: ${vtc2[0].unique_tx_repaired}`);
    console.log(`   ⚠ Ambiguous joins: ${vtc2[0].ambiguous_joins}`);
  } catch (error) {
    console.log(`   ✗ Error: ${error.message}`);
  }

  // Test 3: trades_cid_map_v2_merged (tx_hash only)
  console.log('\nTest 3: trades_cid_map_v2_merged (tx_hash only)...');
  try {
    const tcmResult = await clickhouse.query({
      query: `
        SELECT
          count() AS total_orphans,
          countIf(tcm.condition_id_norm IS NOT NULL
                  AND tcm.condition_id_norm != ''
                  AND length(tcm.condition_id_norm) = 64) AS can_repair,
          round(100.0 * can_repair / total_orphans, 2) AS repair_pct,
          count(DISTINCT CASE
            WHEN tcm.condition_id_norm IS NOT NULL
              AND tcm.condition_id_norm != ''
            THEN o.transaction_hash
          END) AS unique_tx_repaired,
          countIf(tcm_count > 1) AS ambiguous_joins
        FROM tmp_v3_orphans_oct2024_persistent o
        LEFT JOIN trades_cid_map_v2_merged tcm
          ON o.transaction_hash = tcm.transaction_hash
        LEFT JOIN (
          SELECT transaction_hash, count() as tcm_count
          FROM trades_cid_map_v2_merged
          WHERE transaction_hash IN (SELECT transaction_hash FROM tmp_v3_orphans_oct2024_persistent)
          GROUP BY transaction_hash
          HAVING tcm_count > 1
        ) tcm_dup
          ON o.transaction_hash = tcm_dup.transaction_hash
      `,
      format: 'JSONEachRow'
    });
    const tcm = await tcmResult.json();

    results.push({
      source: 'trades_cid_map_v2_merged',
      joinStrategy: 'tx_hash only',
      totalOrphans: tcm[0].total_orphans,
      canRepair: tcm[0].can_repair,
      repairPct: tcm[0].repair_pct,
      uniqueTxRepaired: tcm[0].unique_tx_repaired,
      ambiguousJoins: tcm[0].ambiguous_joins,
      validConditionIds: tcm[0].can_repair
    });

    console.log(`   ✓ Can repair: ${tcm[0].can_repair}/${tcm[0].total_orphans} (${tcm[0].repair_pct}%)`);
    console.log(`   ✓ Unique TXs repaired: ${tcm[0].unique_tx_repaired}`);
    console.log(`   ⚠ Ambiguous joins: ${tcm[0].ambiguous_joins}`);
  } catch (error) {
    console.log(`   ✗ Error: ${error.message}`);
  }

  // Test 4: trades_cid_map_v2_twd (tx_hash only)
  console.log('\nTest 4: trades_cid_map_v2_twd (tx_hash only)...');
  try {
    const tctResult = await clickhouse.query({
      query: `
        SELECT
          count() AS total_orphans,
          countIf(tct.condition_id_norm IS NOT NULL
                  AND tct.condition_id_norm != ''
                  AND length(tct.condition_id_norm) = 64) AS can_repair,
          round(100.0 * can_repair / total_orphans, 2) AS repair_pct,
          count(DISTINCT CASE
            WHEN tct.condition_id_norm IS NOT NULL
              AND tct.condition_id_norm != ''
            THEN o.transaction_hash
          END) AS unique_tx_repaired,
          countIf(tct_count > 1) AS ambiguous_joins
        FROM tmp_v3_orphans_oct2024_persistent o
        LEFT JOIN trades_cid_map_v2_twd tct
          ON o.transaction_hash = tct.transaction_hash
        LEFT JOIN (
          SELECT transaction_hash, count() as tct_count
          FROM trades_cid_map_v2_twd
          WHERE transaction_hash IN (SELECT transaction_hash FROM tmp_v3_orphans_oct2024_persistent)
          GROUP BY transaction_hash
          HAVING tct_count > 1
        ) tct_dup
          ON o.transaction_hash = tct_dup.transaction_hash
      `,
      format: 'JSONEachRow'
    });
    const tct = await tctResult.json();

    results.push({
      source: 'trades_cid_map_v2_twd',
      joinStrategy: 'tx_hash only',
      totalOrphans: tct[0].total_orphans,
      canRepair: tct[0].can_repair,
      repairPct: tct[0].repair_pct,
      uniqueTxRepaired: tct[0].unique_tx_repaired,
      ambiguousJoins: tct[0].ambiguous_joins,
      validConditionIds: tct[0].can_repair
    });

    console.log(`   ✓ Can repair: ${tct[0].can_repair}/${tct[0].total_orphans} (${tct[0].repair_pct}%)`);
    console.log(`   ✓ Unique TXs repaired: ${tct[0].unique_tx_repaired}`);
    console.log(`   ⚠ Ambiguous joins: ${tct[0].ambiguous_joins}`);
  } catch (error) {
    console.log(`   ✗ Error: ${error.message}`);
  }

  // PHASE 3C: Multi-source overlap analysis
  console.log('\n' + '='.repeat(80));
  console.log('Phase 3C: Multi-Source Overlap Analysis\n');

  console.log('Testing overlap between top 2 candidates...');
  try {
    const overlapResult = await clickhouse.query({
      query: `
        SELECT
          count() AS total_orphans,
          countIf(vtc.condition_id_norm IS NOT NULL
                  AND vtc.condition_id_norm != ''
                  AND vtc.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
                  AND length(replace(vtc.condition_id_norm, '0x', '')) = 64) AS vtc_repairs,
          countIf(tcm.condition_id_norm IS NOT NULL
                  AND tcm.condition_id_norm != ''
                  AND length(tcm.condition_id_norm) = 64) AS tcm_repairs,
          countIf(
            vtc.condition_id_norm IS NOT NULL
              AND vtc.condition_id_norm != ''
              AND vtc.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
              AND length(replace(vtc.condition_id_norm, '0x', '')) = 64
            AND tcm.condition_id_norm IS NOT NULL
              AND tcm.condition_id_norm != ''
              AND length(tcm.condition_id_norm) = 64
          ) AS both_repair,
          countIf(
            (vtc.condition_id_norm IS NULL
              OR vtc.condition_id_norm = ''
              OR vtc.condition_id_norm = '0x0000000000000000000000000000000000000000000000000000000000000000'
              OR length(replace(vtc.condition_id_norm, '0x', '')) != 64)
            AND tcm.condition_id_norm IS NOT NULL
              AND tcm.condition_id_norm != ''
              AND length(tcm.condition_id_norm) = 64
          ) AS tcm_unique,
          countIf(
            vtc.condition_id_norm IS NOT NULL
              AND vtc.condition_id_norm != ''
              AND vtc.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
              AND length(replace(vtc.condition_id_norm, '0x', '')) = 64
            AND (tcm.condition_id_norm IS NULL
              OR tcm.condition_id_norm = ''
              OR length(tcm.condition_id_norm) != 64)
          ) AS vtc_unique
        FROM tmp_v3_orphans_oct2024_persistent o
        LEFT JOIN vw_trades_canonical vtc
          ON o.transaction_hash = vtc.transaction_hash
        LEFT JOIN trades_cid_map_v2_merged tcm
          ON o.transaction_hash = tcm.transaction_hash
      `,
      format: 'JSONEachRow'
    });
    const overlap = await overlapResult.json();

    console.log(`   Total orphans: ${overlap[0].total_orphans}`);
    console.log(`   vw_trades_canonical repairs: ${overlap[0].vtc_repairs}`);
    console.log(`   trades_cid_map_v2_merged repairs: ${overlap[0].tcm_repairs}`);
    console.log(`   Both repair (overlap): ${overlap[0].both_repair}`);
    console.log(`   trades_cid_map_v2_merged unique: ${overlap[0].tcm_unique}`);
    console.log(`   vw_trades_canonical unique: ${overlap[0].vtc_unique}`);

    const isComplementary = overlap[0].tcm_unique > 0 || overlap[0].vtc_unique > 0;
    console.log(`\n   Analysis: Sources are ${isComplementary ? 'COMPLEMENTARY (provide different coverage)' : 'DUPLICATIVE (same coverage)'}`);
  } catch (error) {
    console.log(`   ✗ Error: ${error.message}`);
  }

  // Write report
  console.log('\n' + '='.repeat(80));
  console.log('Writing report...\n');

  const report = `# V3 Orphan Repair - Join Experiments Report

## Executive Summary

Tested ${results.length} candidate sources against ${results[0]?.totalOrphans || 10000} orphan samples from October 2024.

## Test Results

${results.map(r => `### ${r.source} (${r.joinStrategy})

- **Total Orphans:** ${r.totalOrphans}
- **Can Repair:** ${r.canRepair} (${r.repairPct}%)
- **Unique Transactions Repaired:** ${r.uniqueTxRepaired}
- **Ambiguous Joins:** ${r.ambiguousJoins} ${r.ambiguousJoins === 0 ? '✓ SAFE' : '⚠️ CAUTION - May need disambiguation logic'}
- **Valid Condition IDs:** ${r.validConditionIds}
`).join('\n')}

## Recommendation

${results.length > 0 ? `
Based on repair rate and safety:

**Best Source for Production:** ${results.sort((a, b) => {
  if (a.ambiguousJoins === 0 && b.ambiguousJoins > 0) return -1;
  if (a.ambiguousJoins > 0 && b.ambiguousJoins === 0) return 1;
  return b.repairPct - a.repairPct;
})[0]?.source}
- **Repair rate:** ${results.sort((a, b) => {
  if (a.ambiguousJoins === 0 && b.ambiguousJoins > 0) return -1;
  if (a.ambiguousJoins > 0 && b.ambiguousJoins === 0) return 1;
  return b.repairPct - a.repairPct;
})[0]?.repairPct}%
- **Join strategy:** ${results.sort((a, b) => {
  if (a.ambiguousJoins === 0 && b.ambiguousJoins > 0) return -1;
  if (a.ambiguousJoins > 0 && b.ambiguousJoins === 0) return 1;
  return b.repairPct - a.repairPct;
})[0]?.joinStrategy}
- **Ambiguous joins:** ${results.sort((a, b) => {
  if (a.ambiguousJoins === 0 && b.ambiguousJoins > 0) return -1;
  if (a.ambiguousJoins > 0 && b.ambiguousJoins === 0) return 1;
  return b.repairPct - a.repairPct;
})[0]?.ambiguousJoins}
` : 'No successful test results'}

---
Generated: ${new Date().toISOString()}
`;

  writeFileSync('/tmp/V3_ORPHAN_JOIN_EXPERIMENTS.md', report);
  console.log('✓ Report written to /tmp/V3_ORPHAN_JOIN_EXPERIMENTS.md');

  // Summary table
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY TABLE\n');
  console.log('Source                          | Strategy         | Repair % | Ambiguous | Safe');
  console.log('-'.repeat(80));
  results.forEach(r => {
    const safe = r.ambiguousJoins === 0 ? '✓' : '✗';
    console.log(`${r.source.padEnd(31)} | ${r.joinStrategy.padEnd(16)} | ${String(r.repairPct).padEnd(8)} | ${String(r.ambiguousJoins).padEnd(9)} | ${safe}`);
  });
  console.log('='.repeat(80));

  // Cleanup
  console.log('\nCleaning up temp table...');
  await clickhouse.command({
    query: 'DROP TABLE IF EXISTS tmp_v3_orphans_oct2024_persistent'
  });
  console.log('✓ Cleanup complete');
}

completeOrphanRepairTest()
  .then(() => {
    console.log('\n✓ Phase 3 Complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Failed:', error);
    process.exit(1);
  });
