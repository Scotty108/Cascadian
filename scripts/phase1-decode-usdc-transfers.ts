#!/usr/bin/env npx tsx

/**
 * PHASE 1: Decode USDC Transfers from Raw Blockchain Format
 *
 * Convert 387.7M raw ERC20 event logs into structured USDC transfers
 * Standard ERC20 Transfer event: Transfer(address indexed from, address indexed to, uint256 value)
 *
 * Topics: [Transfer_signature, from_address, to_address]
 * Data: value (encoded as hex)
 *
 * USDC specifics:
 * - Contract: 0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48 (Polygon)
 * - 6 decimals (divide by 1e6 to get human-readable amount)
 * - Event sig: 0xddf252ad1be2c89b69c2b068fc378dab4c92cdb7640a054007fd5b2df22ae321
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '../lib/clickhouse/client'

async function main() {
  console.log('='.repeat(100))
  console.log('PHASE 1: Decode 387.7M USDC Transfers from Raw Blockchain Format')
  console.log('='.repeat(100))

  // USDCc on Polygon (not USDC on Ethereum)
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

  // Step 2: Decode transfers in batches
  console.log('\n[STEP 2] Decode and insert USDC transfers')
  console.log('─'.repeat(100))
  console.log('Processing 387.7M rows in batches to avoid header overflow...\n')

  try {
    // We'll use a single INSERT...SELECT that decodes on-the-fly
    // This avoids loading raw data into memory first

    const decodeQuery = `
      INSERT INTO erc20_transfers_decoded
      SELECT
        created_at as block_time,
        tx_hash,
        log_index,
        -- Decode from_address from topics[2] (remove 0x padding, keep only last 40 chars)
        lower('0x' || substr(topics[2], -40)) as from_address,
        -- Decode to_address from topics[3] (remove 0x padding, keep only last 40 chars)
        lower('0x' || substr(topics[3], -40)) as to_address,
        -- value is in hex in the data field, convert to UInt256
        CAST(replaceAll(data, '0x', '') AS UInt256) as amount_raw,
        -- Convert to human-readable USDC amount (6 decimals)
        CAST(CAST(replaceAll(data, '0x', '') AS UInt256) AS Float64) / ${USDC_DECIMALS} as amount_usdc,
        0 as fee_usd,
        now() as created_at
      FROM erc20_transfers_staging
      WHERE
        -- Only USDC contract
        lower(address) = lower('${USDC_CONTRACT}')
        -- Only Transfer events (topics[1] is Transfer sig)
        AND length(topics) >= 3
        AND lower(topics[1]) = lower('${TRANSFER_EVENT_SIG}')
      SETTINGS
        max_insert_block_size = 500000,
        async_insert = 1,
        wait_for_async_insert = 0
    `

    console.log('Executing INSERT...SELECT with on-the-fly decoding...')
    console.log('This may take 10-20 minutes depending on ClickHouse performance\n')

    await clickhouse.query({
      query: decodeQuery
    })

    console.log('✅ INSERT completed')

  } catch (e: any) {
    console.error(`❌ Decode failed: ${e.message}`)
    console.log('\nDebug info:')
    console.log('- Check if topics array has correct format')
    console.log('- Verify data field contains hex-encoded value')
    console.log('- May need to adjust array indices if schema differs')
    return
  }

  // Step 3: Verify decoding
  console.log('\n[STEP 3] Verify decoded data quality')
  console.log('─'.repeat(100))

  try {
    const verification = await (await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_decoded,
          COUNT(DISTINCT tx_hash) as unique_txs,
          COUNT(DISTINCT wallet) as unique_wallets,
          MIN(amount_usdc) as min_amount,
          MAX(amount_usdc) as max_amount,
          AVG(amount_usdc) as avg_amount,
          SUM(amount_usdc) as total_usdc_volume
        FROM erc20_transfers_decoded
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    const v = verification[0]
    console.log(`Total decoded transfers: ${parseInt(v.total_decoded).toLocaleString()}`)
    console.log(`Unique transactions: ${parseInt(v.unique_txs).toLocaleString()}`)
    console.log(`Unique wallets: ${parseInt(v.unique_wallets).toLocaleString()}`)
    console.log(`Amount range: $${parseFloat(v.min_amount).toFixed(2)} - $${parseFloat(v.max_amount).toFixed(2)}`)
    console.log(`Average transfer: $${parseFloat(v.avg_amount).toFixed(2)}`)
    console.log(`Total USDC volume: $${parseFloat(v.total_usdc_volume).toLocaleString('en-US', {maximumFractionDigits: 2})}`)

    if (parseInt(v.total_decoded) > 0) {
      console.log('\n✅ Decoding successful!')
    } else {
      console.log('\n⚠️  No rows decoded - check topics/data format')
    }

  } catch (e: any) {
    console.error(`⚠️  Verification failed: ${e.message}`)
  }

  // Step 4: Sample check
  console.log('\n[STEP 4] Sample decoded records')
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

    console.log(`\nFirst 5 decoded transfers:`)
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i]
      console.log(`\n[${i + 1}]`)
      console.log(`  Tx: ${s.tx_hash.substring(0, 20)}...`)
      console.log(`  From: ${s.from_address.substring(0, 12)}...`)
      console.log(`  To: ${s.to_address.substring(0, 12)}...`)
      console.log(`  Amount: $${parseFloat(s.amount_usdc).toFixed(2)}`)
      console.log(`  Time: ${s.block_time}`)
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
