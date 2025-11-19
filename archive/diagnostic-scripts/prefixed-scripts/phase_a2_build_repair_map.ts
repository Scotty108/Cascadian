#!/usr/bin/env node
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('PHASE A.2: Build pm_trades Repair Map (1:1 Only)');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('Step 1: Analyzing pm_trades coverage for orphans...\n');
  
  const coverageAnalysis = `
    SELECT
      count(DISTINCT o.transaction_hash) AS total_orphan_txs,
      count(DISTINCT pt.tx_hash) AS matched_in_pm_trades,
      round(100.0 * matched_in_pm_trades / total_orphan_txs, 2) AS match_rate_pct
    FROM tmp_v4_phase_a_test_month_orphans o
    LEFT JOIN pm_trades pt ON o.transaction_hash = pt.tx_hash
  `;

  const coverage = await clickhouse.query({ query: coverageAnalysis, format: 'JSONEachRow' });
  const coverageData = await coverage.json<any>();
  
  console.log('Coverage analysis:');
  console.log(JSON.stringify(coverageData, null, 2));

  console.log('\nStep 2: Building 1:1 repair map...\n');
  
  await clickhouse.command({
    query: 'DROP TABLE IF EXISTS tmp_v4_phase_a_pm_trades_repairs_202410'
  });

  const buildRepairMap = `
    CREATE TABLE tmp_v4_phase_a_pm_trades_repairs_202410
    ENGINE = MergeTree()
    ORDER BY transaction_hash
    AS SELECT
      any(o.trade_id) AS trade_id,
      o.transaction_hash,
      any(pt.condition_id) AS repair_condition_id,
      any(pt.outcome_index) AS repair_outcome_index,
      'pm_trades' AS repair_source,
      'HIGH' AS repair_confidence
    FROM tmp_v4_phase_a_test_month_orphans o
    INNER JOIN pm_trades pt ON o.transaction_hash = pt.tx_hash
    WHERE length(pt.condition_id) = 64
      AND pt.condition_id IS NOT NULL
      AND pt.condition_id != ''
    GROUP BY o.transaction_hash
    HAVING count(DISTINCT pt.condition_id) = 1
    ORDER BY o.transaction_hash
  `;

  await clickhouse.command({ query: buildRepairMap });

  const repairCount = await clickhouse.query({
    query: 'SELECT count() AS cnt FROM tmp_v4_phase_a_pm_trades_repairs_202410',
    format: 'JSONEachRow'
  });
  const repairCountData = await repairCount.json<any>();
  
  console.log(`Repair map created: ${JSON.stringify(repairCountData)} repairs`);

  console.log('\nStep 3: Sample repair records...\n');
  
  const sampleRepairs = `
    SELECT
      trade_id,
      transaction_hash,
      repair_condition_id,
      repair_outcome_index,
      repair_source,
      repair_confidence
    FROM tmp_v4_phase_a_pm_trades_repairs_202410
    LIMIT 10
  `;

  const sample = await clickhouse.query({ query: sampleRepairs, format: 'JSONEachRow' });
  const sampleData = await sample.json<any>();
  
  console.log('Sample repairs:');
  console.log(JSON.stringify(sampleData, null, 2));

  console.log('\nStep 4: Coverage gain calculation...\n');
  
  const gainQuery = `
    SELECT
      (SELECT count() FROM tmp_v4_phase_a_test_month_orphans) AS total_orphans,
      count() AS repairs_found,
      round(100.0 * repairs_found / total_orphans, 2) AS repair_coverage_pct
    FROM tmp_v4_phase_a_pm_trades_repairs_202410
  `;

  const gain = await clickhouse.query({ query: gainQuery, format: 'JSONEachRow' });
  const gainData = await gain.json<any>();
  
  console.log('Coverage gain:');
  console.log(JSON.stringify(gainData, null, 2));

  console.log('\n✅ Phase A.2 Complete');
  console.log(`Repairs built: ${repairCountData[0].cnt}`);
  console.log(`Expected coverage gain: ~${gainData[0].repair_coverage_pct}%`);
}

main().catch(console.error);
