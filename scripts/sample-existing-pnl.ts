#!/usr/bin/env npx tsx

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@clickhouse/client'

const clickhouse = createClient({
  host: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
})

async function main() {
  const wallet = '0xc7f7edb333f5cbd8a3146805e21602984b852abf'

  // Query first 50 trades WITHOUT join requirement
  const query = `
    SELECT
      wallet_address,
      condition_id,
      side,
      entry_price,
      shares,
      was_win,
      pnl_net
    FROM trades_raw
    WHERE wallet_address = '${wallet}'
      AND pnl_net IS NOT NULL
    LIMIT 50
  `

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow',
  })

  const trades: any[] = await result.json()

  console.log(`═══════════════════════════════════════════════════════════`)
  console.log(`  EXISTING P&L DATA (OLD ENRICHMENT) - 50 SAMPLE TRADES`)
  console.log(`═══════════════════════════════════════════════════════════\n`)

  trades.forEach((trade, i) => {
    console.log(`Trade ${i + 1}:`)
    console.log(`  condition_id: ${trade.condition_id}`)
    console.log(`  side: ${trade.side}`)
    console.log(`  entry_price: ${trade.entry_price}`)
    console.log(`  shares: ${trade.shares}`)
    console.log(`  was_win: ${trade.was_win}`)
    console.log(`  pnl_net: ${trade.pnl_net}`)
    console.log()
  })

  // Calculate sum
  const sum = trades.reduce((acc, t) => acc + parseFloat(t.pnl_net), 0)
  console.log(`═══════════════════════════════════════════════════════════`)
  console.log(`Sum of 50 trades: $${sum.toFixed(2)}`)
  console.log(`Average: $${(sum / trades.length).toFixed(2)}`)
  console.log(`Extrapolated to 56,278 trades: $${((sum / trades.length) * 56278).toFixed(2)}`)

  await clickhouse.close()
}

main()
