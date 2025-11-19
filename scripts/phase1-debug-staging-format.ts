#!/usr/bin/env npx tsx

/**
 * PHASE 1 DEBUG: Check erc20_transfers_staging data format
 *
 * Why INSERT produced 0 rows - likely causes:
 * 1. Address format doesn't match lower('0x2791bca1f2de4661ed88a30c99a7a9449aa84174')
 * 2. Event signature (topics[1]) doesn't match the one we're looking for
 * 3. topics array structure different than expected
 * 4. data field format is not valid hex
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function main() {
  console.log('='.repeat(100))
  console.log('PHASE 1 DEBUG: Diagnose erc20_transfers_staging format')
  console.log('='.repeat(100))

  // Step 1: Check table exists and get basic stats
  console.log('\n[STEP 1] Basic staging data stats')
  console.log('─'.repeat(100))

  try {
    const stats = await (await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_rows,
          COUNT(DISTINCT address) as unique_addresses,
          COUNT(DISTINCT topics[1]) as unique_event_sigs,
          MIN(created_at) as earliest,
          MAX(created_at) as latest
        FROM erc20_transfers_staging
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    const s = stats[0]
    console.log(`Total rows: ${parseInt(s.total_rows).toLocaleString()}`)
    console.log(`Unique addresses: ${parseInt(s.unique_addresses).toLocaleString()}`)
    console.log(`Unique event signatures: ${parseInt(s.unique_event_sigs).toLocaleString()}`)
    console.log(`Date range: ${s.earliest} to ${s.latest}`)
  } catch (e: any) {
    console.error(`❌ Stats failed: ${e.message}`)
    return
  }

  // Step 2: Check if USDC contract appears in data
  console.log('\n[STEP 2] Look for USDC contract addresses')
  console.log('─'.repeat(100))

  try {
    const contracts = await (await clickhouse.query({
      query: `
        SELECT
          address,
          COUNT(*) as row_count
        FROM erc20_transfers_staging
        GROUP BY address
        LIMIT 20
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log(`\nTop 20 contracts by frequency:`)
    for (const row of contracts) {
      console.log(`  ${row.address}: ${parseInt(row.row_count).toLocaleString()} rows`)
    }

    const targetContract = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174'
    const isPresent = contracts.some(c => c.address?.toLowerCase?.() === targetContract.toLowerCase())
    console.log(`\n${isPresent ? '✅' : '❌'} Target contract ${targetContract.substring(0, 20)}... ${isPresent ? 'FOUND' : 'NOT FOUND'}`)
  } catch (e: any) {
    console.error(`❌ Contract enumeration failed: ${e.message}`)
  }

  // Step 3: Check event signatures
  console.log('\n[STEP 3] Check event signatures')
  console.log('─'.repeat(100))

  try {
    const sigs = await (await clickhouse.query({
      query: `
        SELECT
          topics[1] as event_sig,
          COUNT(*) as row_count
        FROM erc20_transfers_staging
        GROUP BY event_sig
        LIMIT 20
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log(`\nTop 20 event signatures by frequency:`)
    for (const row of sigs) {
      console.log(`  ${row.event_sig}: ${parseInt(row.row_count).toLocaleString()} rows`)
    }

    const targetSig = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
    const isPresent = sigs.some(s => s.event_sig?.toLowerCase?.() === targetSig.toLowerCase())
    console.log(`\n${isPresent ? '✅' : '❌'} Transfer event sig ${targetSig.substring(0, 20)}... ${isPresent ? 'FOUND' : 'NOT FOUND'}`)
  } catch (e: any) {
    console.error(`❌ Event signature enumeration failed: ${e.message}`)
  }

  // Step 4: Sample raw row to understand structure
  console.log('\n[STEP 4] Sample raw row structure')
  console.log('─'.repeat(100))

  try {
    const samples = await (await clickhouse.query({
      query: `
        SELECT
          address,
          topics[1],
          substr(topics[1], 1, 20) as sig_partial,
          length(topics) as topic_count,
          substr(data, 1, 50) as data_partial,
          length(data) as data_length,
          created_at
        FROM erc20_transfers_staging
        LIMIT 3
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log(`\nFirst 3 rows (sample structure):`)
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i]
      console.log(`\n[Row ${i + 1}]`)
      console.log(`  Address: ${s.address}`)
      console.log(`  Event sig: ${s.topics[1]}`)
      console.log(`  Sig partial: ${s.sig_partial}...`)
      console.log(`  Topic count: ${s.topic_count}`)
      console.log(`  Data partial: ${s.data_partial}... (${s.data_length} chars total)`)
      console.log(`  Block time: ${s.created_at}`)
    }
  } catch (e: any) {
    console.error(`❌ Sample query failed: ${e.message}`)
  }

  // Step 5: Test if our WHERE conditions match anything
  console.log('\n[STEP 5] Test WHERE clause conditions')
  console.log('─'.repeat(100))

  const targetAddress = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174'
  const targetSig = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

  try {
    const addressMatch = await (await clickhouse.query({
      query: `
        SELECT COUNT(*) as count
        FROM erc20_transfers_staging
        WHERE lower(address) = lower('${targetAddress}')
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    const addressCount = parseInt(addressMatch[0].count)
    console.log(`Rows where address matches: ${addressCount.toLocaleString()}`)
  } catch (e: any) {
    console.error(`❌ Address match test failed: ${e.message}`)
  }

  try {
    const sigMatch = await (await clickhouse.query({
      query: `
        SELECT COUNT(*) as count
        FROM erc20_transfers_staging
        WHERE lower(topics[1]) = lower('${targetSig}')
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    const sigCount = parseInt(sigMatch[0].count)
    console.log(`Rows where topics[1] matches Transfer sig: ${sigCount.toLocaleString()}`)
  } catch (e: any) {
    console.error(`❌ Event sig match test failed: ${e.message}`)
  }

  try {
    const lengthMatch = await (await clickhouse.query({
      query: `
        SELECT COUNT(*) as count
        FROM erc20_transfers_staging
        WHERE length(topics) >= 3
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    const lengthCount = parseInt(lengthMatch[0].count)
    console.log(`Rows where length(topics) >= 3: ${lengthCount.toLocaleString()}`)
  } catch (e: any) {
    console.error(`❌ Topics length test failed: ${e.message}`)
  }

  // Step 6: Combined test
  console.log('\n[STEP 6] Combined WHERE clause test')
  console.log('─'.repeat(100))

  try {
    const combined = await (await clickhouse.query({
      query: `
        SELECT COUNT(*) as count
        FROM erc20_transfers_staging
        WHERE
          lower(address) = lower('${targetAddress}')
          AND length(topics) >= 3
          AND lower(topics[1]) = lower('${targetSig}')
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    const combinedCount = parseInt(combined[0].count)
    console.log(`Rows matching ALL WHERE conditions: ${combinedCount.toLocaleString()}`)

    if (combinedCount === 0) {
      console.log(`\n⚠️  WHERE clause matches ZERO rows. This explains the empty INSERT.`)
      console.log(`Likely causes:`)
      console.log(`  1. Address format mismatch (case, 0x prefix, spacing)`)
      console.log(`  2. Event signature not present in data`)
      console.log(`  3. topics array structure different than expected`)
      console.log(`  4. All data filtered by one of the conditions`)
    } else {
      console.log(`\n✅ WHERE clause would match ${combinedCount.toLocaleString()} rows - ready for INSERT`)
    }
  } catch (e: any) {
    console.error(`❌ Combined WHERE test failed: ${e.message}`)
  }

  console.log('\n' + '='.repeat(100))
}

main().catch(e => console.error('Fatal error:', e))
