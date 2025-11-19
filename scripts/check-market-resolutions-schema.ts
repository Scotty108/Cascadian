#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from './lib/clickhouse/client';

async function check() {
  const ch = getClickHouseClient();

  console.log('Checking market_resolutions_final schema and content...\n');

  try {
    // Get schema
    const schemaQuery = `DESCRIBE TABLE default.market_resolutions_final`;
    const schemaRes = await ch.query({ query: schemaQuery, format: 'JSONEachRow' });
    const schemaData = await schemaRes.json<any[]>();

    console.log('Schema columns:');
    schemaData.forEach((col: any) => {
      console.log(`  - ${col.name} (${col.type})`);
    });

    // Get sample row
    console.log('\nSample row:');
    const sampleQuery = `
      SELECT * FROM default.market_resolutions_final
      WHERE condition_id_norm = '01c2d9c6df76defb67e5c08e8f34be3b6d2d59109466c09a1963eb9acf4108d4'
      LIMIT 1
    `;
    const sampleRes = await ch.query({ query: sampleQuery, format: 'JSONEachRow' });
    const sampleData = await sampleRes.json<any[]>();

    if (sampleData.length > 0) {
      const row = sampleData[0];
      Object.entries(row).forEach(([key, val]: [string, any]) => {
        console.log(`  ${key}: ${String(val).substring(0, 80)}`);
      });
    }

  } catch (e: any) {
    console.error(`Error: ${e.message}`);
  }

  await ch.close();
}

check().catch(console.error);
