import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('BRIDGE TABLE SCHEMAS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Check cascadian_clean.token_to_cid_bridge
  console.log('1. cascadian_clean.token_to_cid_bridge:\n');
  const schema1 = await clickhouse.query({
    query: `DESCRIBE cascadian_clean.token_to_cid_bridge`,
    format: 'JSONEachRow'
  });
  const cols1: any[] = await schema1.json();
  cols1.forEach(c => console.log(`   ${c.name.padEnd(30)} ${c.type}`));

  console.log('\n   Sample rows:\n');
  const sample1 = await clickhouse.query({
    query: `SELECT * FROM cascadian_clean.token_to_cid_bridge LIMIT 2`,
    format: 'JSONEachRow'
  });
  const rows1: any[] = await sample1.json();
  rows1.forEach(r => console.log('   ', JSON.stringify(r)));

  // Check default.api_ctf_bridge
  console.log('\n\n2. default.api_ctf_bridge:\n');
  const schema2 = await clickhouse.query({
    query: `DESCRIBE default.api_ctf_bridge`,
    format: 'JSONEachRow'
  });
  const cols2: any[] = await schema2.json();
  cols2.forEach(c => console.log(`   ${c.name.padEnd(30)} ${c.type}`));

  console.log('\n   Sample rows:\n');
  const sample2 = await clickhouse.query({
    query: `SELECT * FROM default.api_ctf_bridge LIMIT 2`,
    format: 'JSONEachRow'
  });
  const rows2: any[] = await sample2.json();
  rows2.forEach(r => console.log('   ', JSON.stringify(r)));

  // Check default.ctf_to_market_bridge_mat
  console.log('\n\n3. default.ctf_to_market_bridge_mat:\n');
  const schema3 = await clickhouse.query({
    query: `DESCRIBE default.ctf_to_market_bridge_mat`,
    format: 'JSONEachRow'
  });
  const cols3: any[] = await schema3.json();
  cols3.forEach(c => console.log(`   ${c.name.padEnd(30)} ${c.type}`));

  console.log('\n   Sample rows:\n');
  const sample3 = await clickhouse.query({
    query: `SELECT * FROM default.ctf_to_market_bridge_mat LIMIT 2`,
    format: 'JSONEachRow'
  });
  const rows3: any[] = await sample3.json();
  rows3.forEach(r => console.log('   ', JSON.stringify(r)));

  // Check default.market_key_map
  console.log('\n\n4. default.market_key_map:\n');
  const schema4 = await clickhouse.query({
    query: `DESCRIBE default.market_key_map`,
    format: 'JSONEachRow'
  });
  const cols4: any[] = await schema4.json();
  cols4.forEach(c => console.log(`   ${c.name.padEnd(30)} ${c.type}`));

  console.log('\n   Sample rows:\n');
  const sample4 = await clickhouse.query({
    query: `SELECT * FROM default.market_key_map LIMIT 2`,
    format: 'JSONEachRow'
  });
  const rows4: any[] = await sample4.json();
  rows4.forEach(r => console.log('   ', JSON.stringify(r)));

  console.log('\n═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
