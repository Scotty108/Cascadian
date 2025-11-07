#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { getClickHouseClient } from '../lib/clickhouse/client'

async function queryWallets() {
  const client = getClickHouseClient()

  const wallets = [
    '0x1489046ca0f9980fc2d9a950d103d3bec02c1307',
    '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
    '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
    '0x6770bf688b8121331b1c5cfd7723ebd4152545fb'
  ]

  for (const wallet of wallets) {
    const result = await client.query({
      query: `
        SELECT
          wallet,
          realized_pnl_usd,
          condition_count
        FROM shadow_v1.wallet_pnl_trades
        WHERE wallet = '${wallet}'
      `,
      format: 'JSONEachRow'
    })

    const data = await result.json()
    if (data.length > 0) {
      console.log(`${wallet}: $${data[0].realized_pnl_usd} (${data[0].condition_count} markets)`)
    } else {
      console.log(`${wallet}: NO DATA`)
    }
  }
}

queryWallets().catch(console.error)
