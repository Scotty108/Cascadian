import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
(async () => {
  const client = createClient({
    url: process.env.CLICKHOUSE_HOST!,
    username: process.env.CLICKHOUSE_USER!,
    password: process.env.CLICKHOUSE_PASSWORD!,
  });
  const result = await client.query({
    query: `
      SELECT database, name, engine, total_rows
      FROM system.tables
      WHERE name IN ('trades_raw','vw_trades_canonical','trades_with_direction')
      ORDER BY database, name
    `,
    format: 'JSONEachRow'
  });
  const rows = await result.json<any[]>();
  console.log(rows);
  process.exit(0);
})();
