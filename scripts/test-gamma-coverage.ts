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

async function testGammaCoverage() {
  console.log('Testing coverage if we include gamma_markets in resolutions...\n');

  // Current coverage (market_resolutions_final only)
  console.log('1. CURRENT coverage (market_resolutions_final only):');
  const current = await client.query({
    query: `
      SELECT
        count(DISTINCT t.condition_id_norm) AS matched,
        (SELECT count(DISTINCT condition_id_norm)
         FROM default.vw_trades_canonical
         WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000') AS total
      FROM default.vw_trades_canonical t
      INNER JOIN cascadian_clean.vw_resolutions_all r
        ON lower(t.condition_id_norm) = r.cid_hex
      WHERE t.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
    `,
    format: 'JSONEachRow',
  });
  const c = (await current.json<Array<any>>())[0];
  console.log(`   Total markets traded: ${c.total.toLocaleString()}`);
  console.log(`   With resolutions: ${c.matched.toLocaleString()} (${(100 * c.matched / c.total).toFixed(1)}%)\n`);

  // Check how many gamma_markets have outcomes (resolved)
  console.log('2. gamma_markets resolved count:');
  const gammaResolved = await client.query({
    query: `
      SELECT count(DISTINCT condition_id) AS cnt
      FROM default.gamma_markets
      WHERE length(outcome) > 0 AND closed = 1
    `,
    format: 'JSONEachRow',
  });
  const g = (await gammaResolved.json<Array<any>>())[0];
  console.log(`   Resolved markets in gamma_markets: ${g.cnt.toLocaleString()}\n`);

  // Test combined coverage (market_resolutions_final + gamma_markets)
  console.log('3. COMBINED coverage (market_resolutions_final + gamma_markets):');
  const combined = await client.query({
    query: `
      WITH combined_resolutions AS (
        SELECT DISTINCT lower(concat('0x', condition_id_norm)) AS cid_hex
        FROM default.market_resolutions_final
        WHERE payout_denominator > 0

        UNION DISTINCT

        SELECT DISTINCT lower(condition_id) AS cid_hex
        FROM default.gamma_markets
        WHERE length(outcome) > 0 AND closed = 1
      )
      SELECT
        count(DISTINCT t.condition_id_norm) AS matched,
        (SELECT count(DISTINCT condition_id_norm)
         FROM default.vw_trades_canonical
         WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000') AS total
      FROM default.vw_trades_canonical t
      INNER JOIN combined_resolutions r
        ON lower(t.condition_id_norm) = r.cid_hex
      WHERE t.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
    `,
    format: 'JSONEachRow',
  });
  const cb = (await combined.json<Array<any>>())[0];
  const combinedPct = (100 * cb.matched / cb.total).toFixed(1);
  console.log(`   Total markets traded: ${cb.total.toLocaleString()}`);
  console.log(`   With resolutions: ${cb.matched.toLocaleString()} (${combinedPct}%)\n`);

  console.log('═'.repeat(80));
  console.log('RESULTS:');
  console.log(`  Current coverage:  ${(100 * c.matched / c.total).toFixed(1)}%`);
  console.log(`  Combined coverage: ${combinedPct}%`);
  console.log(`  Improvement:       +${(parseFloat(combinedPct) - (100 * c.matched / c.total)).toFixed(1)}%`);
  console.log();

  if (parseFloat(combinedPct) > 90) {
    console.log('🎉 gamma_markets gives us >90% coverage! No API backfill needed!');
  }

  await client.close();
}

testGammaCoverage();
