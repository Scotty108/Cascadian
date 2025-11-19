import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function check() {
  try {
    const result = await clickhouse.query({
      query: `SHOW TABLES LIKE 'trades_raw%'`
    })
    const text = await result.text()
    console.log(text)
  } catch (e: any) {
    console.error('Error:', e.message)
  }
}

check()
