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
  console.log('Tables in cascadian_clean database:\n');

  const result = await client.query({
    query: `
      SELECT name, engine, total_rows, total_bytes
      FROM system.tables
      WHERE database = 'cascadian_clean'
      ORDER BY name
    `,
    format: 'JSONEachRow',
  });

  const tables = await result.json<any>();
  console.log(`Found ${tables.length} tables:\n`);

  tables.forEach((t: any) => {
    const sizeKB = (t.total_bytes / 1024).toFixed(0);
    const name = t.name.padEnd(40);
    const engine = t.engine.padEnd(20);
    const rows = t.total_rows.toLocaleString().padStart(12);
    const size = sizeKB.padStart(10);
    console.log(`  ${name} ${engine} ${rows} rows  ${size} KB`);
  });

  await client.close();
}

main().catch(console.error);
