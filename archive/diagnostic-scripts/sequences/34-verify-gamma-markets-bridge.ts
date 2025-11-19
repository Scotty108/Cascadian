/**
 * 34: VERIFY GAMMA_MARKETS AS BRIDGE
 *
 * Test if gamma_markets can bridge clob_fills → market_resolutions_final
 * by having both correct token_ids AND condition_ids
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('34: VERIFY GAMMA_MARKETS AS BRIDGE');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('Mission: Verify gamma_markets has correct mappings for BOTH sides:\n');
  console.log('  1. token_id → clob_fills.asset_id (traded tokens)');
  console.log('  2. condition_id → market_resolutions_final (resolutions)\n');

  // Test 1: Do gamma_markets token_ids match clob_fills asset_ids?
  console.log('📊 Test 1: gamma_markets.token_id → clob_fills.asset_id...\n');

  const query1 = await clickhouse.query({
    query: `
      WITH traded_assets AS (
        SELECT DISTINCT asset_id
        FROM clob_fills
        WHERE timestamp >= '2025-01-01'
        LIMIT 1000
      )
      SELECT
        count() AS traded_sample,
        countIf(gm.token_id IS NOT NULL) AS has_gamma_mapping,
        round(countIf(gm.token_id IS NOT NULL) / count() * 100, 1) AS match_pct
      FROM traded_assets ta
      LEFT JOIN gamma_markets gm ON gm.token_id = ta.asset_id
    `,
    format: 'JSONEachRow'
  });

  const test1: any = (await query1.json())[0];

  console.log('Test 1 Results:');
  console.log(`  Traded asset sample: ${test1.traded_sample}`);
  console.log(`  Matched in gamma_markets: ${test1.has_gamma_mapping}`);
  console.log(`  Match rate: ${test1.match_pct}%\n`);

  if (parseFloat(test1.match_pct) < 80) {
    console.log('  ⚠️  LOW MATCH RATE - gamma_markets may not cover traded tokens\n');
  } else {
    console.log('  ✅ HIGH MATCH RATE - gamma_markets covers traded tokens\n');
  }

  // Test 2: Do gamma_markets condition_ids match market_resolutions_final?
  console.log('📊 Test 2: gamma_markets.condition_id → market_resolutions_final...\n');

  const query2 = await clickhouse.query({
    query: `
      WITH gamma_cids AS (
        SELECT DISTINCT
          lpad(lower(replaceAll(condition_id, '0x', '')), 64, '0') AS condition_id_norm
        FROM gamma_markets
        WHERE condition_id IS NOT NULL AND condition_id != ''
        LIMIT 1000
      )
      SELECT
        count() AS gamma_sample,
        countIf(mr.condition_id_norm IS NOT NULL) AS has_resolution,
        round(countIf(mr.condition_id_norm IS NOT NULL) / count() * 100, 1) AS match_pct
      FROM gamma_cids gc
      LEFT JOIN market_resolutions_final mr ON mr.condition_id_norm = gc.condition_id_norm
    `,
    format: 'JSONEachRow'
  });

  const test2: any = (await query2.json())[0];

  console.log('Test 2 Results:');
  console.log(`  Gamma condition_id sample: ${test2.gamma_sample}`);
  console.log(`  Matched in resolutions: ${test2.has_resolution}`);
  console.log(`  Match rate: ${test2.match_pct}%\n`);

  if (parseFloat(test2.match_pct) < 80) {
    console.log('  ⚠️  LOW MATCH RATE - gamma_markets may have different markets\n');
  } else {
    console.log('  ✅ HIGH MATCH RATE - gamma_markets aligns with resolutions\n');
  }

  // Test 3: End-to-end bridge test
  console.log('📊 Test 3: Full bridge test (clob_fills → gamma_markets → resolutions)...\n');

  const query3 = await clickhouse.query({
    query: `
      WITH traded_assets AS (
        SELECT DISTINCT asset_id
        FROM clob_fills
        WHERE timestamp >= '2025-01-01'
        LIMIT 100
      ),
      joined AS (
        SELECT
          ta.asset_id,
          gm.condition_id,
          lpad(lower(replaceAll(gm.condition_id, '0x', '')), 64, '0') AS condition_id_norm
        FROM traded_assets ta
        LEFT JOIN gamma_markets gm ON gm.token_id = ta.asset_id
      )
      SELECT
        count() AS sample_size,
        countIf(condition_id IS NOT NULL) AS has_condition_id,
        countIf(mr.condition_id_norm IS NOT NULL) AS has_resolution,
        round(countIf(mr.condition_id_norm IS NOT NULL) / count() * 100, 1) AS end_to_end_pct
      FROM joined j
      LEFT JOIN market_resolutions_final mr ON mr.condition_id_norm = j.condition_id_norm
    `,
    format: 'JSONEachRow'
  });

  const test3: any = (await query3.json())[0];

  console.log('Test 3 Results (End-to-End):');
  console.log(`  Traded assets: ${test3.sample_size}`);
  console.log(`  With gamma condition_id: ${test3.has_condition_id}`);
  console.log(`  With resolution data: ${test3.has_resolution}`);
  console.log(`  End-to-end success rate: ${test3.end_to_end_pct}%\n`);

  if (parseFloat(test3.end_to_end_pct) >= 80) {
    console.log('  🎉 SUCCESS - gamma_markets can bridge the gap!\n');
  } else if (parseFloat(test3.end_to_end_pct) >= 50) {
    console.log('  ⚠️  PARTIAL - gamma_markets works but has gaps\n');
  } else {
    console.log('  ❌ FAILED - gamma_markets does not bridge effectively\n');
  }

  // Test 4: Sample the actual mappings
  console.log('📊 Test 4: Sample successful mappings...\n');

  const query4 = await clickhouse.query({
    query: `
      SELECT
        ta.asset_id,
        gm.token_id AS gamma_token_id,
        gm.condition_id AS gamma_condition_id,
        gm.question,
        gm.outcome,
        mr.winning_outcome,
        mr.payout_numerators
      FROM (
        SELECT DISTINCT asset_id
        FROM clob_fills
        WHERE timestamp >= '2025-01-01'
        LIMIT 10
      ) ta
      LEFT JOIN gamma_markets gm ON gm.token_id = ta.asset_id
      LEFT JOIN market_resolutions_final mr
        ON mr.condition_id_norm = lpad(lower(replaceAll(gm.condition_id, '0x', '')), 64, '0')
      WHERE gm.condition_id IS NOT NULL
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const samples: any[] = await query4.json();

  if (samples.length > 0) {
    console.log('Sample successful mappings:');
    console.table(samples.map(s => ({
      asset_id: s.asset_id.substring(0, 20) + '...',
      gamma_matches: s.gamma_token_id === s.asset_id ? '✅' : '❌',
      condition_id: s.gamma_condition_id ? s.gamma_condition_id.substring(0, 30) + '...' : 'null',
      question: s.question ? s.question.substring(0, 40) + '...' : 'null',
      outcome: s.outcome,
      winning: s.winning_outcome || 'null',
      has_resolution: s.payout_numerators && s.payout_numerators.length > 0 ? '✅' : '❌'
    })));
  } else {
    console.log('❌ No successful mappings found in sample');
  }

  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('CONCLUSION:');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  const test1Pass = parseFloat(test1.match_pct) >= 80;
  const test2Pass = parseFloat(test2.match_pct) >= 80;
  const test3Pass = parseFloat(test3.end_to_end_pct) >= 80;

  if (test1Pass && test2Pass && test3Pass) {
    console.log('✅ VERIFIED: gamma_markets is our bridge table!');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Rebuild ctf_token_map from gamma_markets');
    console.log('  2. Drop broken ctf_token_map');
    console.log('  3. CREATE TABLE ctf_token_map AS SELECT FROM gamma_markets');
    console.log('  4. Rebuild ctf_token_map_norm view');
    console.log('  5. Build Track A fixture with correct mappings');
  } else if (test3Pass) {
    console.log('⚠️  PARTIAL: gamma_markets works but has gaps');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Use gamma_markets as primary source');
    console.log('  2. Backfill gaps from Gamma API');
    console.log('  3. Rebuild ctf_token_map with merged data');
  } else {
    console.log('❌ FAILED: gamma_markets does not solve the problem');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Fall back to Option A: Gamma API backfill');
    console.log('  2. Query API for all unique asset_ids from clob_fills');
    console.log('  3. Build ctf_token_map from scratch');
  }

  console.log('');
}

main().catch(console.error);
