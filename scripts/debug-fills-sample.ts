import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

const condition_id = '0x700803904cd5bc5caac110bb58bee0097d2fbb328e0dc4ee494135cf79a46386'
const wallet = '0xc7f7edb333f5cbd8a3146805e21602984b852abf'

async function main() {
  const result = await clickhouse.query({
    query: `SELECT side, entry_price, shares FROM trades_raw WHERE wallet_address = '${wallet}' AND condition_id = '${condition_id}' ORDER BY timestamp ASC LIMIT 20`,
    format: 'JSONEachRow',
  })

  const fills = await result.json()
  console.log(JSON.stringify(fills, null, 2))
}

main()
