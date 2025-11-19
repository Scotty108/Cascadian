/**
 * 10: FIND EVENT AND RESOLUTION TABLES
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('Finding event and resolution tables...\n');

  const query = await clickhouse.query({
    query: `
      SELECT name, engine, total_rows
      FROM system.tables
      WHERE database = currentDatabase()
        AND (
          name LIKE '%event%'
          OR name LIKE '%resolution%'
          OR name LIKE '%condition%'
          OR name LIKE '%ctf%'
          OR name LIKE '%gamma%'
        )
      ORDER BY name
    `,
    format: 'JSONEachRow'
  });

  const tables: any[] = await query.json();

  console.table(tables);

  console.log(`\nFound ${tables.length} tables\n`);
}

main().catch(console.error);
