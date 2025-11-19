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

async function investigateOverlap() {
  console.log('Investigating why gamma_markets doesnt improve coverage...\n');

  // Check: Do gamma_markets condition_ids exist in our trades?
  console.log('1. How many gamma_markets condition_ids exist in our trades?');
  const overlap = await client.query({
    query: `
      SELECT count(DISTINCT g.condition_id) AS cnt
      FROM default.gamma_markets g
      INNER JOIN default.vw_trades_canonical t
        ON lower(g.condition_id) = lower(t.condition_id_norm)
      WHERE g.closed = 1 AND length(g.outcome) > 0
    `,
    format: 'JSONEachRow',
  });
  const o = (await overlap.json<Array<any>>())[0];
  console.log(`   Matched: ${o.cnt.toLocaleString()} out of 139K gamma_markets`);
  console.log(`   This means ${((139207 - o.cnt) / 139207 * 100).toFixed(1)}% of gamma_markets are NOT in our trades\n`);

  // Check: Sample of gamma_markets condition_ids that ARE in our trades
  console.log('2. Sample of gamma_markets condition_ids that ARE in vw_trades_canonical:');
  const inTrades = await client.query({
    query: `
      SELECT DISTINCT g.condition_id
      FROM default.gamma_markets g
      INNER JOIN default.vw_trades_canonical t
        ON lower(g.condition_id) = lower(t.condition_id_norm)
      WHERE g.closed = 1 AND length(g.outcome) > 0
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const it = await inTrades.json<Array<{condition_id: string}>>();
  it.forEach(r => console.log(`   ${r.condition_id}`));
  console.log();

  // Check: Sample of trades condition_ids NOT in gamma_markets
  console.log('3. Sample of vw_trades_canonical condition_ids NOT in gamma_markets:');
  const notInGamma = await client.query({
    query: `
      SELECT DISTINCT t.condition_id_norm
      FROM default.vw_trades_canonical t
      LEFT JOIN default.gamma_markets g
        ON lower(t.condition_id_norm) = lower(g.condition_id)
      WHERE g.condition_id IS NULL
        AND t.condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const nig = await notInGamma.json<Array<{condition_id_norm: string}>>();
  nig.forEach(r => console.log(`   ${r.condition_id_norm}`));
  console.log();

  console.log('═'.repeat(80));
  console.log('CONCLUSION:');
  if (o.cnt < 50000) {
    console.log('  gamma_markets condition_ids are DIFFERENT from our trade token IDs');
    console.log('  We need to either:');
    console.log('    1. Find a mapping table (token_id → market condition_id)');
    console.log('    2. Use the API to fetch by token_id');
    console.log('    3. Derive market condition_id from token_id mathematically');
  }

  await client.close();
}

investigateOverlap();
