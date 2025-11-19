/**
 * CHECK BRIDGE TABLES
 *
 * Purpose: Find if there's a bridge between asset_ids and condition_ids
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

const TARGET_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('BRIDGE TABLE INVESTIGATION');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Check 1: ctf_to_market_bridge_mat
  console.log('📊 Checking ctf_to_market_bridge_mat...\n');

  const bridgeQuery = await clickhouse.query({
    query: `
      SELECT
        ctf_token_id,
        condition_id,
        market_id,
        outcome_index,
        length(ctf_token_id) as token_length,
        length(condition_id) as cond_length
      FROM ctf_to_market_bridge_mat
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const bridge: any[] = await bridgeQuery.json();

  if (bridge.length > 0) {
    console.log(`Found ${bridge.length} bridge entries:\n`);
    for (const b of bridge.slice(0, 3)) {
      console.log(`CTF Token ID: ${b.ctf_token_id} (${b.token_length} chars)`);
      console.log(`Condition ID: ${b.condition_id} (${b.cond_length} chars)`);
      console.log(`Market ID: ${b.market_id}`);
      console.log(`Outcome Index: ${b.outcome_index}\n`);
    }

    // Try to match one of our asset_ids
    const sampleAsset = '1180825616743271225906568892492176429070437358338816695422876145047508718531';
    console.log(`\nChecking if our sample asset exists in bridge:\n`);
    console.log(`Sample asset_id: ${sampleAsset}\n`);

    const matchQuery = await clickhouse.query({
      query: `
        SELECT
          ctf_token_id,
          condition_id,
          market_id,
          outcome_index
        FROM ctf_to_market_bridge_mat
        WHERE ctf_token_id = '${sampleAsset}'
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });

    const match: any[] = await matchQuery.json();
    if (match.length > 0) {
      console.log('✅ MATCH FOUND in bridge!\n');
      console.log(`Condition ID: ${match[0].condition_id}`);
      console.log(`Market ID: ${match[0].market_id}`);
      console.log(`Outcome Index: ${match[0].outcome_index}\n`);

      // Now check if THIS condition_id is in resolutions
      const resQuery = await clickhouse.query({
        query: `
          SELECT
            condition_id_norm,
            winning_index,
            payout_numerators
          FROM market_resolutions_final
          WHERE condition_id_norm = '${match[0].condition_id}'
          LIMIT 1
        `,
        format: 'JSONEachRow'
      });

      const res: any[] = await resQuery.json();
      if (res.length > 0) {
        console.log('✅✅ RESOLUTION FOUND!\n');
        console.log(`Winning Index: ${res[0].winning_index}`);
        console.log(`Payout: ${JSON.stringify(res[0].payout_numerators)}\n`);
      } else {
        console.log('❌ Resolution NOT found for this condition_id\n');
      }
    } else {
      console.log('❌ Asset NOT found in bridge\n');
    }
  } else {
    console.log('⚠️  Bridge table is empty\n');
  }

  // Check 2: condition_market_map
  console.log('\n📊 Checking condition_market_map...\n');

  const condMapQuery = await clickhouse.query({
    query: `
      DESCRIBE TABLE condition_market_map
    `,
    format: 'JSONEachRow'
  });

  const condMapSchema: any[] = await condMapQuery.json();
  console.log('Schema:\n');
  for (const col of condMapSchema) {
    console.log(`  ${col.name}: ${col.type}`);
  }

  const condMapSample = await clickhouse.query({
    query: `
      SELECT *
      FROM condition_market_map
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const condMapData: any[] = await condMapSample.json();
  console.log(`\nSample rows: ${condMapData.length}\n`);
  if (condMapData.length > 0) {
    console.log(JSON.stringify(condMapData[0], null, 2));
  }

  // Check 3: Are the markets we're trading even resolved yet?
  console.log('\n📊 Checking market resolution coverage...\n');

  const coverageQuery = await clickhouse.query({
    query: `
      WITH wallet_markets AS (
        SELECT DISTINCT
          market_slug
        FROM clob_fills
        WHERE proxy_wallet = '${TARGET_WALLET}'
          AND market_slug != ''
      )
      SELECT
        COUNT(*) as total_markets,
        SUM(CASE WHEN r.condition_id_norm IS NOT NULL THEN 1 ELSE 0 END) as resolved_markets
      FROM wallet_markets wm
      LEFT JOIN market_resolutions_by_market r ON wm.market_slug = r.market_slug
    `,
    format: 'JSONEachRow'
  });

  const coverage: any = (await coverageQuery.json())[0];
  console.log(`Total markets traded: ${coverage.total_markets}`);
  console.log(`Markets with resolutions: ${coverage.resolved_markets}`);
  console.log(`Coverage: ${(coverage.resolved_markets / coverage.total_markets * 100).toFixed(1)}%\n`);

  console.log('✅ INVESTIGATION COMPLETE\n');
}

main().catch(console.error);
