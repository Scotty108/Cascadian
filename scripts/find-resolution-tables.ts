#!/usr/bin/env npx tsx
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function main() {
  console.log('\nFinding all tables with resolution/gamma/market/outcome data...\n');

  const tables = await ch.query({
    query: `
      SELECT database, name, total_rows
      FROM system.tables
      WHERE (name LIKE '%resolution%' OR name LIKE '%gamma%' OR name LIKE '%outcome%' OR name LIKE '%market%')
        AND database IN ('default', 'cascadian_clean')
        AND total_rows > 0
      ORDER BY total_rows DESC
    `,
    format: 'JSONEachRow',
  });

  const data = await tables.json<any[]>();

  console.log(`Found ${data.length} tables with data:\n`);
  data.forEach(t => {
    const rows = parseInt(t.total_rows);
    console.log(`  ${t.database}.${t.name}`.padEnd(60) + `${rows.toLocaleString()} rows`);
  });

  await ch.close();
}

main().catch(console.error);
