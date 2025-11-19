import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('=== DATABASE TOTALS ===\n')

  const q = await clickhouse.query({
    query: `
      SELECT
        count(*) as total_tables,
        countIf(total_rows = 0) as empty_tables,
        sum(total_rows) as sum_rows,
        formatReadableSize(sum(total_bytes)) as total_size
      FROM system.tables
      WHERE database = currentDatabase()
    `,
    format: 'JSONEachRow',
  })
  
  const stats = (await q.json<{ total_tables: string; empty_tables: string; sum_rows: string; total_size: string }>())[0]
  
  console.log('Total tables:', stats.total_tables)
  console.log('Empty tables:', stats.empty_tables)
  console.log('Total rows:', stats.sum_rows)
  console.log('Total size:', stats.total_size)
  
  const emptyPct = (parseInt(stats.empty_tables) / parseInt(stats.total_tables) * 100).toFixed(1)
  console.log('Empty percentage:', emptyPct + '%')
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); })
