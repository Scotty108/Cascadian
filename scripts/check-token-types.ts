#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { createClient } from '@clickhouse/client';

config({ path: '.env.local' });

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE,
});

async function main() {
  // Check schemas
  console.log('\nerc1155_transfers:');
  const erc1155 = await clickhouse.query({ query: 'DESCRIBE TABLE erc1155_transfers', format: 'JSONEachRow' });
  const erc1155Data = await erc1155.json();
  const tokenCol = erc1155Data.find((c: any) => c.name === 'token_id');
  console.log(`  token_id: ${tokenCol.type}`);

  console.log('\nctf_token_map:');
  const ctf = await clickhouse.query({ query: 'DESCRIBE TABLE ctf_token_map', format: 'JSONEachRow' });
  const ctfData = await ctf.json();
  const ctfTokenCol = ctfData.find((c: any) => c.name === 'token_id');
  console.log(`  token_id: ${ctfTokenCol.type}`);

  console.log('\nerc1155_condition_map:');
  const erc = await clickhouse.query({ query: 'DESCRIBE TABLE erc1155_condition_map', format: 'JSONEachRow' });
  const ercData = await erc.json();
  const ercTokenCol = ercData.find((c: any) => c.name === 'token_id');
  console.log(`  token_id: ${ercTokenCol.type}`);

  // Sample values
  console.log('\nSample token_id from erc1155_transfers:');
  const sample1 = await clickhouse.query({ query: 'SELECT token_id FROM erc1155_transfers LIMIT 5', format: 'JSONEachRow' });
  const sample1Data = await sample1.json();
  console.log(sample1Data);

  console.log('\nSample token_id from ctf_token_map:');
  const sample2 = await clickhouse.query({ query: 'SELECT token_id FROM ctf_token_map LIMIT 5', format: 'JSONEachRow' });
  const sample2Data = await sample2.json();
  console.log(sample2Data);

  await clickhouse.close();
}

main();
