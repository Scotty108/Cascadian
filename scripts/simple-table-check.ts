#!/usr/bin/env npx tsx
/**
 * Simple Table Check - Just list what tables exist
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  request_timeout: 60000
});

async function main() {
  console.log('\n📋 SIMPLE TABLE CHECK\n');

  try {
    const result = await ch.query({
      query: `
        SELECT
          database,
          name,
          engine,
          total_rows
        FROM system.tables
        WHERE database IN ('default', 'cascadian')
          AND (
            name LIKE '%resolution%'
            OR name LIKE '%trade%'
            OR name LIKE '%market%'
          )
        ORDER BY total_rows DESC
        LIMIT 20
      `,
      format: 'JSONEachRow'
    });

    const data = await result.json<any>();

    console.log(`Found ${data.length} relevant tables:\n`);

    for (const table of data) {
      console.log(`${table.database}.${table.name}`);
      console.log(`  Engine: ${table.engine}`);
      console.log(`  Rows: ${Number(table.total_rows).toLocaleString()}\n`);
    }

  } catch (error: any) {
    console.error('Error:', error.message);
  }

  await ch.close();
}

main();
