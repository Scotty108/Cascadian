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
  const tables = ['market_id_mapping', 'gamma_markets', 'market_key_map', 'market_resolutions_by_market'];

  for (const table of tables) {
    console.log(`\n${table}:`);
    try {
      const query = `DESCRIBE TABLE ${table}`;
      const result = await clickhouse.query({ query, format: 'JSONEachRow' });
      const data = await result.json();
      console.log(data.map((col: any) => `  ${col.name}: ${col.type}`).join('\n'));
    } catch (error: any) {
      console.log(`  ❌ Error: ${error.message}`);
    }
  }

  await clickhouse.close();
}

main();
