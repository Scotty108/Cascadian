import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { clickhouse } from './lib/clickhouse/client.js'

async function main() {
  const schema = await clickhouse.query({
    query: `DESCRIBE TABLE pm_trades_canonical_v2`,
    format: 'JSONEachRow'
  })
  const cols = await schema.json()
  console.log('pm_trades_canonical_v2 columns:')
  for (const c of cols as any[]) {
    console.log(`  ${c.name}: ${c.type}`)
  }
  
  console.log('\nSample row:')
  const sample = await clickhouse.query({
    query: `SELECT * FROM pm_trades_canonical_v2 LIMIT 1`,
    format: 'JSONEachRow'
  })
  const rows = await sample.json()
  if (rows.length > 0) {
    console.log(JSON.stringify(rows[0], null, 2))
  }
}

main().catch(console.error)
