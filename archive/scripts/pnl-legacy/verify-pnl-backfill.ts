#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

async function main() {
  const wallets = [
    '0xb744f56635b537e859152d14b022af5afe485210',
    '0xc7f7edb333f5cbd8a3146805e21602984b852abf',
    '0x3a03c6dd168a7a24864c4df17bf4dd06be09a0b7',
    '0xd38b71f3e8ed1af71983e5c309eac3dfa9b35029',
    '0xe27b3674cfccb0cc87426d421ee3faaceb9168d2'
  ]

  console.log('\n=== (a) Trades with real P&L per wallet ===\n')

  const result = await clickhouse.query({
    query: `
      SELECT
        wallet_address,
        countIf(realized_pnl_usd != 0) AS trades_with_real_pnl,
        count() AS total_trades_for_wallet
      FROM trades_raw
      WHERE wallet_address IN ('${wallets.join("', '")}')
      GROUP BY wallet_address
      ORDER BY trades_with_real_pnl DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  })

  const rows = await result.json() as any[]
  for (const row of rows) {
    console.log(`${row.wallet_address}: ${row.trades_with_real_pnl} trades with P&L / ${row.total_trades_for_wallet} total`)
  }

  console.log('\n=== (b) Sample 5 updated rows for wallet #1 ===\n')

  const wallet1 = wallets[0]
  const sampleResult = await clickhouse.query({
    query: `
      SELECT
        wallet_address,
        condition_id,
        market_id,
        realized_pnl_usd,
        is_resolved,
        tx_timestamp
      FROM trades_raw
      WHERE wallet_address = '${wallet1}'
        AND realized_pnl_usd != 0
      LIMIT 5
    `,
    format: 'JSONEachRow'
  })

  const sampleRows = await sampleResult.json() as any[]
  console.log(JSON.stringify(sampleRows, null, 2))
}

main()
