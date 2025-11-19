/**
 * 25: VERIFY CONDITION_MARKET_MAP MATCHES
 *
 * Deep dive into the matches to understand the mapping
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('25: VERIFY CONDITION_MARKET_MAP MATCHES');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('📊 Step 1: Get sample traded conditions with their market mappings...\n');

  const query1 = await clickhouse.query({
    query: `
      WITH traded_conditions AS (
        SELECT DISTINCT cm.condition_id_norm
        FROM clob_fills cf
        INNER JOIN ctf_token_map_norm cm ON cm.asset_id = cf.asset_id
        WHERE cf.timestamp >= '2025-01-01'
        LIMIT 10
      ),
      market_map_normalized AS (
        SELECT
          lpad(lower(replaceAll(condition_id, '0x', '')), 64, '0') AS condition_id_norm,
          market_id,
          event_id
        FROM condition_market_map
      )
      SELECT
        t.condition_id_norm,
        m.market_id,
        m.event_id
      FROM traded_conditions t
      INNER JOIN market_map_normalized m ON m.condition_id_norm = t.condition_id_norm
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const matches: any[] = await query1.json();

  console.log(`Found ${matches.length} matches\n`);

  if (matches.length > 0) {
    console.log('Sample matches:');
    console.table(matches.map(m => ({
      condition_id: m.condition_id_norm.substring(0, 20) + '...',
      market_id: m.market_id.substring(0, 40) + '...',
      event_id: m.event_id ? m.event_id.substring(0, 30) + '...' : 'null'
    })));
  } else {
    console.log('⚠️  No matches found in sample\n');
  }

  console.log('\n📊 Step 2: Check if market_resolutions_final has these market_ids...\n');

  if (matches.length > 0) {
    const marketIds = matches.map(m => `'${m.market_id}'`).join(',');

    const query2 = await clickhouse.query({
      query: `
        SELECT
          count() AS total_resolutions,
          countIf(market_id IN (${marketIds})) AS matching_our_sample
        FROM market_resolutions_final
      `,
      format: 'JSONEachRow'
    });

    const result: any = (await query2.json())[0];

    console.log(`  Total resolutions in market_resolutions_final: ${parseInt(result.total_resolutions).toLocaleString()}`);
    console.log(`  Matching our traded sample: ${parseInt(result.matching_our_sample).toLocaleString()}\n`);
  }

  console.log('📊 Step 3: Build complete mapping chain...\n');
  console.log('  clob_fills → ctf_token_map_norm → condition_market_map → market_resolutions_final\n');

  const query3 = await clickhouse.query({
    query: `
      WITH traded_conditions AS (
        SELECT DISTINCT
          cm.condition_id_norm,
          count() AS fill_count
        FROM clob_fills cf
        INNER JOIN ctf_token_map_norm cm ON cm.asset_id = cf.asset_id
        WHERE cf.timestamp >= '2025-01-01'
        GROUP BY cm.condition_id_norm
        LIMIT 100
      ),
      market_map_normalized AS (
        SELECT
          lpad(lower(replaceAll(condition_id, '0x', '')), 64, '0') AS condition_id_norm,
          market_id
        FROM condition_market_map
      )
      SELECT
        count() AS traded_conditions_sample,
        countIf(m.market_id IS NOT NULL) AS has_market_mapping,
        round(countIf(m.market_id IS NOT NULL) / count() * 100, 1) AS mapping_pct
      FROM traded_conditions t
      LEFT JOIN market_map_normalized m ON m.condition_id_norm = t.condition_id_norm
    `,
    format: 'JSONEachRow'
  });

  const chainResult: any = (await query3.json())[0];

  console.log('Complete chain coverage:');
  console.log(`  Traded conditions (sample): ${chainResult.traded_conditions_sample}`);
  console.log(`  Has market_id mapping: ${chainResult.has_market_mapping}`);
  console.log(`  Mapping coverage: ${chainResult.mapping_pct}%\n`);

  console.log('📊 Step 4: Now check if those market_ids link to resolutions...\n');

  const query4 = await clickhouse.query({
    query: `
      WITH traded_market_ids AS (
        SELECT DISTINCT
          lpad(lower(replaceAll(cmm.condition_id, '0x', '')), 64, '0') AS condition_id_norm,
          cmm.market_id
        FROM clob_fills cf
        INNER JOIN ctf_token_map_norm cm ON cm.asset_id = cf.asset_id
        INNER JOIN condition_market_map cmm ON cmm.condition_id = concat('0x', cm.condition_id_norm)
        WHERE cf.timestamp >= '2025-01-01'
        LIMIT 100
      )
      SELECT
        count() AS traded_markets_sample,
        countDistinctIf(mr.market_id, mr.winning_index IS NOT NULL) AS has_resolution_data,
        round(countDistinctIf(mr.market_id, mr.winning_index IS NOT NULL) / count() * 100, 1) AS resolution_pct
      FROM traded_market_ids tm
      LEFT JOIN market_resolutions_final mr ON mr.market_id = tm.market_id
    `,
    format: 'JSONEachRow'
  });

  const resolutionResult: any = (await query4.json())[0];

  console.log('Resolution data coverage:');
  console.log(`  Traded markets (sample): ${resolutionResult.traded_markets_sample}`);
  console.log(`  Has resolution data: ${resolutionResult.has_resolution_data}`);
  console.log(`  Resolution coverage: ${resolutionResult.resolution_pct}%\n`);

  console.log('\n✅ VERIFICATION COMPLETE\n');
}

main().catch(console.error);
