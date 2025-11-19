#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '../lib/clickhouse/client'

async function main() {
  console.log('Checking both XCN proxy wallet candidates...\n')

  const candidates = [
    { addr: '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e', source: 'User says this is proxy' },
    { addr: '0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723', source: 'Polymarket API says this is proxy' },
    { addr: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', source: 'EOA (base wallet)' },
  ]

  for (const c of candidates) {
    console.log(`\n${'='.repeat(80)}`)
    console.log(`Wallet: ${c.addr}`)
    console.log(`Source: ${c.source}`)
    console.log('='.repeat(80))

    const query = `
      SELECT
        count() AS total_rows,
        uniq(transaction_hash) AS unique_txs,
        min(timestamp) AS first_trade,
        max(timestamp) AS last_trade,
        sum(toFloat64(usd_value)) AS total_volume,
        countIf(toYear(timestamp) = 2025) AS trades_2025,
        countIf(toYear(timestamp) < 2025) AS trades_valid
      FROM pm_trades_canonical_v3
      WHERE lower(wallet_address) = lower('${c.addr}')
    `

    try {
      const res = await clickhouse.query({ query, format: 'JSONEachRow' })
      const data = await res.json<any>()
      const row = data[0]

      console.log(`\nTotal Rows:      ${Number(row.total_rows).toLocaleString()}`)
      console.log(`Unique TXs:      ${Number(row.unique_txs).toLocaleString()}`)
      console.log(`Total Volume:    $${Number(row.total_volume).toLocaleString(undefined, { minimumFractionDigits: 2 })}`)
      console.log(`Valid Trades:    ${Number(row.trades_valid).toLocaleString()} (year < 2025)`)
      console.log(`Corrupted:       ${Number(row.trades_2025).toLocaleString()} (year 2025)`)

      if (row.first_trade) {
        console.log(`First Trade:     ${new Date(Number(row.first_trade) * 1000).toISOString().split('T')[0]}`)
      }
      if (row.last_trade && Number(row.trades_valid) > 0) {
        // Only show if has valid trades
        console.log(`Last Trade:      ${new Date(Number(row.last_trade) * 1000).toISOString().split('T')[0]}`)
      }

      // If this wallet has valid trades, show sample
      if (Number(row.trades_valid) > 0 && Number(row.trades_valid) < 10000) {
        console.log(`\n✅ This wallet has ${Number(row.trades_valid)} valid trades (matches ~1,299 expected)`)
      } else if (Number(row.trades_valid) >= 10000) {
        console.log(`\n❌ This wallet has ${Number(row.trades_valid)} trades (too many, likely corrupted)`)
      } else {
        console.log(`\n⚠️  This wallet has no valid trades`)
      }
    } catch (err: any) {
      console.error('Error:', err.message)
    }
  }

  console.log('\n' + '='.repeat(80))
  console.log('RECOMMENDATION:')
  console.log('='.repeat(80))
  console.log('Use the wallet with ~1,299 valid trades (year < 2025)')
  console.log('Ignore wallets with >10K trades (corrupted)')
  console.log('Ignore wallets with 0 trades (not the proxy)')

  await clickhouse.close()
}

main().catch(console.error)
