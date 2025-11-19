import * as dotenv from 'dotenv'
import * as path from 'path'
dotenv.config({ path: path.join(__dirname, '.env.local') })

import { getClickHouseClient } from './lib/clickhouse/client'
const client = getClickHouseClient()

async function findTables() {
  console.log('\n🔍 FINDING ACTUAL TABLES\n')
  
  // Find trades tables
  const tradesResult = await client.query({
    query: `
      SELECT 
        database,
        name,
        engine,
        total_rows,
        formatReadableSize(total_bytes) as size
      FROM system.tables
      WHERE (name LIKE '%trade%' OR name LIKE '%fill%' OR name LIKE '%clob%')
        AND database IN ('default', 'cascadian_clean')
        AND total_rows > 0
      ORDER BY total_rows DESC
      LIMIT 50
    `,
    format: 'JSONEachRow'
  })
  const trades = await tradesResult.json() as any[]
  
  console.log('TRADES/FILLS TABLES:')
  console.log(JSON.stringify(trades, null, 2))
  
  // Check market_resolutions_final schema
  const schemaResult = await client.query({
    query: `DESCRIBE TABLE default.market_resolutions_final`,
    format: 'JSONEachRow'
  })
  const schema = await schemaResult.json() as any[]
  
  console.log('\n\nmarket_resolutions_final SCHEMA:')
  console.log(JSON.stringify(schema, null, 2))
  
  // Check vw_wallet_pnl_closed schema
  try {
    const pnlSchema = await client.query({
      query: `DESCRIBE TABLE cascadian_clean.vw_wallet_pnl_closed`,
      format: 'JSONEachRow'
    })
    const pnl = await pnlSchema.json() as any[]
    console.log('\n\nvw_wallet_pnl_closed SCHEMA:')
    console.log(JSON.stringify(pnl, null, 2))
  } catch (e) {
    console.log('\n\nvw_wallet_pnl_closed SCHEMA: ERROR', (e as Error).message)
  }
}

findTables().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
