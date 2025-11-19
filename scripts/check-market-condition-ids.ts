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

async function checkMarketConditionIds() {
  console.log('Checking for market-level condition_ids in our tables...\n');

  // Check gamma_markets table
  console.log('1. Checking gamma_markets table:');
  const gammaCheck = await client.query({
    query: `
      SELECT count() AS total,
             count(DISTINCT condition_id) AS unique_cids
      FROM default.gamma_markets
      LIMIT 1
    `,
    format: 'JSONEachRow',
  });
  const gamma = (await gammaCheck.json<Array<any>>())[0];
  console.log(`   Total rows: ${gamma.total.toLocaleString()}`);
  console.log(`   Unique condition_ids: ${gamma.unique_cids.toLocaleString()}\n`);

  // Sample from gamma_markets
  console.log('   Sample condition_ids from gamma_markets:');
  const gammaSample = await client.query({
    query: `
      SELECT DISTINCT condition_id
      FROM default.gamma_markets
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const gSamples = await gammaSample.json<Array<{condition_id: string}>>();
  gSamples.forEach(s => console.log(`     ${s.condition_id}`));
  console.log();

  // Check market_resolutions_final
  console.log('2. Checking market_resolutions_final:');
  const resCheck = await client.query({
    query: `
      SELECT count() AS total,
             count(DISTINCT condition_id_norm) AS unique_cids
      FROM default.market_resolutions_final
      LIMIT 1
    `,
    format: 'JSONEachRow',
  });
  const res = (await resCheck.json<Array<any>>())[0];
  console.log(`   Total rows: ${res.total.toLocaleString()}`);
  console.log(`   Unique condition_ids: ${res.unique_cids.toLocaleString()}\n`);

  // Check trades canonical
  console.log('3. Checking vw_trades_canonical (our token IDs):');
  const tradesCheck = await client.query({
    query: `
      SELECT count() AS total,
             count(DISTINCT condition_id_norm) AS unique_cids
      FROM default.vw_trades_canonical
      WHERE condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      LIMIT 1
    `,
    format: 'JSONEachRow',
  });
  const trades = (await tradesCheck.json<Array<any>>())[0];
  console.log(`   Total rows: ${trades.total.toLocaleString()}`);
  console.log(`   Unique condition_ids (token IDs): ${trades.unique_cids.toLocaleString()}\n`);

  console.log('═'.repeat(80));
  console.log('ANALYSIS:');
  console.log(`  gamma_markets has ${gamma.unique_cids.toLocaleString()} unique MARKET condition_ids`);
  console.log(`  vw_trades_canonical has ${trades.unique_cids.toLocaleString()} unique TOKEN IDs`);
  console.log(`  Ratio: ${(trades.unique_cids / gamma.unique_cids).toFixed(1)}x (each market has ~2 tokens: YES/NO)`);

  await client.close();
}

checkMarketConditionIds();
