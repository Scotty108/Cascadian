#!/usr/bin/env npx tsx

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function main() {
  console.log('Analyzing remaining transactions...\n')

  const result = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total,
        COUNT(DISTINCT market_id) as unique_markets,
        COUNT(CASE WHEN market_id = '0x0000000000000000000000000000000000000000000000000000000000000000' THEN 1 END) as zero_market_ids,
        MIN(timestamp) as earliest,
        MAX(timestamp) as latest,
        COUNT(CASE WHEN toYear(timestamp) < 2023 THEN 1 END) as before_2023,
        COUNT(CASE WHEN condition_id = '' OR condition_id IS NULL THEN 1 END) as missing_condition_id
      FROM trades_raw
      WHERE transaction_hash NOT IN (
        SELECT DISTINCT tx_hash FROM erc1155_transfers
      )
      AND transaction_hash != ''
    `,
    clickhouse_settings: {
      send_progress_in_http_headers: 0
    }
  })

  const data = JSON.parse(await result.text()).data[0]

  console.log('Remaining transactions analysis:')
  console.log('  Total:', parseInt(data.total).toLocaleString())
  console.log('  Unique markets:', data.unique_markets)
  console.log('  Zero market_ids:', parseInt(data.zero_market_ids).toLocaleString(), '(' + (100 * parseInt(data.zero_market_ids) / parseInt(data.total)).toFixed(1) + '%)')
  console.log('  Missing condition_id:', parseInt(data.missing_condition_id).toLocaleString())
  console.log('  Date range:', data.earliest, 'to', data.latest)
  console.log('  Before 2023:', parseInt(data.before_2023).toLocaleString())
  console.log()

  // If 99%+ are zero market_ids, they're phantom records
  const phantomPercent = 100 * parseInt(data.zero_market_ids) / parseInt(data.total)
  if (phantomPercent > 99) {
    console.log('⚠️  RECOMMENDATION: These are phantom records from buggy CLOB import')
    console.log('   Skip backfill and mark as invalid')
  }
}

main().catch(e => {
  console.error('Error:', e.message)
  process.exit(1)
})
