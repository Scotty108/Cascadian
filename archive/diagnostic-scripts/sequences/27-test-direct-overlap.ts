/**
 * 27: TEST DIRECT OVERLAP
 *
 * Simple direct test of overlap between traded and resolutions
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('27: TEST DIRECT OVERLAP');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('📊 Step 1: Sample condition_ids from resolutions...\n');

  const query1 = await clickhouse.query({
    query: `
      SELECT condition_id_norm
      FROM market_resolutions_final
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const resSamples: any[] = await query1.json();

  console.log('Resolution condition_ids:');
  resSamples.forEach((s, i) => {
    console.log(`  ${i + 1}. ${s.condition_id_norm}`);
  });

  console.log('\n📊 Step 2: Sample condition_ids from traded assets...\n');

  const query2 = await clickhouse.query({
    query: `
      SELECT DISTINCT cm.condition_id_norm
      FROM clob_fills cf
      INNER JOIN ctf_token_map_norm cm ON cm.asset_id = cf.asset_id
      WHERE cf.timestamp >= '2025-01-01'
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });

  const tradedSamples: any[] = await query2.json();

  console.log('Traded condition_ids:');
  tradedSamples.forEach((s, i) => {
    console.log(`  ${i + 1}. ${s.condition_id_norm}`);
  });

  console.log('\n📊 Step 3: Check if ANY traded condition_ids exist in resolutions...\n');

  const query3 = await clickhouse.query({
    query: `
      WITH traded AS (
        SELECT DISTINCT cm.condition_id_norm
        FROM clob_fills cf
        INNER JOIN ctf_token_map_norm cm ON cm.asset_id = cf.asset_id
        WHERE cf.timestamp >= '2025-01-01'
        LIMIT 1000
      )
      SELECT
        count() AS traded_count,
        countIf(mr.condition_id_norm IS NOT NULL) AS has_resolution
      FROM traded t
      LEFT JOIN market_resolutions_final mr ON mr.condition_id_norm = t.condition_id_norm
    `,
    format: 'JSONEachRow'
  });

  const overlap: any = (await query3.json())[0];

  console.log(`  Traded conditions checked: ${overlap.traded_count}`);
  console.log(`  Has resolution data: ${overlap.has_resolution}`);
  console.log(`  Overlap: ${overlap.has_resolution}/${overlap.traded_count} = ${(overlap.has_resolution / overlap.traded_count * 100).toFixed(1)}%\n`);

  if (parseInt(overlap.has_resolution) === 0) {
    console.log('❌ ZERO OVERLAP CONFIRMED\n');
    console.log('This confirms the data disconnect:');
    console.log('  - Resolutions reference one set of condition_ids');
    console.log('  - Traded assets reference a completely different set\n');
  } else {
    console.log('🎉 OVERLAP FOUND!\n');
  }

  console.log('\n✅ TEST COMPLETE\n');
}

main().catch(console.error);
