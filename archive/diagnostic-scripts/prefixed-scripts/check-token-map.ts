import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

const BURNED_TOKENS = [
  '0x90e376d45860f769c41469d7f7e59c576cdd8566a8fcf783f80934ad2d425871',
  '0x1dcf4c1446fcacb42a6e76e5e1dd63cd3ffc4b70e5c6e61bdb9f9feacd51e80f',
  '0xd83a0c96a8f37f914ef47e1e8bcf5c31dfede7ec3d20fa76ff6ce42ed5f1a94e',
  '0xf92278bd8759aa69d93c21e8e2b23a29f850ae42f02a4cc681f3a0aeabf9c7bc',
  '0xb2b715c86a72755bbd8eb68e2bb0b37ccce14a2734c7f9c63cbe5d09e2ae1ddb',
  '0xabdc242048b65fa2e90b3a21a44784b1ab12c5f7b2f7bc5b5e5fae10dd8aed8f',
  '0xa972afa513fbe4fd5a9b1b5cf5e83c1c42b8ed7e7e25eb53b889f8b3b8df9c87',
  '0x382a9807918745dccf6b81be6c66f0f1cdd93a9b7ba2d6beafa5af32e5c22c18',
  '0x1e511c90e45a81eb17a00ad4d7f8b8ad6cb2b8c8f4f0e0cc8bc3c06abf0fa1e3',
  '0x794ea2b0af18addcee12f634db48cb18ada77e9cfe7f827e9b8be0f0c8cddff0'
];

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('CHECK CTF_TOKEN_MAP FOR BURNED TOKENS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Check schema
  console.log('Step 1: Check ctf_token_map schema...\n');

  const schemaQuery = await clickhouse.query({
    query: `DESCRIBE default.ctf_token_map`,
    format: 'JSONEachRow'
  });

  const schema: any[] = await schemaQuery.json();

  console.log('Schema:');
  schema.forEach(col => {
    console.log(`   ${col.name.padEnd(30)} ${col.type}`);
  });
  console.log();

  // Check if any burned tokens are in the map
  console.log('Step 2: Check if burned token_ids are in ctf_token_map...\n');

  for (const tokenId of BURNED_TOKENS.slice(0, 3)) {  // Check first 3
    const mapQuery = await clickhouse.query({
      query: `
        SELECT *
        FROM default.ctf_token_map
        WHERE lower(token_id) = lower('${tokenId}')
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });

    const maps: any[] = await mapQuery.json();

    if (maps.length > 0) {
      console.log(`   ✅ Found mapping for ${tokenId.substring(0, 20)}...:`);
      Object.entries(maps[0]).forEach(([key, value]) => {
        console.log(`      ${key}: ${value}`);
      });
      console.log();
    } else {
      console.log(`   ❌ No mapping for ${tokenId.substring(0, 20)}...\n`);
    }
  }

  // Sample some rows from ctf_token_map to understand structure
  console.log('Step 3: Sample rows from ctf_token_map...\n');

  const sampleQuery = await clickhouse.query({
    query: `
      SELECT *
      FROM default.ctf_token_map
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const samples: any[] = await sampleQuery.json();

  samples.forEach((row, i) => {
    console.log(`   Row ${i + 1}:`);
    Object.entries(row).forEach(([key, value]) => {
      console.log(`      ${key}: ${value}`);
    });
    console.log();
  });

  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
