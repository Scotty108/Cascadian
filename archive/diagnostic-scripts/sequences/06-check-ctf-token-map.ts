import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('STEP 6: CHECK ctf_token_map FOR MISSING CTF IDs');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // First, understand the schema
  console.log('1. Schema of ctf_token_map:\n');

  const schemaQuery = await clickhouse.query({
    query: `DESCRIBE TABLE ctf_token_map`,
    format: 'JSONEachRow'
  });
  const schema: any[] = await schemaQuery.json();

  schema.forEach(col => {
    console.log(`   ${col.name.padEnd(30)} ${col.type}`);
  });
  console.log();

  // Sample data
  console.log('2. Sample data from ctf_token_map:\n');

  const sampleQuery = await clickhouse.query({
    query: `SELECT * FROM ctf_token_map LIMIT 3`,
    format: 'JSONEachRow'
  });
  const samples: any[] = await sampleQuery.json();

  samples.forEach((s, i) => {
    console.log(`   Sample ${i + 1}:`);
    Object.keys(s).forEach(key => {
      const val = typeof s[key] === 'string' && s[key].length > 40
        ? s[key].substring(0, 40) + '...'
        : s[key];
      console.log(`      ${key}: ${val}`);
    });
    console.log();
  });

  // The missing CTF IDs (64-char with leading zeros)
  const missingCtfs = [
    '001dcf4c1446fcacb42af305419f7310e7c9c356b2366367c25eb7d6fb202b48',
    '00d83a0c96a8f37f914ea3e2dbda3149446ee40b3127f7a144cec584ae195d22',
    '00f92278bd8759aa69d9d1286f359f02f3f3615088907c8b5ac83438bda452af',
    '00b2b715c86a72755bbdf9d133e02ab84f4c6ab270b5abead764d08f92bbb7ad',
    '00abdc242048b65fa2e976bb31bf0018931768118cd3c05e87c26d1daace4beb'
  ];

  console.log('3. Checking for missing CTF IDs in ctf_token_map:\n');

  for (const ctf of missingCtfs) {
    // Try matching by condition_id_norm (might be stored without leading zeros)
    const ctfWithout0x = ctf.replace(/^0x/, '').replace(/^0+/, ''); // Remove 0x and leading zeros

    const checkQuery = await clickhouse.query({
      query: `
        SELECT *
        FROM ctf_token_map
        WHERE lower(condition_id_norm) = lower('${ctf}')
          OR lower(condition_id_norm) = lower('${ctfWithout0x}')
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });
    const result = await checkQuery.json();

    if (result.length > 0) {
      console.log(`✅ FOUND: ${ctf.substring(0, 20)}...`);
      Object.keys(result[0]).forEach(key => {
        const val = typeof result[0][key] === 'string' && result[0][key].length > 40
          ? result[0][key].substring(0, 40) + '...'
          : result[0][key];
        console.log(`   ${key}: ${val}`);
      });
    } else {
      console.log(`❌ NOT FOUND: ${ctf.substring(0, 20)}...`);
    }
    console.log();
  }

  // Check other tables
  console.log('4. Checking condition_market_map:\n');

  const condMapQuery = await clickhouse.query({
    query: `DESCRIBE TABLE condition_market_map`,
    format: 'JSONEachRow'
  });
  const condMapSchema: any[] = await condMapQuery.json();

  console.log('   Schema:');
  condMapSchema.forEach(col => {
    console.log(`      ${col.name.padEnd(30)} ${col.type}`);
  });
  console.log();

  // Check erc1155_condition_map
  console.log('5. Checking erc1155_condition_map:\n');

  const ercCondQuery = await clickhouse.query({
    query: `SELECT count() AS total FROM erc1155_condition_map`,
    format: 'JSONEachRow'
  });
  const ercCondCount = await ercCondQuery.json();

  console.log(`   Total entries: ${ercCondCount[0].total}`);

  if (ercCondCount[0].total > 0) {
    const ercCondSchemaQuery = await clickhouse.query({
      query: `DESCRIBE TABLE erc1155_condition_map`,
      format: 'JSONEachRow'
    });
    const ercCondSchema: any[] = await ercCondSchemaQuery.json();

    console.log('   Schema:');
    ercCondSchema.forEach(col => {
      console.log(`      ${col.name.padEnd(30)} ${col.type}`);
    });
  }
  console.log();
}

main().catch(console.error);
