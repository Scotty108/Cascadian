#!/usr/bin/env npx tsx

/**
 * PURE ON-CHAIN RECONSTRUCTION
 *
 * Reconstruct complete trading history from blockchain primitives:
 * 1. ERC1155 token transfers (get condition_id, outcome_index from token_id)
 * 2. ERC20 USDC transfers (get cost_basis, fees)
 * 3. Market resolutions (get winning_index, payout vectors)
 *
 * This bypasses the "missing condition_id" problem entirely by working backwards
 * from actual blockchain evidence.
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function main() {
  console.log('='.repeat(100))
  console.log('PURE ON-CHAIN RECONSTRUCTION: Rebuild complete trading history from blockchain')
  console.log('='.repeat(100))

  // Step 1: Understand what blockchain data we have
  console.log('\n[STEP 1] Inventory blockchain transfers')
  console.log('─'.repeat(100))

  const inventoryQuery = `
    SELECT
      'erc1155_transfers' as table_name,
      COUNT(*) as total_rows,
      COUNT(DISTINCT wallet_address) as unique_wallets,
      COUNT(DISTINCT token_id) as unique_tokens,
      COUNT(DISTINCT tx_hash) as unique_transactions
    FROM erc1155_transfers
    UNION ALL
    SELECT
      'erc20_transfers' as table_name,
      COUNT(*) as total_rows,
      COUNT(DISTINCT wallet_address) as unique_wallets,
      COUNT(DISTINCT token_address) as unique_tokens,
      COUNT(DISTINCT tx_hash) as unique_transactions
    FROM erc20_transfers
    WHERE token_address = lower('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')  -- USDC
  `

  const inventory = await (await clickhouse.query({
    query: inventoryQuery,
    format: 'JSONEachRow'
  })).json() as any[]

  for (const row of inventory) {
    console.log(`\n${row.table_name}:`)
    console.log(`  Total rows: ${parseInt(row.total_rows).toLocaleString()}`)
    console.log(`  Unique wallets: ${parseInt(row.unique_wallets).toLocaleString()}`)
    console.log(`  Unique tokens/addresses: ${parseInt(row.unique_tokens).toLocaleString()}`)
    console.log(`  Unique transactions: ${parseInt(row.unique_transactions).toLocaleString()}`)
  }

  // Step 2: Find transactions with BOTH ERC1155 + ERC20 transfers (complete trades)
  console.log('\n[STEP 2] Find complete trades (ERC1155 + ERC20 in same tx)')
  console.log('─'.repeat(100))

  const completeTradesQuery = `
    WITH erc1155_by_tx AS (
      SELECT
        tx_hash,
        wallet_address,
        token_id,
        CAST(token_id AS String) as token_id_str,
        value as token_amount,
        -- Decode token_id: condition_id = token_id >> 8
        CAST(token_id / 256 AS UInt256) as condition_id_decoded,
        -- Decode token_id: outcome_index = token_id & 0xff (last 8 bits)
        CAST(token_id % 256 AS UInt8) as outcome_index_decoded
      FROM erc1155_transfers
      LIMIT 1000  -- Start with sample
    ),
    usdc_by_tx AS (
      SELECT
        tx_hash,
        SUM(CASE WHEN from_address = lower(to_address) THEN 0 ELSE value END) as usdc_flow
      FROM erc20_transfers
      WHERE token_address = lower('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')
      GROUP BY tx_hash
    )
    SELECT
      e.tx_hash,
      e.wallet_address,
      lower(hex(e.condition_id_decoded)) as condition_id_hex,
      e.outcome_index_decoded,
      e.token_amount as shares,
      CASE WHEN u.usdc_flow IS NOT NULL THEN 'YES' ELSE 'NO' END as has_usdc_transfer,
      u.usdc_flow as usdc_amount
    FROM erc1155_by_tx e
    LEFT JOIN usdc_by_tx u ON e.tx_hash = u.tx_hash
    LIMIT 100
  `

  try {
    const completeTrades = await (await clickhouse.query({
      query: completeTradesQuery,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log(`\nSample of decoded on-chain trades (first 100 of 1000 sample):`)
    console.log('─'.repeat(100))

    let withUsdc = 0
    let withoutUsdc = 0

    for (let i = 0; i < Math.min(10, completeTrades.length); i++) {
      const row = completeTrades[i]
      if (row.has_usdc_transfer === 'YES') withUsdc++
      else withoutUsdc++

      console.log(`\nTx: ${row.tx_hash.substring(0, 20)}...`)
      console.log(`  Wallet: ${row.wallet_address.substring(0, 12)}...`)
      console.log(`  Condition ID (decoded): ${row.condition_id_hex}`)
      console.log(`  Outcome index: ${row.outcome_index_decoded}`)
      console.log(`  Shares: ${row.shares}`)
      console.log(`  USDC transfer: ${row.has_usdc_transfer} | Amount: ${row.usdc_amount || 'N/A'}`)
    }

    console.log(`\n\nStatistics (1000 sample):`)
    const withUsdcCount = completeTrades.filter(r => r.has_usdc_transfer === 'YES').length
    const withoutUsdcCount = completeTrades.filter(r => r.has_usdc_transfer === 'NO').length
    console.log(`  With USDC transfer: ${withUsdcCount}`)
    console.log(`  Without USDC transfer: ${withoutUsdcCount}`)
    console.log(`  Pairing rate: ${((withUsdcCount / (withUsdcCount + withoutUsdcCount)) * 100).toFixed(1)}%`)

  } catch (e: any) {
    console.error(`  Error in decode: ${e.message}`)
    console.log(`  (This might indicate token_id format issue - checking format...`)

    // Check actual token_id format
    const formatCheck = await (await clickhouse.query({
      query: `
        SELECT
          token_id,
          token_id as token_id_raw,
          length(token_id) as length,
          CASE
            WHEN token_id LIKE '0x%' THEN 'HEX_STRING'
            WHEN token_id > 0 THEN 'DECIMAL_NUMBER'
            ELSE 'OTHER'
          END as format_type
        FROM erc1155_transfers
        LIMIT 10
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log(`\n  First 10 token_ids:`)
    for (const row of formatCheck) {
      console.log(`    ${row.token_id} (type: ${row.format_type})`)
    }
  }

  // Step 3: Coverage analysis - how many of the 77.4M missing trades exist on-chain?
  console.log('\n' + '='.repeat(100))
  console.log('[STEP 3] Coverage analysis: How many missing trades exist on-chain?')
  console.log('─'.repeat(100))

  try {
    const coverageQuery = `
      WITH decoded_blockchain_trades AS (
        SELECT
          tx_hash,
          wallet_address,
          CAST(token_id / 256 AS UInt256) as condition_id_decoded,
          CAST(token_id % 256 AS UInt8) as outcome_index_decoded,
          COUNT(*) as blockchain_evidence
        FROM erc1155_transfers
        GROUP BY tx_hash, wallet_address, condition_id_decoded, outcome_index_decoded
      )
      SELECT
        COUNT(*) as blockchain_trades_found,
        COUNT(DISTINCT wallet_address) as wallets_with_blockchain_evidence,
        COUNT(DISTINCT condition_id_decoded) as unique_conditions_found
      FROM decoded_blockchain_trades
    `

    const coverage = await (await clickhouse.query({
      query: coverageQuery,
      format: 'JSONEachRow'
    })).json() as any[]

    const c = coverage[0]
    console.log(`\nBlockchain reconstructed trades:`)
    console.log(`  Total trades: ${parseInt(c.blockchain_trades_found).toLocaleString()}`)
    console.log(`  Unique wallets: ${parseInt(c.wallets_with_blockchain_evidence).toLocaleString()}`)
    console.log(`  Unique conditions: ${parseInt(c.unique_conditions_found).toLocaleString()}`)

    const tradeCoverageRate = (parseInt(c.blockchain_trades_found) / 159574259) * 100
    console.log(`\nCompare to trades_raw:`)
    console.log(`  trades_raw total: 159,574,259`)
    console.log(`  Blockchain reconstruction: ${parseInt(c.blockchain_trades_found).toLocaleString()} (${tradeCoverageRate.toFixed(2)}%)`)

    if (tradeCoverageRate > 51.47) {
      console.log(`\n✅ SUCCESS! Blockchain reconstruction covers ${tradeCoverageRate.toFixed(2)}% vs current 51.47%`)
      console.log(`   Additional coverage gained: ${(tradeCoverageRate - 51.47).toFixed(2)}%`)
    } else {
      console.log(`\n⚠️  Blockchain data covers ${tradeCoverageRate.toFixed(2)}% of trades`)
    }

  } catch (e: any) {
    console.error(`  Coverage analysis failed: ${e.message}`)
  }

  console.log('\n' + '='.repeat(100))
}

main().catch(e => console.error('Fatal error:', e))
