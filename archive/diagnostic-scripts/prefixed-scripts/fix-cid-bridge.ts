import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('Fixing cid_bridge view with proper filtering...\n');

  // Drop and recreate with proper subquery to filter BEFORE conversion
  await clickhouse.command({
    query: `
      CREATE OR REPLACE VIEW cid_bridge AS
      SELECT
        condition_id_ctf,
        anyHeavy(condition_id_market) AS condition_id_market
      FROM (
        SELECT
          lower(hex(bitShiftRight(toUInt256(asset_id), 8))) AS condition_id_ctf,
          replaceAll(lower(condition_id), '0x', '') AS condition_id_market
        FROM clob_fills
        WHERE asset_id != 'asset'
          AND asset_id IS NOT NULL
          AND asset_id != ''
          AND condition_id IS NOT NULL
          AND condition_id != ''
      )
      GROUP BY condition_id_ctf
    `
  });

  console.log('✅ cid_bridge view fixed!\n');

  // Test it
  const testQuery = await clickhouse.query({
    query: `
      SELECT count() AS total_mappings
      FROM cid_bridge
    `,
    format: 'JSONEachRow'
  });
  const test = await testQuery.json();

  console.log(`Total CTF → Market mappings: ${test[0].total_mappings}\n`);

  // Test the specific CTF ID
  const specificQuery = await clickhouse.query({
    query: `
      SELECT *
      FROM cid_bridge
      WHERE condition_id_ctf LIKE '9f37e89c6646%'
    `,
    format: 'JSONEachRow'
  });
  const specific = await specificQuery.json();

  console.log('Test query for specific CTF ID:');
  if (specific.length > 0) {
    console.log(`   CTF: ${specific[0].condition_id_ctf}`);
    console.log(`   Market: ${specific[0].condition_id_market}\n`);
    console.log('✅ Bridge is working!\n');
  } else {
    console.log('   ⚠️  No mapping found\n');
  }
}

main().catch(console.error);
