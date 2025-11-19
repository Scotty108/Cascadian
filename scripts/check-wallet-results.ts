#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@clickhouse/client';

config({ path: resolve(__dirname, '../.env.local') });

const TARGET_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

async function main() {
  console.log(`Checking for wallet: ${TARGET_WALLET}\n`);
  
  // Check wallet_realized_pnl view
  const result1 = await clickhouse.query({
    query: `SELECT count() as cnt FROM wallet_realized_pnl WHERE lower(wallet) = lower('${TARGET_WALLET}')`,
    format: 'JSONEachRow',
  });
  const count1 = await result1.json<{ cnt: string }>();
  console.log(`wallet_realized_pnl: ${count1[0].cnt} rows`);
  
  // Check wallet_condition_pnl view
  const result2 = await clickhouse.query({
    query: `SELECT count() as cnt FROM wallet_condition_pnl WHERE lower(wallet) = lower('${TARGET_WALLET}')`,
    format: 'JSONEachRow',
  });
  const count2 = await result2.json<{ cnt: string }>();
  console.log(`wallet_condition_pnl: ${count2[0].cnt} rows`);
  
  // Check wallet_condition_pnl_token view
  const result3 = await clickhouse.query({
    query: `SELECT count() as cnt FROM wallet_condition_pnl_token WHERE lower(wallet) = lower('${TARGET_WALLET}')`,
    format: 'JSONEachRow',
  });
  const count3 = await result3.json<{ cnt: string }>();
  console.log(`wallet_condition_pnl_token: ${count3[0].cnt} rows`);
  
  // Check wallet_token_flows view
  const result4 = await clickhouse.query({
    query: `SELECT count() as cnt FROM wallet_token_flows WHERE lower(wallet) = lower('${TARGET_WALLET}')`,
    format: 'JSONEachRow',
  });
  const count4 = await result4.json<{ cnt: string }>();
  console.log(`wallet_token_flows: ${count4[0].cnt} rows`);
  
  // Sample from wallet_token_flows
  const result5 = await clickhouse.query({
    query: `SELECT * FROM wallet_token_flows WHERE lower(wallet) = lower('${TARGET_WALLET}') LIMIT 3`,
    format: 'JSONEachRow',
  });
  const sample = await result5.json();
  console.log(`\nSample wallet_token_flows:`, JSON.stringify(sample, null, 2));
  
  // Check winners_ctf view
  const result6 = await clickhouse.query({
    query: `SELECT count() as cnt FROM winners_ctf`,
    format: 'JSONEachRow',
  });
  const count6 = await result6.json<{ cnt: string }>();
  console.log(`\nwinners_ctf: ${count6[0].cnt} rows`);
  
  // Sample from winners_ctf
  const result7 = await clickhouse.query({
    query: `SELECT * FROM winners_ctf LIMIT 3`,
    format: 'JSONEachRow',
  });
  const sample2 = await result7.json();
  console.log(`Sample winners_ctf:`, JSON.stringify(sample2, null, 2));
  
  await clickhouse.close();
}

main();
