#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import * as fs from 'fs'
import { clickhouse } from './lib/clickhouse/client'

async function main() {
  // Load resolution map
  const resData = JSON.parse(fs.readFileSync('data/expanded_resolution_map.json', 'utf-8'))
  const conditionIds = resData.resolutions.map((r: any) => `'${r.condition_id}'`).join(',')

  console.log('Resolution map has', resData.resolutions.length, 'conditions\n')

  // Check how many trades + wallets this covers
  const result = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as trades_count,
        COUNT(DISTINCT wallet_address) as wallet_count,
        COUNT(DISTINCT condition_id) as condition_count
      FROM trades_raw
      WHERE condition_id IN (${conditionIds})
        AND is_resolved = 0
    `,
    format: 'JSONEachRow'
  })

  const data: any = await result.json()
  console.log('Impact of using existing resolution map:')
  console.log('  Trades that can be resolved:', data[0].trades_count.toLocaleString())
  console.log('  Wallets affected:', data[0].wallet_count.toLocaleString())
  console.log('  Conditions matched:', data[0].condition_count.toLocaleString())

  // Check how many wallets would have metrics after
  const walletMetrics = await clickhouse.query({
    query: `
      SELECT COUNT(DISTINCT wallet_address) as wallet_count
      FROM trades_raw
      WHERE is_resolved = 1 OR condition_id IN (${conditionIds})
    `,
    format: 'JSONEachRow'
  })

  const walletData: any = await walletMetrics.json()
  console.log('\nWallets with resolved trades (after applying map):', walletData[0].wallet_count.toLocaleString())
}

main()
