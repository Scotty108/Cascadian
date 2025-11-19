import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('=== TABLE INVENTORY ===\n')

  const q1 = await clickhouse.query({
    query: `
      SELECT
        name,
        engine,
        total_rows,
        formatReadableSize(total_bytes) as size,
        total_bytes
      FROM system.tables
      WHERE database = currentDatabase()
      ORDER BY total_bytes DESC
      LIMIT 50
    `,
    format: 'JSONEachRow',
  })
  
  const tables = await q1.json<Array<{ name: string; engine: string; total_rows: string; size: string; total_bytes: string }>>()
  
  console.log('Top 50 tables by size:')
  let idx = 0
  for (const t of tables) {
    idx = idx + 1
    const rows = parseInt(t.total_rows)
    const rowsStr = rows === 0 ? 'EMPTY' : rows.toString()
    const idxStr = idx.toString() + '.  '
    const idxPadded = idxStr.substring(0, 4)
    const namePadded = (t.name + '                                        ').substring(0, 40)
    const rowsPadded = ('            ' + rowsStr).slice(-12)
    const sizePadded = ('          ' + t.size).slice(-10)
    console.log('   ' + idxPadded + namePadded + ' ' + rowsPadded + ' rows  ' + sizePadded)
  }

  const emptyCount = tables.filter(t => parseInt(t.total_rows) === 0).length
  console.log('\nEmpty tables in top 50: ' + emptyCount)

  const q2 = await clickhouse.query({
    query: `
      SELECT
        count(*) as total_tables,
        countIf(total_rows = 0) as empty_tables,
        sum(total_rows) as total_rows,
        formatReadableSize(sum(total_bytes)) as total_size
      FROM system.tables
      WHERE database = currentDatabase()
    `,
    format: 'JSONEachRow',
  })
  
  const stats = (await q2.json<{ total_tables: string; empty_tables: string; total_rows: string; total_size: string }>())[0]
  
  console.log('\nDatabase totals:')
  console.log('   Total tables:', stats.total_tables)
  console.log('   Empty tables:', stats.empty_tables)
  console.log('   Total rows:', stats.total_rows)
  console.log('   Total size:', stats.total_size)
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); })
