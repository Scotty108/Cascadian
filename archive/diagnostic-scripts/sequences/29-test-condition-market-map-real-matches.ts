/**
 * 29: TEST CONDITION_MARKET_MAP REAL MATCHES
 *
 * Verify if condition_market_map actually matches traded assets
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('29: TEST CONDITION_MARKET_MAP REAL MATCHES');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('📊 Step 1: Check condition_market_map schema...\n');

  const schemaQuery = await clickhouse.query({
    query: `DESCRIBE condition_market_map`,
    format: 'JSONEachRow'
  });

  const schema: any[] = await schemaQuery.json();

  console.log('Schema:');
  console.table(schema.map(s => ({ name: s.name, type: s.type })));

  console.log('\n📊 Step 2: Sample raw data from condition_market_map...\n');

  const sampleQuery = await clickhouse.query({
    query: `SELECT condition_id, market_id FROM condition_market_map LIMIT 5`,
    format: 'JSONEachRow'
  });

  const samples: any[] = await sampleQuery.json();

  console.log('Sample rows:');
  samples.forEach((s, i) => {
    console.log(`  ${i + 1}. condition_id: ${s.condition_id}`);
    console.log(`     market_id: ${s.market_id}\n`);
  });

  console.log('📊 Step 3: Test actual join with traded assets...\n');

  const joinQuery = await clickhouse.query({
    query: `
      SELECT
        t.condition_id_norm AS traded_cid,
        cmm.condition_id AS cmm_cid_raw,
        lpad(lower(replaceAll(cmm.condition_id, '0x', '')), 64, '0') AS cmm_cid_norm,
        t.condition_id_norm = lpad(lower(replaceAll(cmm.condition_id, '0x', '')), 64, '0') AS exact_match,
        cmm.market_id
      FROM (
        SELECT DISTINCT cm.condition_id_norm
        FROM clob_fills cf
        INNER JOIN ctf_token_map_norm cm ON cm.asset_id = cf.asset_id
        WHERE cf.timestamp >= '2025-01-01'
        LIMIT 10
      ) AS t
      LEFT JOIN condition_market_map cmm
        ON lpad(lower(replaceAll(cmm.condition_id, '0x', '')), 64, '0') = t.condition_id_norm
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const matches: any[] = await joinQuery.json();

  console.log(`Found ${matches.length} results\n`);

  console.table(matches.map(m => ({
    traded_cid: m.traded_cid ? m.traded_cid.substring(0, 20) + '...' : 'null',
    cmm_cid_raw: m.cmm_cid_raw ? m.cmm_cid_raw.substring(0, 25) + '...' : 'null',
    cmm_cid_norm: m.cmm_cid_norm ? m.cmm_cid_norm.substring(0, 20) + '...' : 'null',
    exact_match: m.exact_match,
    has_market_id: m.market_id ? 'yes' : 'no'
  })));

  const exactMatches = matches.filter(m => m.exact_match === 1).length;
  console.log(`\nExact matches: ${exactMatches}/${matches.length}`);

  if (exactMatches > 0) {
    console.log('\n🎉 CONFIRMED: condition_market_map DOES match traded assets!\n');
    console.log('Sample matched market_ids:');
    matches.filter(m => m.exact_match === 1).slice(0, 3).forEach((m, i) => {
      console.log(`  ${i + 1}. ${m.market_id}`);
    });
  } else {
    console.log('\n❌ FALSE POSITIVE: condition_market_map does NOT match traded assets\n');
  }

  console.log('\n✅ TEST COMPLETE\n');
}

main().catch(console.error);
