#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

async function main() {
  const totalQuery = 'SELECT COUNT(DISTINCT condition_id) as total FROM trades_raw'
  const withMarketIdQuery = "SELECT COUNT(DISTINCT condition_id) as with_market FROM trades_raw WHERE market_id != '' AND market_id != 'unknown'"

  const total = await clickhouse.query({ query: totalQuery, format: 'JSONEachRow' })
  const withMarket = await clickhouse.query({ query: withMarketIdQuery, format: 'JSONEachRow' })

  const totalResult = await total.json<{ total: string }>()
  const withMarketResult = await withMarket.json<{ with_market: string }>()

  const totalCount = parseInt(totalResult[0].total)
  const withMarketCount = parseInt(withMarketResult[0].with_market)
  const coverage = (withMarketCount / totalCount * 100).toFixed(2)

  console.log(`\nDATA COVERAGE ANALYSIS\n`)
  console.log(`Total unique conditions: ${totalCount.toLocaleString()}`)
  console.log(`Conditions with market_id: ${withMarketCount.toLocaleString()}`)
  console.log(`Coverage: ${coverage}%`)
  console.log(`Missing market_ids: ${(totalCount - withMarketCount).toLocaleString()}\n`)
}

main()
