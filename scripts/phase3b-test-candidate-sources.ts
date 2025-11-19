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
  sampleRepairs: any[];
}

async function testCandidateSources() {
  console.log('Phase 3B: Testing Candidate Sources for Orphan Repair\n');
  console.log('=' .repeat(80) + '\n');

  const results: TestResult[] = [];

  // Test 1: vw_trades_canonical
  console.log('Test 1: vw_trades_canonical (tx_hash + wallet)...');
  try {
    const vtc1 = await clickhouse.query({
      query: `
        SELECT
          'vw_trades_canonical' as source,
          'tx_hash + wallet' as join_strategy,
          count() AS total_orphans,
          countIf(vtc.condition_id_norm IS NOT NULL
                  AND vtc.condition_id_norm != ''
                  AND length(vtc.condition_id_norm) = 64) AS can_repair,
          round(100.0 * can_repair / total_orphans, 2) AS repair_pct,
          count(DISTINCT CASE
            WHEN vtc.condition_id_norm IS NOT NULL AND vtc.condition_id_norm != '' THEN o.transaction_hash
          END) AS unique_tx_repaired,
          countIf(vtc_count > 1) AS ambiguous_joins,
          countIf(
            vtc.condition_id_norm IS NOT NULL
            AND length(vtc.condition_id_norm) = 64
            AND match(vtc.condition_id_norm, '^[0-9a-f]{64}$')
          ) AS valid_condition_ids
        FROM tmp_v3_orphans_oct2024 o
        LEFT JOIN vw_trades_canonical vtc
          ON o.transaction_hash = vtc.transaction_hash
          AND o.wallet_address = vtc.wallet_address_norm
        LEFT JOIN (
          SELECT transaction_hash, wallet_address_norm, count() as vtc_count
          FROM vw_trades_canonical
          WHERE transaction_hash IN (SELECT transaction_hash FROM tmp_v3_orphans_oct2024)
          GROUP BY transaction_hash, wallet_address_norm
          HAVING vtc_count > 1
        ) vtc_dup
          ON o.transaction_hash = vtc_dup.transaction_hash
          AND o.wallet_address = vtc_dup.wallet_address_norm
      `,
      format: 'JSONEachRow'
    });
    const vtc1Result = await vtc1.json();

    // Get sample repairs
    const vtc1Sample = await clickhouse.query({
      query: `
        SELECT
          o.transaction_hash,
          o.wallet_address,
          o.outcome_index_v2,
          vtc.condition_id_norm,
          vtc.market_id_norm
        FROM tmp_v3_orphans_oct2024 o
        INNER JOIN vw_trades_canonical vtc
          ON o.transaction_hash = vtc.transaction_hash
          AND o.wallet_address = vtc.wallet_address_norm
        WHERE vtc.condition_id_norm IS NOT NULL
          AND vtc.condition_id_norm != ''
          AND length(vtc.condition_id_norm) = 64
        LIMIT 5
      `,
      format: 'JSONEachRow'
    });
    const sampleRepairs = await vtc1Sample.json();

    results.push({
      source: vtc1Result[0].source,
      joinStrategy: vtc1Result[0].join_strategy,
      totalOrphans: vtc1Result[0].total_orphans,
      canRepair: vtc1Result[0].can_repair,
      repairPct: vtc1Result[0].repair_pct,
      uniqueTxRepaired: vtc1Result[0].unique_tx_repaired,
      ambiguousJoins: vtc1Result[0].ambiguous_joins,
      validConditionIds: vtc1Result[0].valid_condition_ids,
      sampleRepairs
    });

    console.log(`   ✓ Can repair: ${vtc1Result[0].can_repair}/${vtc1Result[0].total_orphans} (${vtc1Result[0].repair_pct}%)`);
    console.log(`   ✓ Ambiguous joins: ${vtc1Result[0].ambiguous_joins}`);
  } catch (error) {
    console.log(`   ✗ Error:`, error.message);
  }

  // Test 2: vw_trades_canonical (tx_hash only)
  console.log('\nTest 2: vw_trades_canonical (tx_hash only)...');
  try {
    const vtc2 = await clickhouse.query({
      query: `
        SELECT
          'vw_trades_canonical' as source,
          'tx_hash only' as join_strategy,
          count() AS total_orphans,
          countIf(vtc.condition_id_norm IS NOT NULL
                  AND vtc.condition_id_norm != ''
                  AND length(vtc.condition_id_norm) = 64) AS can_repair,
          round(100.0 * can_repair / total_orphans, 2) AS repair_pct,
          count(DISTINCT CASE
            WHEN vtc.condition_id_norm IS NOT NULL AND vtc.condition_id_norm != '' THEN o.transaction_hash
          END) AS unique_tx_repaired,
          countIf(vtc_count > 1) AS ambiguous_joins,
          countIf(
            vtc.condition_id_norm IS NOT NULL
            AND length(vtc.condition_id_norm) = 64
            AND match(vtc.condition_id_norm, '^[0-9a-f]{64}$')
          ) AS valid_condition_ids
        FROM tmp_v3_orphans_oct2024 o
        LEFT JOIN vw_trades_canonical vtc
          ON o.transaction_hash = vtc.transaction_hash
        LEFT JOIN (
          SELECT transaction_hash, count() as vtc_count
          FROM vw_trades_canonical
          WHERE transaction_hash IN (SELECT transaction_hash FROM tmp_v3_orphans_oct2024)
          GROUP BY transaction_hash
          HAVING vtc_count > 1
        ) vtc_dup
          ON o.transaction_hash = vtc_dup.transaction_hash
      `,
      format: 'JSONEachRow'
    });
    const vtc2Result = await vtc2.json();

    results.push({
      source: vtc2Result[0].source,
      joinStrategy: vtc2Result[0].join_strategy,
      totalOrphans: vtc2Result[0].total_orphans,
      canRepair: vtc2Result[0].can_repair,
      repairPct: vtc2Result[0].repair_pct,
      uniqueTxRepaired: vtc2Result[0].unique_tx_repaired,
      ambiguousJoins: vtc2Result[0].ambiguous_joins,
      validConditionIds: vtc2Result[0].valid_condition_ids,
      sampleRepairs: []
    });

    console.log(`   ✓ Can repair: ${vtc2Result[0].can_repair}/${vtc2Result[0].total_orphans} (${vtc2Result[0].repair_pct}%)`);
    console.log(`   ✓ Ambiguous joins: ${vtc2Result[0].ambiguous_joins}`);
  } catch (error) {
    console.log(`   ✗ Error:`, error.message);
  }

  // Test 3: trade_direction_assignments
  console.log('\nTest 3: trade_direction_assignments (tx_hash + wallet)...');
  try {
    const tda = await clickhouse.query({
      query: `
        SELECT
          'trade_direction_assignments' as source,
          'tx_hash + wallet' as join_strategy,
          count() AS total_orphans,
          countIf(tda.condition_id_norm IS NOT NULL
                  AND tda.condition_id_norm != ''
                  AND length(tda.condition_id_norm) = 64) AS can_repair,
          round(100.0 * can_repair / total_orphans, 2) AS repair_pct,
          count(DISTINCT CASE
            WHEN tda.condition_id_norm IS NOT NULL AND tda.condition_id_norm != '' THEN o.transaction_hash
          END) AS unique_tx_repaired,
          countIf(tda_count > 1) AS ambiguous_joins,
          countIf(
            tda.condition_id_norm IS NOT NULL
            AND length(tda.condition_id_norm) = 64
            AND match(tda.condition_id_norm, '^[0-9a-f]{64}$')
          ) AS valid_condition_ids
        FROM tmp_v3_orphans_oct2024 o
        LEFT JOIN trade_direction_assignments tda
          ON o.transaction_hash = tda.transaction_hash
          AND o.wallet_address = tda.wallet_address_norm
        LEFT JOIN (
          SELECT transaction_hash, wallet_address_norm, count() as tda_count
          FROM trade_direction_assignments
          WHERE transaction_hash IN (SELECT transaction_hash FROM tmp_v3_orphans_oct2024)
          GROUP BY transaction_hash, wallet_address_norm
          HAVING tda_count > 1
        ) tda_dup
          ON o.transaction_hash = tda_dup.transaction_hash
          AND o.wallet_address = tda_dup.wallet_address_norm
      `,
      format: 'JSONEachRow'
    });
    const tdaResult = await tda.json();

    results.push({
      source: tdaResult[0].source,
      joinStrategy: tdaResult[0].join_strategy,
      totalOrphans: tdaResult[0].total_orphans,
      canRepair: tdaResult[0].can_repair,
      repairPct: tdaResult[0].repair_pct,
      uniqueTxRepaired: tdaResult[0].unique_tx_repaired,
      ambiguousJoins: tdaResult[0].ambiguous_joins,
      validConditionIds: tdaResult[0].valid_condition_ids,
      sampleRepairs: []
    });

    console.log(`   ✓ Can repair: ${tdaResult[0].can_repair}/${tdaResult[0].total_orphans} (${tdaResult[0].repair_pct}%)`);
    console.log(`   ✓ Ambiguous joins: ${tdaResult[0].ambiguous_joins}`);
  } catch (error) {
    console.log(`   ✗ Error:`, error.message);
  }

  // Test 4: trades_cid_map_v2_merged
  console.log('\nTest 4: trades_cid_map_v2_merged (tx_hash only)...');
  try {
    const tcm = await clickhouse.query({
      query: `
        SELECT
          'trades_cid_map_v2_merged' as source,
          'tx_hash only' as join_strategy,
          count() AS total_orphans,
          countIf(tcm.condition_id_norm IS NOT NULL
                  AND tcm.condition_id_norm != ''
                  AND length(tcm.condition_id_norm) = 64) AS can_repair,
          round(100.0 * can_repair / total_orphans, 2) AS repair_pct,
          count(DISTINCT CASE
            WHEN tcm.condition_id_norm IS NOT NULL AND tcm.condition_id_norm != '' THEN o.transaction_hash
          END) AS unique_tx_repaired,
          countIf(tcm_count > 1) AS ambiguous_joins,
          countIf(
            tcm.condition_id_norm IS NOT NULL
            AND length(tcm.condition_id_norm) = 64
            AND match(tcm.condition_id_norm, '^[0-9a-f]{64}$')
          ) AS valid_condition_ids
        FROM tmp_v3_orphans_oct2024 o
        LEFT JOIN trades_cid_map_v2_merged tcm
          ON o.transaction_hash = tcm.transaction_hash
        LEFT JOIN (
          SELECT transaction_hash, count() as tcm_count
          FROM trades_cid_map_v2_merged
          WHERE transaction_hash IN (SELECT transaction_hash FROM tmp_v3_orphans_oct2024)
          GROUP BY transaction_hash
          HAVING tcm_count > 1
        ) tcm_dup
          ON o.transaction_hash = tcm_dup.transaction_hash
      `,
      format: 'JSONEachRow'
    });
    const tcmResult = await tcm.json();

    results.push({
      source: tcmResult[0].source,
      joinStrategy: tcmResult[0].join_strategy,
      totalOrphans: tcmResult[0].total_orphans,
      canRepair: tcmResult[0].can_repair,
      repairPct: tcmResult[0].repair_pct,
      uniqueTxRepaired: tcmResult[0].unique_tx_repaired,
      ambiguousJoins: tcmResult[0].ambiguous_joins,
      validConditionIds: tcmResult[0].valid_condition_ids,
      sampleRepairs: []
    });

    console.log(`   ✓ Can repair: ${tcmResult[0].can_repair}/${tcmResult[0].total_orphans} (${tcmResult[0].repair_pct}%)`);
    console.log(`   ✓ Ambiguous joins: ${tcmResult[0].ambiguous_joins}`);
  } catch (error) {
    console.log(`   ✗ Error:`, error.message);
  }

  // Test 5: trades_cid_map_v2_twd
  console.log('\nTest 5: trades_cid_map_v2_twd (tx_hash only)...');
  try {
    const tct = await clickhouse.query({
      query: `
        SELECT
          'trades_cid_map_v2_twd' as source,
          'tx_hash only' as join_strategy,
          count() AS total_orphans,
          countIf(tct.condition_id_norm IS NOT NULL
                  AND tct.condition_id_norm != ''
                  AND length(tct.condition_id_norm) = 64) AS can_repair,
          round(100.0 * can_repair / total_orphans, 2) AS repair_pct,
          count(DISTINCT CASE
            WHEN tct.condition_id_norm IS NOT NULL AND tct.condition_id_norm != '' THEN o.transaction_hash
          END) AS unique_tx_repaired,
          countIf(tct_count > 1) AS ambiguous_joins,
          countIf(
            tct.condition_id_norm IS NOT NULL
            AND length(tct.condition_id_norm) = 64
            AND match(tct.condition_id_norm, '^[0-9a-f]{64}$')
          ) AS valid_condition_ids
        FROM tmp_v3_orphans_oct2024 o
        LEFT JOIN trades_cid_map_v2_twd tct
          ON o.transaction_hash = tct.transaction_hash
        LEFT JOIN (
          SELECT transaction_hash, count() as tct_count
          FROM trades_cid_map_v2_twd
          WHERE transaction_hash IN (SELECT transaction_hash FROM tmp_v3_orphans_oct2024)
          GROUP BY transaction_hash
          HAVING tct_count > 1
        ) tct_dup
          ON o.transaction_hash = tct_dup.transaction_hash
      `,
      format: 'JSONEachRow'
    });
    const tctResult = await tct.json();

    results.push({
      source: tctResult[0].source,
      joinStrategy: tctResult[0].join_strategy,
      totalOrphans: tctResult[0].total_orphans,
      canRepair: tctResult[0].can_repair,
      repairPct: tctResult[0].repair_pct,
      uniqueTxRepaired: tctResult[0].unique_tx_repaired,
      ambiguousJoins: tctResult[0].ambiguous_joins,
      validConditionIds: tctResult[0].valid_condition_ids,
      sampleRepairs: []
    });

    console.log(`   ✓ Can repair: ${tctResult[0].can_repair}/${tctResult[0].total_orphans} (${tctResult[0].repair_pct}%)`);
    console.log(`   ✓ Ambiguous joins: ${tctResult[0].ambiguous_joins}`);
  } catch (error) {
    console.log(`   ✗ Error:`, error.message);
  }

  // Phase 3C: Multi-source overlap analysis
  console.log('\n' + '='.repeat(80));
  console.log('Phase 3C: Multi-Source Overlap Analysis\n');

  console.log('Testing overlap between top 2 candidates...');
  try {
    const overlap = await clickhouse.query({
      query: `
        SELECT
          count() AS total_orphans,
          countIf(vtc.condition_id_norm IS NOT NULL AND vtc.condition_id_norm != '' AND length(vtc.condition_id_norm) = 64) AS vtc_repairs,
          countIf(tcm.condition_id_norm IS NOT NULL AND tcm.condition_id_norm != '' AND length(tcm.condition_id_norm) = 64) AS tcm_repairs,
          countIf(
            vtc.condition_id_norm IS NOT NULL AND length(vtc.condition_id_norm) = 64
            AND tcm.condition_id_norm IS NOT NULL AND length(tcm.condition_id_norm) = 64
          ) AS both_repair,
          countIf(
            (vtc.condition_id_norm IS NULL OR vtc.condition_id_norm = '' OR length(vtc.condition_id_norm) != 64)
            AND tcm.condition_id_norm IS NOT NULL AND length(tcm.condition_id_norm) = 64
          ) AS tcm_unique,
          countIf(
            vtc.condition_id_norm IS NOT NULL AND length(vtc.condition_id_norm) = 64
            AND (tcm.condition_id_norm IS NULL OR tcm.condition_id_norm = '' OR length(tcm.condition_id_norm) != 64)
          ) AS vtc_unique
        FROM tmp_v3_orphans_oct2024 o
        LEFT JOIN vw_trades_canonical vtc
          ON o.transaction_hash = vtc.transaction_hash
          AND o.wallet_address = vtc.wallet_address_norm
        LEFT JOIN trades_cid_map_v2_merged tcm
          ON o.transaction_hash = tcm.transaction_hash
      `,
      format: 'JSONEachRow'
    });
    const overlapResult = await overlap.json();

    console.log(`   Total orphans: ${overlapResult[0].total_orphans}`);
    console.log(`   vw_trades_canonical repairs: ${overlapResult[0].vtc_repairs}`);
    console.log(`   trades_cid_map_v2_merged repairs: ${overlapResult[0].tcm_repairs}`);
    console.log(`   Both repair (overlap): ${overlapResult[0].both_repair}`);
    console.log(`   trades_cid_map_v2_merged unique: ${overlapResult[0].tcm_unique}`);
    console.log(`   vw_trades_canonical unique: ${overlapResult[0].vtc_unique}`);

    const isComplementary = overlapResult[0].tcm_unique > 0 || overlapResult[0].vtc_unique > 0;
    console.log(`\n   Analysis: Sources are ${isComplementary ? 'COMPLEMENTARY (provide different coverage)' : 'DUPLICATIVE (same coverage)'}`);
  } catch (error) {
    console.log(`   ✗ Error:`, error.message);
  }

  // Write report
  console.log('\n' + '='.repeat(80));
  console.log('Writing report to /tmp/V3_ORPHAN_JOIN_EXPERIMENTS.md\n');

  const report = `# V3 Orphan Repair - Join Experiments Report

## Executive Summary

Tested ${results.length} candidate sources against ${results[0]?.totalOrphans || 10000} orphan samples from October 2024.

## Test Results

${results.map(r => `### ${r.source} (${r.joinStrategy})

- **Total Orphans:** ${r.totalOrphans}
- **Can Repair:** ${r.canRepair} (${r.repairPct}%)
- **Unique Transactions Repaired:** ${r.uniqueTxRepaired}
- **Ambiguous Joins:** ${r.ambiguousJoins} ${r.ambiguousJoins === 0 ? '✓ SAFE' : '⚠️ UNSAFE'}
- **Valid Condition IDs:** ${r.validConditionIds}

${r.sampleRepairs.length > 0 ? `**Sample Repairs:**
\`\`\`json
${JSON.stringify(r.sampleRepairs.slice(0, 2), null, 2)}
\`\`\`
` : ''}
`).join('\n')}

## Recommendation

${results.length > 0 ? `
Based on repair rate and safety (zero ambiguous joins):

**Best Source:** ${results.sort((a, b) => b.repairPct - a.repairPct).filter(r => r.ambiguousJoins === 0)[0]?.source || 'None (all have ambiguous joins)'}
- Repair rate: ${results.sort((a, b) => b.repairPct - a.repairPct).filter(r => r.ambiguousJoins === 0)[0]?.repairPct || 0}%
- Join strategy: ${results.sort((a, b) => b.repairPct - a.repairPct).filter(r => r.ambiguousJoins === 0)[0]?.joinStrategy || 'N/A'}
` : 'No successful test results'}

---
Generated: ${new Date().toISOString()}
`;

  writeFileSync('/tmp/V3_ORPHAN_JOIN_EXPERIMENTS.md', report);
  console.log('✓ Report written');

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
}

testCandidateSources()
  .then(() => {
    console.log('\n✓ Phase 3B & 3C complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Failed:', error);
    process.exit(1);
  });
