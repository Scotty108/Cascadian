#!/usr/bin/env npx tsx
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

async function main() {
  console.log('\n📋 RESOLUTION_CANDIDATES SCHEMA\n');

  try {
    const schema = await ch.query({
      query: `DESCRIBE default.resolution_candidates`,
      format: 'JSONEachRow'
    });

    const schemaData = await schema.json<any>();
    console.log('Columns:');
    schemaData.forEach((col: any) => {
      console.log(`  ${col.name.padEnd(30)} ${col.type}`);
    });

    const sample = await ch.query({
      query: `SELECT * FROM default.resolution_candidates LIMIT 3`,
      format: 'JSONEachRow'
    });

    const sampleData = await sample.json<any>();
    console.log('\nSample rows:');
    console.log(JSON.stringify(sampleData, null, 2));

  } catch (e: any) {
    console.log(`Error: ${e.message}`);
  }

  await ch.close();
}

main();
