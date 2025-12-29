import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

const PROBLEM_MARKET = 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1'
const PROBLEM_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'

async function check() {
  const result = await clickhouse.query({
    query: `
      SELECT *
      FROM vw_pm_realized_pnl_v1
      WHERE wallet_address = '${PROBLEM_WALLET}'
        AND condition_id = '${PROBLEM_MARKET}'
    `,
    format: 'JSONEachRow'
  })
  const rows = await result.json()
  console.log(`Rows returned: ${rows.length}`)
  console.log(JSON.stringify(rows, null, 2))
}

check()
