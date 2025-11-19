#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function main() {
  console.log('RETEST: Is market_resolutions_final ALREADY keyed by condition_id?\n');

  // Direct join without any bridge
  const directTest = await client.query({
    query: `
      SELECT
        (SELECT count(DISTINCT cid_hex) FROM cascadian_clean.fact_trades_clean) AS fact_cids,
        (SELECT count() FROM default.market_resolutions_final) AS res_count,
        (SELECT count(DISTINCT f.cid_hex)
         FROM cascadian_clean.fact_trades_clean f
         INNER JOIN default.market_resolutions_final r
           ON lower(concat('0x', r.condition_id_norm)) = f.cid_hex
         WHERE r.winning_index IS NOT NULL AND r.payout_denominator > 0) AS direct_match,
        round(100.0 * direct_match / fact_cids, 2) AS direct_pct
    `,
    format: 'JSONEachRow',
  });

  const result = (await directTest.json<Array<{
    fact_cids: number;
    res_count: number;
    direct_match: number;
    direct_pct: number;
  }>>())[0];

  console.log('Direct join (no bridge):');
  console.log(`  Fact CIDs:       ${result.fact_cids.toLocaleString()}`);
  console.log(`  Resolutions:     ${result.res_count.toLocaleString()}`);
  console.log(`  Direct matches:  ${result.direct_match.toLocaleString()}`);
  console.log(`  Coverage:        ${result.direct_pct}%`);
  console.log();

  if (result.direct_pct > 20) {
    console.log('✅ market_resolutions_final IS ALREADY keyed by condition_id!');
    console.log('   The 24.8% we saw earlier was the real coverage.');
    console.log('   We don\'t need a bridge - we need MORE RESOLUTION DATA.');
    console.log();
    console.log('ACTUAL PROBLEM:');
    console.log(`  - We have ${result.res_count.toLocaleString()} resolutions`);
    console.log(`  - We have ${result.fact_cids.toLocaleString()} traded markets`);
    console.log(`  - ${result.direct_match.toLocaleString()} overlap (${result.direct_pct}%)`);
    console.log(`  - Missing: ${(result.fact_cids - result.direct_match).toLocaleString()} markets`);
  } else {
    console.log('❌ Direct join still fails - need different approach');
  }

  await client.close();
}

main().catch(console.error);
