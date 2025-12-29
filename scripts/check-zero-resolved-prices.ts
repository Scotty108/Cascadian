import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

async function checkZeroPrices() {
  console.log('Checking for resolved_price = 0 in vw_pm_resolution_prices...\n')

  const result = await clickhouse.query({
    query: `
      SELECT
        count() as total_rows,
        sum(CASE WHEN resolved_price = 0 THEN 1 ELSE 0 END) as zero_price_count,
        sum(CASE WHEN resolved_price IS NULL THEN 1 ELSE 0 END) as null_price_count
      FROM vw_pm_resolution_prices
    `,
    format: 'JSONEachRow'
  })
  const stats = await result.json() as Array<{
    total_rows: string
    zero_price_count: string
    null_price_count: string
  }>

  console.log(`Total rows: ${parseInt(stats[0].total_rows).toLocaleString()}`)
  console.log(`Rows with resolved_price = 0: ${parseInt(stats[0].zero_price_count).toLocaleString()}`)
  console.log(`Rows with resolved_price IS NULL: ${parseInt(stats[0].null_price_count).toLocaleString()}`)

  // Get sample markets with resolved_price = 0
  const samplesResult = await clickhouse.query({
    query: `
      SELECT *
      FROM vw_pm_resolution_prices
      WHERE resolved_price = 0
      LIMIT 10
    `,
    format: 'JSONEachRow'
  })
  const samples = await samplesResult.json()

  console.log(`\nSample markets with resolved_price = 0:`)
  console.log(JSON.stringify(samples, null, 2))
}

checkZeroPrices()
