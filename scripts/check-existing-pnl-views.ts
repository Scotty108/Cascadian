#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function main() {
  console.log('Finding existing PnL views...\n');

  // List all views in cascadian_clean
  const views = await client.query({
    query: `
      SELECT name, create_table_query
      FROM system.tables
      WHERE database = 'cascadian_clean'
        AND engine = 'View'
        AND (name LIKE '%pnl%' OR name LIKE '%position%')
      ORDER BY name
    `,
    format: 'JSONEachRow',
  });

  const rows = await views.json<Array<{ name: string; create_table_query: string }>>();

  if (rows.length === 0) {
    console.log('No PnL or position views found in cascadian_clean');
    console.log('\nNeed to create new PnL view from scratch.');
  } else {
    console.log('Found views:');
    rows.forEach(r => {
      console.log(`\n${'═'.repeat(80)}`);
      console.log(`View: ${r.name}`);
      console.log('─'.repeat(80));
      console.log(r.create_table_query);
    });
  }

  await client.close();
}

main().catch(console.error);
