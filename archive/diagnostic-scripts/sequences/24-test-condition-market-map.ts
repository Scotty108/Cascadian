/**
 * 24: TEST CONDITION_MARKET_MAP OVERLAP
 *
 * Check if condition_market_map has condition_ids that match traded assets
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('24: TEST CONDITION_MARKET_MAP OVERLAP');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('📊 Step 1: Normalize condition_market_map condition_ids...\n');

  const query1 = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        lpad(lower(replaceAll(condition_id, '0x', '')), 64, '0') AS condition_id_norm,
        market_id
      FROM condition_market_map
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const samples: any[] = await query1.json();

  console.log('Normalization test:');
  console.table(samples.map(s => ({
    original: s.condition_id,
    normalized: s.condition_id_norm,
    len: s.condition_id_norm.length
  })));

  console.log('\n📊 Step 2: Check overlap with traded assets...\n');

  const query2 = await clickhouse.query({
    query: `
      WITH traded_conditions AS (
        SELECT DISTINCT cm.condition_id_norm
        FROM clob_fills cf
        INNER JOIN ctf_token_map_norm cm ON cm.asset_id = cf.asset_id
        WHERE cf.timestamp >= '2025-01-01'
        LIMIT 100
      ),
      market_map_normalized AS (
        SELECT
          lpad(lower(replaceAll(condition_id, '0x', '')), 64, '0') AS condition_id_norm,
          market_id
        FROM condition_market_map
      )
      SELECT
        count() AS traded_sample_size,
        countIf(m.market_id IS NOT NULL) AS matches_found,
        round(countIf(m.market_id IS NOT NULL) / count() * 100, 1) AS match_pct
      FROM traded_conditions t
      LEFT JOIN market_map_normalized m ON m.condition_id_norm = t.condition_id_norm
    `,
    format: 'JSONEachRow'
  });

  const overlap: any = (await query2.json())[0];

  console.log('Overlap with traded assets:');
  console.log(`  Traded sample: ${overlap.traded_sample_size}`);
  console.log(`  Matches found: ${overlap.matches_found}`);
  console.log(`  Match %: ${overlap.match_pct}%\n`);

  if (parseInt(overlap.matches_found) > 0) {
    console.log('🎉 SUCCESS! condition_market_map has matches with traded assets!\n');

    // Show sample matches
    const query3 = await clickhouse.query({
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
            market_id
          FROM condition_market_map
        )
        SELECT
          t.condition_id_norm,
          m.market_id
        FROM traded_conditions t
        INNER JOIN market_map_normalized m ON m.condition_id_norm = t.condition_id_norm
        LIMIT 5
      `,
      format: 'JSONEachRow'
    });

    const matches: any[] = await query3.json();

    console.log('Sample matches:');
    console.table(matches.map(m => ({
      condition_id: m.condition_id_norm.substring(0, 20) + '...',
      market_id: m.market_id.substring(0, 30) + '...'
    })));

  } else {
    console.log('⚠️  No matches found - need to investigate further\n');
  }

  console.log('\n✅ TEST COMPLETE\n');
}

main().catch(console.error);
