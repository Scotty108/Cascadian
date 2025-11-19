/**
 * 32: SEARCH EXISTING TOKEN MAPPINGS
 *
 * Find if ANY table already has correct asset_id → condition_id mappings
 * before resorting to Gamma API backfill
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('32: SEARCH EXISTING TOKEN MAPPINGS');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('Mission: Find if we already have correct asset_id → condition_id mappings\n');

  // Get sample of most traded asset_ids
  console.log('📊 Step 1: Get top 10 traded asset_ids...\n');

  const query1 = await clickhouse.query({
    query: `
      SELECT
        asset_id,
        count() AS fill_count
      FROM clob_fills
      WHERE timestamp >= '2025-01-01'
      GROUP BY asset_id
      ORDER BY fill_count DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const topAssets: any[] = await query1.json();

  console.log('Top traded assets:');
  console.table(topAssets.map((a, i) => ({
    rank: i + 1,
    asset_id: a.asset_id.substring(0, 30) + '...',
    fills: a.fill_count
  })));

  const assetIds = topAssets.map(a => a.asset_id);
  console.log('\n');

  // Check gamma_markets
  console.log('📊 Step 2: Check gamma_markets...\n');

  const query2 = await clickhouse.query({
    query: `
      SELECT
        market_id,
        condition_id,
        question,
        length(condition_id) AS cid_len
      FROM gamma_markets
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const gammaSample: any[] = await query2.json();

  console.log('gamma_markets sample:');
  console.table(gammaSample.map(g => ({
    market_id: g.market_id.substring(0, 30) + '...',
    condition_id: g.condition_id ? g.condition_id.substring(0, 30) + '...' : 'null',
    cid_len: g.cid_len,
    question: g.question.substring(0, 40) + '...'
  })));

  console.log('\n📊 Step 3: Check if gamma_markets condition_ids match resolutions...\n');

  const query3 = await clickhouse.query({
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
        countIf(mr.condition_id_norm IS NOT NULL) AS matches_resolutions
      FROM gamma_cids gc
      LEFT JOIN market_resolutions_final mr ON mr.condition_id_norm = gc.condition_id_norm
    `,
    format: 'JSONEachRow'
  });

  const gammaMatch: any = (await query3.json())[0];

  console.log('gamma_markets → market_resolutions_final:');
  console.log(`  Sample size: ${gammaMatch.gamma_sample}`);
  console.log(`  Matches: ${gammaMatch.matches_resolutions}`);
  console.log(`  Match rate: ${(gammaMatch.matches_resolutions / gammaMatch.gamma_sample * 100).toFixed(1)}%\n`);

  // Check api_ctf_bridge
  console.log('📊 Step 4: Check api_ctf_bridge...\n');

  try {
    const query4 = await clickhouse.query({
      query: `DESCRIBE api_ctf_bridge`,
      format: 'JSONEachRow'
    });

    const bridgeSchema: any[] = await query4.json();

    console.log('api_ctf_bridge schema:');
    console.table(bridgeSchema.map(s => ({ name: s.name, type: s.type })));

    // Sample data
    const query5 = await clickhouse.query({
      query: `SELECT * FROM api_ctf_bridge LIMIT 3`,
      format: 'JSONEachRow'
    });

    const bridgeSample: any[] = await query5.json();

    console.log('\nSample rows:');
    console.log(JSON.stringify(bridgeSample, null, 2));
  } catch (e: any) {
    console.log(`❌ api_ctf_bridge error: ${e.message}`);
  }

  console.log('\n');

  // Check ctf_to_market_bridge_mat
  console.log('📊 Step 5: Check ctf_to_market_bridge_mat...\n');

  try {
    const query6 = await clickhouse.query({
      query: `DESCRIBE ctf_to_market_bridge_mat`,
      format: 'JSONEachRow'
    });

    const bridgeMatSchema: any[] = await query6.json();

    console.log('ctf_to_market_bridge_mat schema:');
    console.table(bridgeMatSchema.map(s => ({ name: s.name, type: s.type })));

    // Sample and check for our asset_ids
    const assetIdList = assetIds.map(id => `'${id}'`).join(',');

    const query7 = await clickhouse.query({
      query: `
        SELECT *
        FROM ctf_to_market_bridge_mat
        WHERE token_id IN (${assetIdList})
        LIMIT 10
      `,
      format: 'JSONEachRow'
    });

    const bridgeMatches: any[] = await query7.json();

    if (bridgeMatches.length > 0) {
      console.log('\n🎉 FOUND MATCHES in ctf_to_market_bridge_mat!\n');
      console.log('Sample matches:');
      console.log(JSON.stringify(bridgeMatches, null, 2));
    } else {
      console.log('\n❌ No matches for our top asset_ids in ctf_to_market_bridge_mat');
    }
  } catch (e: any) {
    console.log(`❌ ctf_to_market_bridge_mat error: ${e.message}`);
  }

  console.log('\n');

  // Check market_id_mapping
  console.log('📊 Step 6: Check market_id_mapping...\n');

  try {
    const query8 = await clickhouse.query({
      query: `DESCRIBE market_id_mapping`,
      format: 'JSONEachRow'
    });

    const mappingSchema: any[] = await query8.json();

    console.log('market_id_mapping schema:');
    console.table(mappingSchema.map(s => ({ name: s.name, type: s.type })));

    // Sample
    const query9 = await clickhouse.query({
      query: `SELECT * FROM market_id_mapping LIMIT 5`,
      format: 'JSONEachRow'
    });

    const mappingSample: any[] = await query9.json();

    console.log('\nSample rows:');
    console.log(JSON.stringify(mappingSample, null, 2));
  } catch (e: any) {
    console.log(`❌ market_id_mapping error: ${e.message}`);
  }

  console.log('\n');

  // List all tables with 'map', 'bridge', or 'token' in name
  console.log('📊 Step 7: List all potentially useful tables...\n');

  const query10 = await clickhouse.query({
    query: `
      SELECT name, engine, total_rows
      FROM system.tables
      WHERE database = currentDatabase()
        AND (
          name LIKE '%map%'
          OR name LIKE '%bridge%'
          OR name LIKE '%token%'
          OR name LIKE '%ctf%'
        )
      ORDER BY total_rows DESC
    `,
    format: 'JSONEachRow'
  });

  const tables: any[] = await query10.json();

  console.log('Potentially useful tables:');
  console.table(tables.map(t => ({
    name: t.name,
    engine: t.engine,
    rows: parseInt(t.total_rows).toLocaleString()
  })));

  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('CONCLUSION:');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log('Next steps based on findings:');
  console.log('');
  console.log('If ctf_to_market_bridge_mat has matches:');
  console.log('  → Use it to rebuild ctf_token_map');
  console.log('');
  console.log('If gamma_markets has good match rate with resolutions:');
  console.log('  → Find way to link asset_ids to gamma_markets');
  console.log('');
  console.log('If no existing mappings found:');
  console.log('  → Proceed with Gamma API backfill (Option A)');
  console.log('');
}

main().catch(console.error);
