/**
 * 36: REBUILD CTF_TOKEN_MAP FROM GAMMA_MARKETS
 *
 * Replace broken ctf_token_map (built from bit-shift decoder)
 * with correct mappings from gamma_markets (from Gamma API)
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('36: REBUILD CTF_TOKEN_MAP FROM GAMMA_MARKETS');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('Mission: Replace broken ctf_token_map with correct data from gamma_markets\n');

  // Step 1: Check current state
  console.log('📊 Step 1: Check current ctf_token_map state...\n');

  try {
    const query1 = await clickhouse.query({
      query: 'SELECT count() AS row_count FROM ctf_token_map',
      format: 'JSONEachRow'
    });
    const current: any = (await query1.json())[0];
    console.log(`  Current ctf_token_map rows: ${current.row_count}`);
  } catch (e: any) {
    console.log(`  ctf_token_map does not exist: ${e.message}`);
  }

  console.log('');

  // Step 2: Check gamma_markets
  console.log('📊 Step 2: Check gamma_markets source...\n');

  const query2 = await clickhouse.query({
    query: `
      SELECT
        count() AS total,
        countIf(token_id IS NOT NULL AND token_id != '') AS has_token_id,
        countIf(condition_id IS NOT NULL AND condition_id != '') AS has_condition_id
      FROM gamma_markets
    `,
    format: 'JSONEachRow'
  });
  const gammaStats: any = (await query2.json())[0];

  console.log('  gamma_markets stats:');
  console.log(`    Total rows: ${parseInt(gammaStats.total).toLocaleString()}`);
  console.log(`    With token_id: ${parseInt(gammaStats.has_token_id).toLocaleString()}`);
  console.log(`    With condition_id: ${parseInt(gammaStats.has_condition_id).toLocaleString()}\n`);

  // Step 3: Drop old table
  console.log('📊 Step 3: Drop broken ctf_token_map...\n');

  await clickhouse.command({
    query: 'DROP TABLE IF EXISTS ctf_token_map'
  });

  console.log('  ✅ Dropped old ctf_token_map\n');

  // Step 4: Create new table from gamma_markets
  console.log('📊 Step 4: Create new ctf_token_map from gamma_markets...\n');

  await clickhouse.command({
    query: `
      CREATE TABLE ctf_token_map
      ENGINE = ReplacingMergeTree()
      ORDER BY (token_id, outcome)
      AS SELECT
        token_id,
        lpad(lower(replaceAll(condition_id, '0x', '')), 64, '0') AS condition_id_norm,
        question,
        outcome,
        outcomes_json,
        'gamma_markets' AS source,
        now() AS created_at
      FROM gamma_markets
      WHERE token_id IS NOT NULL
        AND token_id != ''
        AND condition_id IS NOT NULL
        AND condition_id != ''
    `
  });

  console.log('  ✅ Created new ctf_token_map from gamma_markets\n');

  // Step 5: Verify new table
  console.log('📊 Step 5: Verify new ctf_token_map...\n');

  const query5 = await clickhouse.query({
    query: 'SELECT count() AS row_count FROM ctf_token_map',
    format: 'JSONEachRow'
  });
  const newCount: any = (await query5.json())[0];

  console.log(`  New ctf_token_map rows: ${parseInt(newCount.row_count).toLocaleString()}\n`);

  // Step 6: Sample the new data
  console.log('📊 Step 6: Sample new ctf_token_map...\n');

  const query6 = await clickhouse.query({
    query: 'SELECT * FROM ctf_token_map LIMIT 5',
    format: 'JSONEachRow'
  });
  const samples: any[] = await query6.json();

  console.log('Sample rows:');
  console.table(samples.map(s => ({
    token_id: s.token_id.substring(0, 20) + '...',
    condition_id: s.condition_id_norm.substring(0, 30) + '...',
    question: s.question.substring(0, 40) + '...',
    outcome: s.outcome,
    source: s.source
  })));

  // Step 7: Test coverage of traded tokens
  console.log('\n📊 Step 7: Test coverage of traded tokens...\n');

  const query7 = await clickhouse.query({
    query: `
      WITH traded AS (
        SELECT DISTINCT asset_id
        FROM clob_fills
        WHERE timestamp >= '2025-01-01'
        LIMIT 1000
      )
      SELECT
        count() AS sample_size,
        countIf(ctm.token_id IS NOT NULL) AS covered,
        round(countIf(ctm.token_id IS NOT NULL) / count() * 100, 1) AS coverage_pct
      FROM traded t
      LEFT JOIN ctf_token_map ctm ON ctm.token_id = t.asset_id
    `,
    format: 'JSONEachRow'
  });
  const coverage: any = (await query7.json())[0];

  console.log('  Coverage test (1000 traded tokens from 2025):');
  console.log(`    Sample size: ${coverage.sample_size}`);
  console.log(`    Covered: ${coverage.covered}`);
  console.log(`    Coverage: ${coverage.coverage_pct}%\n`);

  if (parseFloat(coverage.coverage_pct) >= 99) {
    console.log('  ✅ Excellent coverage!\n');
  } else if (parseFloat(coverage.coverage_pct) >= 90) {
    console.log('  ⚠️  Good coverage but some gaps\n');
  } else {
    console.log('  ❌ Low coverage - investigate gaps\n');
  }

  // Step 8: Test overlap with resolutions
  console.log('📊 Step 8: Test overlap with resolutions...\n');

  const query8 = await clickhouse.query({
    query: `
      WITH ctm_sample AS (
        SELECT DISTINCT condition_id_norm
        FROM ctf_token_map
        LIMIT 1000
      )
      SELECT
        count() AS sample_size,
        countIf(mr.condition_id_norm IS NOT NULL) AS has_resolution,
        round(countIf(mr.condition_id_norm IS NOT NULL) / count() * 100, 1) AS overlap_pct
      FROM ctm_sample ctm
      LEFT JOIN market_resolutions_final mr ON mr.condition_id_norm = ctm.condition_id_norm
    `,
    format: 'JSONEachRow'
  });
  const overlap: any = (await query8.json())[0];

  console.log('  Resolution overlap test (1000 condition_ids):');
  console.log(`    Sample size: ${overlap.sample_size}`);
  console.log(`    With resolution: ${overlap.has_resolution}`);
  console.log(`    Overlap: ${overlap.overlap_pct}%\n`);

  if (parseFloat(overlap.overlap_pct) >= 99) {
    console.log('  ✅ Excellent overlap with resolutions!\n');
  } else if (parseFloat(overlap.overlap_pct) >= 90) {
    console.log('  ⚠️  Good overlap but some gaps\n');
  } else {
    console.log('  ❌ Low overlap - investigate\n');
  }

  console.log('═══════════════════════════════════════════════════════════');
  console.log('RESULT:');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  if (parseFloat(coverage.coverage_pct) >= 99 && parseFloat(overlap.overlap_pct) >= 99) {
    console.log('✅ SUCCESS: ctf_token_map rebuilt with correct data!');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Rebuild ctf_token_map_norm view (if it exists)');
    console.log('  2. Build Track A fixture with correct mappings');
    console.log('  3. Run Track A checkpoints');
  } else {
    console.log('⚠️  WARNING: Some gaps in coverage or overlap');
    console.log('');
    console.log('Investigate:');
    console.log('  - Which traded tokens are missing from gamma_markets?');
    console.log('  - Which condition_ids lack resolutions?');
  }

  console.log('');
}

main().catch(console.error);
