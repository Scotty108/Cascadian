import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

const MARKET = 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1'

async function checkView() {
  const result = await clickhouse.query({
    query: `SELECT * FROM vw_pm_resolution_prices WHERE condition_id = '${MARKET}'`,
    format: 'JSONEachRow'
  })
  const rows = await result.json()
  console.log(`Rows in vw_pm_resolution_prices: ${rows.length}`)
  console.log(JSON.stringify(rows, null, 2))
}

checkView()
