#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function main() {
  console.log('Checking wallet resolution status...\n')

  // Get wallets with ANY resolved trades
  const withResolvedResult = await clickhouse.query({
    query: `
      SELECT COUNT(DISTINCT wallet_address) as count
      FROM trades_raw
      WHERE is_resolved = 1
    `,
    format: 'JSONEachRow'
  })
  const withResolved: any = await withResolvedResult.json()
  console.log('Wallets with at least 1 resolved trade:', withResolved[0].count.toLocaleString())

  // Get wallets with ONLY unresolved trades (is_resolved = 0)
  const onlyUnresolvedResult = await clickhouse.query({
    query: `
      SELECT COUNT(DISTINCT wallet_address) as count
      FROM trades_raw
      WHERE wallet_address NOT IN (
        SELECT DISTINCT wallet_address
        FROM trades_raw
        WHERE is_resolved = 1
      )
    `,
    format: 'JSONEachRow'
  })
  const onlyUnresolved: any = await onlyUnresolvedResult.json()
  console.log('Wallets with ZERO resolved trades:', onlyUnresolved[0].count.toLocaleString())

  // Get wallets with BOTH resolved and unresolved
  const mixedResult = await clickhouse.query({
    query: `
      SELECT COUNT(DISTINCT wallet_address) as count
      FROM (
        SELECT wallet_address
        FROM trades_raw
        WHERE is_resolved = 1
        GROUP BY wallet_address
        HAVING wallet_address IN (
          SELECT wallet_address
          FROM trades_raw
          WHERE is_resolved = 0
        )
      )
    `,
    format: 'JSONEachRow'
  })
  const mixed: any = await mixedResult.json()
  console.log('Wallets with BOTH resolved and unresolved:', mixed[0].count.toLocaleString())

  // Total wallets
  const totalResult = await clickhouse.query({
    query: `SELECT COUNT(DISTINCT wallet_address) as count FROM trades_raw`,
    format: 'JSONEachRow'
  })
  const total: any = await totalResult.json()
  console.log('\nTotal wallets:', total[0].count.toLocaleString())

  const zeroResolved = parseInt(onlyUnresolved[0].count)
  const totalWallets = parseInt(total[0].count)

  console.log('\n📊 Analysis:')
  console.log(`  ${zeroResolved} wallets (${(zeroResolved/totalWallets*100).toFixed(1)}%) have ZERO resolved trades - pure open positions`)
  console.log(`  ${totalWallets - zeroResolved} wallets (${((totalWallets-zeroResolved)/totalWallets*100).toFixed(1)}%) have at least some resolved trades`)
}

main()
