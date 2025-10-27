#!/usr/bin/env npx tsx

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@clickhouse/client'
import { fetchWalletPnL } from '../lib/goldsky/client'

const clickhouse = createClient({
  host: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
})

async function validateRank1Wallet() {
  // From Deliverable 1, the rank 1 wallet is:
  const rank1Wallet = '0xc7f7edb333f5cbd8a3146805e21602984b852abf'

  console.log('═══════════════════════════════════════════════════════════')
  console.log('    DELIVERABLE 2: Rank 1 Wallet Validation              ')
  console.log('═══════════════════════════════════════════════════════════\n')
  console.log(`Validating wallet: ${rank1Wallet}\n`)

  // Get ClickHouse P&L (from corrected enrichment)
  console.log('📊 Fetching ClickHouse P&L (corrected pipeline)...')
  const clickhouseQuery = `
    SELECT
      wallet_address,
      SUM(pnl_net) as pnl_sum_usd,
      COUNT(*) as trade_count
    FROM trades_raw
    WHERE wallet_address = '${rank1Wallet}'
      AND pnl_net IS NOT NULL
    GROUP BY wallet_address
  `

  const clickhouseResult = await clickhouse.query({
    query: clickhouseQuery,
    format: 'JSONEachRow',
  })

  const clickhouseData: any[] = await clickhouseResult.json()
  const pnl_clickhouse = clickhouseData[0]?.pnl_sum_usd || 0
  const trade_count = clickhouseData[0]?.trade_count || 0

  // Get Goldsky P&L
  console.log('📊 Fetching Goldsky P&L...')
  const goldskyData = await fetchWalletPnL(rank1Wallet)

  if (!goldskyData) {
    console.log('❌ No Goldsky data found for this wallet')
    await clickhouse.close()
    return
  }

  const pnl_goldsky_raw = goldskyData.totalRealizedPnl
  const pnl_goldsky_corrected = pnl_goldsky_raw / 13.2399 / 1e6

  const percent_diff = ((pnl_clickhouse - pnl_goldsky_corrected) / pnl_goldsky_corrected) * 100
  const absolute_diff = pnl_clickhouse - pnl_goldsky_corrected

  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('                   VALIDATION RESULTS                       ')
  console.log('═══════════════════════════════════════════════════════════\n')
  console.log(`Wallet Address: ${rank1Wallet}`)
  console.log(`\nClickHouse P&L (Fixed Pipeline):`)
  console.log(`  pnl_sum_usd_clickhouse: $${pnl_clickhouse.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
  console.log(`  Enriched trades: ${trade_count.toLocaleString()}`)
  console.log(`\nGoldsky P&L:`)
  console.log(`  Raw realizedPnl: ${pnl_goldsky_raw.toLocaleString()}`)
  console.log(`  Positions tracked: ${goldskyData.positionCount}`)
  console.log(`  Correction Factor: 13.2399 × 1e6 = ${(13.2399 * 1e6).toLocaleString()}`)
  console.log(`  pnl_sum_usd_goldsky_corrected: $${pnl_goldsky_corrected.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
  console.log(`\nComparison:`)
  console.log(`  Percent Difference: ${percent_diff >= 0 ? '+' : ''}${percent_diff.toFixed(2)}%`)
  console.log(`  Absolute Difference: $${absolute_diff.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)

  // Sanity check
  console.log(`\nSanity Check:`)
  if (Math.abs(percent_diff) < 50) {
    console.log(`  ✅ PASS: Percent difference is ${Math.abs(percent_diff).toFixed(2)}% (within reasonable range)`)
  } else if (Math.abs(percent_diff) < 500) {
    console.log(`  ⚠️  WARNING: Percent difference is ${Math.abs(percent_diff).toFixed(2)}% (somewhat high but not thousands)`)
  } else {
    console.log(`  ❌ FAIL: Percent difference is ${Math.abs(percent_diff).toFixed(2)}% (still too high, expected <50%)`)
  }

  console.log('\n═══════════════════════════════════════════════════════════\n')

  await clickhouse.close()
}

validateRank1Wallet()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
