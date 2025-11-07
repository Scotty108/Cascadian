#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { getClickHouseClient } from '../lib/clickhouse/client'

async function findWallets() {
  const client = getClickHouseClient()

  // Disable progress headers
  await client.command({ query: 'SET send_progress_in_http_headers = 0' })

  // Get top wallets by condition count
  const result = await client.query({
    query: `
      SELECT
        wallet,
        realized_pnl_usd,
        condition_count
      FROM shadow_v1.wallet_pnl_trades
      ORDER BY condition_count DESC, abs(realized_pnl_usd) DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  })

  const data = await result.json()
  console.log('Top 10 wallets by market coverage:')
  console.log(JSON.stringify(data, null, 2))
}

findWallets().catch(console.error)
