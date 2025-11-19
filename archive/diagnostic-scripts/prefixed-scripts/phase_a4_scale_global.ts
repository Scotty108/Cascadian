#!/usr/bin/env node
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '.env.local') });

import { clickhouse } from './lib/clickhouse/client';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('PHASE A.4: Scale to Global');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('Step 1: Global orphan inventory...\n');
  
  const globalOrphans = `
    SELECT
      count() AS total_orphans,
      round(sum(usd_value), 2) AS orphan_volume_usd
    FROM pm_trades_canonical_v3
    WHERE condition_id_norm_v3 IS NULL 
       OR condition_id_norm_v3 = ''
       OR length(condition_id_norm_v3) != 64
  `;

  const orphanResult = await clickhouse.query({ query: globalOrphans, format: 'JSONEachRow' });
  const orphanData = await orphanResult.json();
  
  console.log('Global orphan inventory:');
  console.log(JSON.stringify(orphanData, null, 2));

  console.log('\nStep 2: Building global repair map (this may take 2-3 minutes)...\n');
  
  await clickhouse.command({
    query: 'DROP TABLE IF EXISTS tmp_v4_phase_a_pm_trades_repairs_global'
  });

  const buildGlobalMap = `
    CREATE TABLE tmp_v4_phase_a_pm_trades_repairs_global
    ENGINE = MergeTree()
    ORDER BY transaction_hash
    AS SELECT
      any(o.trade_id) AS trade_id,
      o.transaction_hash,
      any(pt.condition_id) AS repair_condition_id,
      any(pt.outcome_index) AS repair_outcome_index,
      'pm_trades' AS repair_source,
      'HIGH' AS repair_confidence,
      now() AS created_at
    FROM pm_trades_canonical_v3 o
    INNER JOIN pm_trades pt ON o.transaction_hash = pt.tx_hash
    WHERE (
        o.condition_id_norm_v3 IS NULL 
        OR o.condition_id_norm_v3 = ''
        OR length(o.condition_id_norm_v3) != 64
      )
      AND length(pt.condition_id) = 64
      AND pt.condition_id IS NOT NULL
      AND pt.condition_id != ''
    GROUP BY o.transaction_hash
    HAVING count(DISTINCT pt.condition_id) = 1
  `;

  const startTime = Date.now();
  await clickhouse.command({ query: buildGlobalMap });
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  const globalCount = await clickhouse.query({
    query: 'SELECT count() AS cnt FROM tmp_v4_phase_a_pm_trades_repairs_global',
    format: 'JSONEachRow'
  });
  const globalCountData = await globalCount.json();
  
  console.log(`Global repair map created: ${JSON.stringify(globalCountData)} repairs in ${elapsed}s`);

  console.log('\nStep 3: Creating permanent repair provenance table...\n');
  
  await clickhouse.command({
    query: 'DROP TABLE IF EXISTS pm_v4_repair_map'
  });

  const createProvenanceTable = `
    CREATE TABLE pm_v4_repair_map (
      trade_id String,
      transaction_hash String,
      repair_condition_id String,
      repair_outcome_index Int8,
      repair_source Enum8('pm_trades'=1, 'trades_with_direction'=2, 'pm_trades_complete'=3),
      repair_confidence Enum8('HIGH'=1, 'MEDIUM'=2, 'LOW'=3),
      created_at DateTime
    ) ENGINE = ReplacingMergeTree(created_at)
    ORDER BY (transaction_hash, repair_source)
  `;

  await clickhouse.command({ query: createProvenanceTable });
  console.log('Created pm_v4_repair_map table');

  console.log('\nStep 4: Loading repairs into provenance table...\n');
  
  const insertRepairs = `
    INSERT INTO pm_v4_repair_map
    SELECT * FROM tmp_v4_phase_a_pm_trades_repairs_global
  `;

  await clickhouse.command({ query: insertRepairs });
  
  const finalCount = await clickhouse.query({
    query: 'SELECT count() AS cnt FROM pm_v4_repair_map',
    format: 'JSONEachRow'
  });
  const finalCountData = await finalCount.json();
  
  console.log(`Loaded ${JSON.stringify(finalCountData)} repairs into pm_v4_repair_map`);

  console.log('\nStep 5: Repair source breakdown...\n');
  
  const sourceBreakdown = `
    SELECT
      repair_source,
      repair_confidence,
      count() AS repair_count
    FROM pm_v4_repair_map
    GROUP BY repair_source, repair_confidence
  `;

  const sourceResult = await clickhouse.query({ query: sourceBreakdown, format: 'JSONEachRow' });
  const sourceData = await sourceResult.json();
  
  console.log('Source breakdown:');
  console.log(JSON.stringify(sourceData, null, 2));

  console.log('\n✅ Phase A.4 Complete');
  console.log(`Global repair map built: ${finalCountData[0].cnt} repairs`);
  console.log('Permanent table: pm_v4_repair_map');
}

main().catch(console.error);
