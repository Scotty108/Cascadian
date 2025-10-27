/**
 * ANALYZE WALLET CONDITION COVERAGE
 *
 * Purpose: Understand why wallets have low coverage by analyzing market_id availability
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

const ALL_WALLETS = [
  '0xc7f7edb333f5cbd8a3146805e21602984b852abf',
  '0x3a03c6dd168a7a24864c4df17bf4dd06be09a0b7',
  '0xb744f56635b537e859152d14b022af5afe485210',
  '0xe27b3674cfccb0cc87426d421ee3faaceb9168d2',
  '0xd199709b1e8cc374cf1d6100f074f15fc04ea5f2'
]

async function analyzeWallet(wallet: string) {
  console.log(`\n📊 Analyzing ${wallet.slice(0, 10)}...\n`)

  // Total conditions
  const totalQuery = `
    SELECT COUNT(DISTINCT condition_id) as total
    FROM trades_raw
    WHERE wallet_address = '${wallet}'
  `

  const totalResult = await clickhouse.query({
    query: totalQuery,
    format: 'JSONEachRow',
  })
  const total = await totalResult.json<{ total: string }>()

  // Conditions with valid market_id
  const validQuery = `
    SELECT COUNT(DISTINCT condition_id) as valid
    FROM trades_raw
    WHERE wallet_address = '${wallet}'
      AND market_id != 'unknown'
      AND market_id != ''
  `

  const validResult = await clickhouse.query({
    query: validQuery,
    format: 'JSONEachRow',
  })
  const valid = await validResult.json<{ valid: string }>()

  // Conditions with unknown/empty market_id
  const unknownQuery = `
    SELECT COUNT(DISTINCT condition_id) as unknown
    FROM trades_raw
    WHERE wallet_address = '${wallet}'
      AND (market_id = 'unknown' OR market_id = '')
  `

  const unknownResult = await clickhouse.query({
    query: unknownQuery,
    format: 'JSONEachRow',
  })
  const unknown = await unknownResult.json<{ unknown: string }>()

  const totalCount = parseInt(total[0].total)
  const validCount = parseInt(valid[0].valid)
  const unknownCount = parseInt(unknown[0].unknown)
  const validPct = (validCount / totalCount * 100).toFixed(2)

  console.log(`Total conditions:          ${totalCount}`)
  console.log(`With valid market_id:      ${validCount} (${validPct}%)`)
  console.log(`With unknown/empty ID:     ${unknownCount}`)
  console.log(`Missing:                   ${totalCount - validCount - unknownCount}`)

  return {
    wallet,
    total: totalCount,
    valid: validCount,
    unknown: unknownCount,
    validPct: parseFloat(validPct)
  }
}

async function main() {
  console.log('🔍 WALLET CONDITION COVERAGE ANALYSIS\n')
  console.log('================================================\n')

  const results = []

  for (const wallet of ALL_WALLETS) {
    const result = await analyzeWallet(wallet)
    results.push(result)
  }

  console.log('\n================================================')
  console.log('📊 SUMMARY')
  console.log('================================================\n')

  console.log('Wallet | Total | Valid | Unknown | Valid %')
  console.log('-------|-------|-------|---------|--------')
  for (const r of results) {
    console.log(`${r.wallet.slice(0, 10)}... | ${r.total} | ${r.valid} | ${r.unknown} | ${r.validPct}%`)
  }

  console.log('\n================================================\n')

  process.exit(0)
}

main().catch((error) => {
  console.error('\n❌ Error:', error)
  process.exit(1)
})
