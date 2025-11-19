import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function check() {
  try {
    const result = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total,
          COUNT(CASE WHEN condition_id != '' THEN 1 END) as with_id,
          ROUND(COUNT(CASE WHEN condition_id != '' THEN 1 END) / COUNT(*) * 100, 2) as pct
        FROM trades_raw
      `
    })
    const text = await result.text()
    console.log(text)
  } catch (e: any) {
    console.error('Error:', e.message)
  }
}

check()
