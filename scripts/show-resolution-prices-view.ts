import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

async function showViewDef() {
  const result = await clickhouse.query({
    query: 'SHOW CREATE VIEW vw_pm_resolution_prices',
    format: 'JSONEachRow'
  })
  const rows = await result.json() as Array<{
    statement: string
  }>

  console.log('vw_pm_resolution_prices definition:')
  console.log(rows[0].statement)
}

showViewDef()
