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
  console.log('Checking vw_positions_open schema...\n');

  const result = await client.query({
    query: `DESCRIBE cascadian_clean.vw_positions_open`,
    format: 'JSONEachRow',
  });

  const cols = await result.json<any>();
  console.log('Available columns:');
  cols.forEach((c: any) => {
    console.log(`  ${c.name.padEnd(30)} ${c.type}`);
  });

  console.log('\n\nSample data:');
  const dataResult = await client.query({
    query: `SELECT * FROM cascadian_clean.vw_positions_open LIMIT 3`,
    format: 'JSONEachRow',
  });
  const data = await dataResult.json<any>();
  console.log(JSON.stringify(data, null, 2));

  await client.close();
}

main().catch(console.error);
