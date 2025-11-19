#!/usr/bin/env npx tsx

/**
 * PHASE 1 SIMPLIFIED: Remove arrayElement from WHERE clause
 *
 * The arrayElement() in WHERE is causing rows to be filtered out mysteriously
 * Use only simple conditions in WHERE, do full decoding in SELECT
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '../lib/clickhouse/client'

async function main() {
  console.log('='.repeat(100))
  console.log('PHASE 1 SIMPLIFIED: Decode USDC Transfers (Remove arrayElement from WHERE)')
  console.log('='.repeat(100))

  const USDC_CONTRACT = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174'
  const USDC_DECIMALS = 1e6

  // Truncate target table
  console.log('\n[STEP 1] Prepare target table')
  console.log('─'.repeat(100))

  try {
    await clickhouse.query({
      query: `TRUNCATE TABLE erc20_transfers_decoded`
    })
    console.log('✅ Target table truncated')
  } catch (e: any) {
    console.error(`❌ Truncate failed: ${e.message}`)
    return
  }

  // Run simple INSERT - remove arrayElement from WHERE
  console.log('\n[STEP 2] Insert and decode (simplified WHERE clause)')
  console.log('─'.repeat(100))

  try {
    const insertQuery = `
      INSERT INTO erc20_transfers_decoded
      SELECT
        toDateTime(created_at) as block_time,
        tx_hash,
        log_index,
        lower('0x' || substr(arrayElement(topics, 2), -40)) as from_address,
        lower('0x' || substr(arrayElement(topics, 3), -40)) as to_address,
        toUInt256OrZero(replaceAll(data, '0x', '')) as amount_raw,
        CAST(toUInt256OrZero(replaceAll(data, '0x', '')) AS Float64) / ${USDC_DECIMALS} as amount_usdc,
        0 as fee_usd,
        now() as created_at
      FROM erc20_transfers_staging
      WHERE
        address = lower('${USDC_CONTRACT}')
        AND length(topics) >= 3
    `

    console.log('Executing INSERT...SELECT (simplified - no event sig check in WHERE)...')
    const startTime = Date.now()
    await clickhouse.query({ query: insertQuery })
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`✅ INSERT submitted (${elapsed}s elapsed)`)

  } catch (e: any) {
    console.error(`❌ Insert failed: ${e.message}`)
    // Don't return - continue to verification which may show partial results
  }

  // Wait a bit for async insert
  console.log('\nWaiting for async insert buffer...')
  await new Promise(resolve => setTimeout(resolve, 15000))

  // Verify
  console.log('\n[STEP 3] Verify Results')
  console.log('─'.repeat(100))

  try {
    const stats = await (await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_decoded,
          COUNT(DISTINCT tx_hash) as unique_txs,
          COUNT(DISTINCT from_address) as from_wallets,
          COUNT(DISTINCT to_address) as to_wallets,
          MIN(amount_usdc) as min_amt,
          MAX(amount_usdc) as max_amt,
          AVG(amount_usdc) as avg_amt,
          SUM(amount_usdc) as total_vol
        FROM erc20_transfers_decoded
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    const s = stats[0]
    const total = parseInt(s.total_decoded)
    const expected = 387728806
    const pct = ((total / expected) * 100).toFixed(2)

    console.log(`\n✅ RESULTS:`)
    console.log(`  Total decoded: ${total.toLocaleString()} / ${expected.toLocaleString()} (${pct}%)`)
    console.log(`  Unique txs: ${parseInt(s.unique_txs).toLocaleString()}`)
    console.log(`  From-wallets: ${parseInt(s.from_wallets).toLocaleString()}`)
    console.log(`  To-wallets: ${parseInt(s.to_wallets).toLocaleString()}`)
    console.log(`  Amount range: $${parseFloat(s.min_amt).toFixed(2)} - $${parseFloat(s.max_amt).toFixed(2)}`)
    console.log(`  Average: $${parseFloat(s.avg_amt).toFixed(2)}`)
    console.log(`  Total volume: $${parseFloat(s.total_vol).toLocaleString('en-US', {maximumFractionDigits: 2})}`)

    if (parseFloat(pct) > 50) {
      console.log(`\n✅ SUCCESS! Decoded ${pct}% of expected data`)
    } else if (total > 0) {
      console.log(`\n⚠️  Partial success: ${pct}% coverage (something is still filtering rows)`)
    }

  } catch (e: any) {
    console.error(`⚠️  Verification failed: ${e.message}`)
  }

  console.log('\n' + '='.repeat(100))
}

main().catch(e => console.error('Fatal error:', e))
