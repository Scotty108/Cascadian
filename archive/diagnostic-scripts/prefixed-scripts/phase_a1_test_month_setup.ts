#!/usr/bin/env node
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('PHASE A.1: Test Month Setup (October 2024)');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('Step 1: Baseline metrics for October 2024...\n');
  
  const baselineQuery = `
    SELECT
      count() AS total_trades,
      countIf(
        condition_id_norm_v3 IS NULL 
        OR condition_id_norm_v3 = ''
        OR length(condition_id_norm_v3) != 64
      ) AS orphan_trades,
      round(100.0 * orphan_trades / total_trades, 2) AS orphan_pct,
      countIf(length(condition_id_norm_v3) = 64) AS has_cid,
      round(100.0 * has_cid / total_trades, 2) AS coverage_pct
    FROM pm_trades_canonical_v3
    WHERE toYYYYMM(timestamp) = 202410
  `;

  const baseline = await clickhouse.query({ query: baselineQuery, format: 'JSONEachRow' });
  const baselineData = await baseline.json<any>();
  
  console.log('October 2024 Baseline:');
  console.log(JSON.stringify(baselineData, null, 2));

  console.log('\nStep 2: Creating test month orphans table...\n');
  
  await clickhouse.command({
    query: 'DROP TABLE IF EXISTS tmp_v4_phase_a_test_month_orphans'
  });

  const createOrphansTable = `
    CREATE TABLE tmp_v4_phase_a_test_month_orphans
    ENGINE = MergeTree()
    ORDER BY transaction_hash
    AS SELECT
      trade_id,
      transaction_hash,
      wallet_address,
      outcome_index_v3,
      timestamp,
      shares,
      usd_value
    FROM pm_trades_canonical_v3
    WHERE toYYYYMM(timestamp) = 202410
      AND (
        condition_id_norm_v3 IS NULL 
        OR condition_id_norm_v3 = ''
        OR length(condition_id_norm_v3) != 64
      )
  `;

  await clickhouse.command({ query: createOrphansTable });

  const orphanCount = await clickhouse.query({
    query: 'SELECT count() AS cnt FROM tmp_v4_phase_a_test_month_orphans',
    format: 'JSONEachRow'
  });
  const orphanCountData = await orphanCount.json<any>();
  
  console.log(`Created tmp_v4_phase_a_test_month_orphans: ${JSON.stringify(orphanCountData)} rows`);

  console.log('\nStep 3: Sample orphan records...\n');
  
  const sampleQuery = `
    SELECT
      trade_id,
      transaction_hash,
      wallet_address,
      outcome_index_v3,
      formatDateTime(timestamp, '%Y-%m-%d %H:%M:%S') AS ts,
      shares,
      usd_value
    FROM tmp_v4_phase_a_test_month_orphans
    ORDER BY timestamp
    LIMIT 5
  `;

  const sample = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
  const sampleData = await sample.json<any>();
  
  console.log('Sample orphans:');
  console.log(JSON.stringify(sampleData, null, 2));

  console.log('\n✅ Phase A.1 Complete');
  console.log(`Test month selected: October 2024`);
  console.log(`Orphan records isolated: ${orphanCountData[0].cnt}`);
}

main().catch(console.error);
