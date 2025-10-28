import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

async function main() {

  const result = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_trades,
        countIf(market_id != '') as trades_with_market_id,
        countIf(is_resolved = 1) as trades_resolved,
        countIf(realized_pnl_usd != 0) as trades_with_pnl,
        COUNT(DISTINCT wallet_address) as distinct_wallets
      FROM trades_raw
    `,
    format: 'JSONEachRow'
  })

  const rows = await result.json()
  console.log('TRADES_RAW_COVERAGE:', JSON.stringify(rows[0], null, 2))
}

main()
