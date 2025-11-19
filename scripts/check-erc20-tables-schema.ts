#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

async function main() {
  const client = getClickHouseClient()
  
  console.log(`\n🔍 CHECKING ERC20 TABLE SCHEMAS\n`);

  try {
    const tables = [
      "erc20_transfers",
      "erc20_transfers_staging",
      "erc20_transfers_decoded",
    ];

    for (const table of tables) {
      try {
        console.log(`\n═════════════════════════════════════════════════════════`);
        console.log(`Table: ${table}`);
        console.log(`═════════════════════════════════════════════════════════\n`);

        // Get count
        const countResult = await client.query({
          query: `SELECT count() as c FROM default.${table}`,
          format: 'JSONEachRow'
        });
        const countData = await countResult.json<any>();
        console.log(`Total rows: ${parseInt(countData[0].c).toLocaleString()}\n`);

        // Get schema
        const schemaResult = await client.query({
          query: `SELECT * FROM default.${table} LIMIT 1`,
          format: 'JSONEachRow'
        });
        const schemaData = await schemaResult.json<any>();
        const fields = Object.keys(schemaData[0]);
        
        console.log(`Fields (${fields.length}):`);
        for (const field of fields) {
          console.log(`  - ${field}`);
        }

        // Show a sample record
        console.log(`\nSample record:`);
        const sample = schemaData[0];
        for (const [key, value] of Object.entries(sample)) {
          const strVal = String(value).substring(0, 100);
          console.log(`  ${key}: ${strVal}`);
        }
      } catch (e: any) {
        console.log(`✗ ${table}: Error - ${e.message.substring(0, 200)}`);
      }
    }

    await client.close();
  } catch (e: any) {
    console.error('Error:', e.message)
  }
}

main()
