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

async function listDatabases() {
  const result = await client.query({
    query: 'SHOW DATABASES',
    format: 'JSONEachRow',
  });

  const dbs = await result.json<Array<{ name: string }>>();

  console.log('DATABASES IN CLICKHOUSE:\n');
  console.log('═'.repeat(80));

  for (const db of dbs) {
    const stats = await client.query({
      query: `
        SELECT
          count() as tables,
          formatReadableSize(sum(total_bytes)) as total_size
        FROM system.tables
        WHERE database = '${db.name}'
      `,
      format: 'JSONEachRow',
    });
    const s = (await stats.json<any[]>())[0];
    console.log(`${db.name.padEnd(30)} - ${s.tables.toString().padStart(3)} tables, ${s.total_size}`);
  }

  await client.close();
}

listDatabases().catch(console.error);
