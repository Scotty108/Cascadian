#!/usr/bin/env npx tsx

/**
 * PHASE 1 BATCHED: Decode USDC Transfers in Monthly Batches
 *
 * Process 387.7M rows by month to avoid HTTP header overflow on single large query
 * Each batch is much smaller and doesn't overwhelm the HTTP client/server
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '../lib/clickhouse/client'

async function main() {
  console.log('='.repeat(100))
  console.log('PHASE 1 BATCHED: Decode USDC Transfers by Month')
  console.log('='.repeat(100))

  const USDC_CONTRACT = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174'
  const TRANSFER_EVENT_SIG = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
  const USDC_DECIMALS = 1e6

  // Step 1: Truncate target table
  console.log('\n[STEP 1] Prepare target table')
  console.log('─'.repeat(100))

  try {
    await clickhouse.query({
      query: `TRUNCATE TABLE erc20_transfers_decoded`
    })
    console.log('✅ Target table truncated and ready for batched inserts')
  } catch (e: any) {
    console.error(`❌ Truncate failed: ${e.message}`)
    return
  }

  // Step 2: Get list of months to process
  console.log('\n[STEP 2] Identify months to process')
  console.log('─'.repeat(100))

  let monthList: any[] = []
  try {
    const months = await (await clickhouse.query({
      query: `
        SELECT DISTINCT
          toYYYYMM(created_at) as month,
          COUNT(*) as row_count
        FROM erc20_transfers_staging
        GROUP BY month
        ORDER BY month
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    monthList = months
    console.log(`Found ${months.length} months of data:`)
    let totalRows = 0
    for (const month of months) {
      const count = parseInt(month.row_count)
      totalRows += count
      console.log(`  ${month.month}: ${count.toLocaleString()} rows`)
    }
    console.log(`Total: ${totalRows.toLocaleString()} rows`)
  } catch (e: any) {
    console.error(`❌ Failed to get months: ${e.message}`)
    return
  }

  // Step 3: Process each month
  console.log('\n[STEP 3] Process each month')
  console.log('─'.repeat(100))

  let totalProcessed = 0
  let successCount = 0
  let failureCount = 0

  for (let i = 0; i < monthList.length; i++) {
    const monthData = monthList[i]
    const month = monthData.month
    const monthRowCount = parseInt(monthData.row_count)

    console.log(`\n[${i + 1}/${monthList.length}] Processing month ${month} (${monthRowCount.toLocaleString()} rows)...`)

    try {
      const monthStart = `${month.toString().substring(0, 4)}-${month.toString().substring(4, 6)}-01`
      const nextMonth = parseInt(month) + 1
      const monthEnd = `${nextMonth.toString().substring(0, 4)}-${nextMonth.toString().substring(4, 6)}-01`

      const batchInsert = `
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
          AND arrayElement(topics, 1) = lower('${TRANSFER_EVENT_SIG}')
          AND toYYYYMM(created_at) = ${month}
      `

      const startTime = Date.now()
      await clickhouse.query({ query: batchInsert })
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

      // Verify this month was inserted
      const verify = await (await clickhouse.query({
        query: `SELECT COUNT(*) as cnt FROM erc20_transfers_decoded WHERE toYYYYMM(block_time) = ${month}`,
        format: 'JSONEachRow'
      })).json() as any[]

      const insertedCount = parseInt(verify[0]?.cnt || 0)
      const percentage = ((insertedCount / monthRowCount) * 100).toFixed(1)

      if (insertedCount > 0) {
        console.log(`  ✅ Inserted ${insertedCount.toLocaleString()} rows (${percentage}% of source) in ${elapsed}s`)
        totalProcessed += insertedCount
        successCount++
      } else {
        console.log(`  ⚠️  WARNING: 0 rows inserted (WHERE clause matched nothing?)`)
        failureCount++
      }

    } catch (e: any) {
      console.log(`  ❌ Error: ${e.message}`)
      failureCount++
    }

    // Progress update
    if ((i + 1) % 5 === 0) {
      console.log(`\nProgress: ${successCount}/${i + 1} months complete, ${totalProcessed.toLocaleString()} rows processed`)
    }
  }

  // Step 4: Final verification
  console.log('\n[STEP 4] Final Verification')
  console.log('─'.repeat(100))

  try {
    const final = await (await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_decoded,
          COUNT(DISTINCT tx_hash) as unique_txs,
          COUNT(DISTINCT from_address) as from_wallets,
          COUNT(DISTINCT to_address) as to_wallets,
          MIN(amount_usdc) as min_amount,
          MAX(amount_usdc) as max_amount,
          AVG(amount_usdc) as avg_amount,
          SUM(amount_usdc) as total_usdc_volume
        FROM erc20_transfers_decoded
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    const v = final[0]
    const totalDecoded = parseInt(v.total_decoded)
    const expectedTotal = 387728806
    const coverage = ((totalDecoded / expectedTotal) * 100).toFixed(2)

    console.log(`\n✅ PROCESSING COMPLETE`)
    console.log(`\nFinal Results:`)
    console.log(`  Total decoded: ${totalDecoded.toLocaleString()} / ${expectedTotal.toLocaleString()} (${coverage}%)`)
    console.log(`  Unique transactions: ${parseInt(v.unique_txs).toLocaleString()}`)
    console.log(`  From-addresses: ${parseInt(v.from_wallets).toLocaleString()}`)
    console.log(`  To-addresses: ${parseInt(v.to_wallets).toLocaleString()}`)
    console.log(`  Amount range: $${parseFloat(v.min_amount).toFixed(2)} - $${parseFloat(v.max_amount).toFixed(2)}`)
    console.log(`  Average transfer: $${parseFloat(v.avg_amount).toFixed(2)}`)
    console.log(`  Total USDC volume: $${parseFloat(v.total_usdc_volume).toLocaleString('en-US', {maximumFractionDigits: 2})}`)
    console.log(`\n  Months processed: ${successCount}/${monthList.length} (${failureCount} failures)`)

    if (totalDecoded > 0) {
      if (coverage === '100.00') {
        console.log(`  ✅ PERFECT COVERAGE!`)
      } else if (parseFloat(coverage) >= 99) {
        console.log(`  ✅ Excellent coverage (${coverage}%)`)
      }
    }

  } catch (e: any) {
    console.error(`❌ Final verification failed: ${e.message}`)
  }

  console.log('\n' + '='.repeat(100))
  console.log('PHASE 1 BATCHED COMPLETE')
  console.log('='.repeat(100))
  console.log(`\nNext: Phase 2 - Fetch ERC1155 token transfers from Polygon RPC`)
  console.log(`Time estimate: 4-6 hours`)
}

main().catch(e => console.error('Fatal error:', e))
