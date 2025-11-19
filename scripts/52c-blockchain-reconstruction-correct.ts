#!/usr/bin/env npx tsx

/**
 * PURE ON-CHAIN RECONSTRUCTION - Correct Schema Version
 *
 * Reconstruct trading history from blockchain primitives using actual table schemas
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function main() {
  console.log('='.repeat(100))
  console.log('BLOCKCHAIN RECONSTRUCTION: Verify coverage from ERC1155 + ERC20 transfers')
  console.log('='.repeat(100))

  // Step 1: Check data inventory
  console.log('\n[STEP 1] Blockchain Data Inventory')
  console.log('─'.repeat(100))

  const inventory = await (await clickhouse.query({
    query: `
      SELECT
        'erc1155_transfers' as source,
        COUNT(*) as total_rows,
        COUNT(DISTINCT to_address) as unique_wallets,
        COUNT(DISTINCT contract) as unique_contracts,
        COUNT(DISTINCT tx_hash) as unique_txs
      FROM erc1155_transfers
      UNION ALL
      SELECT
        'erc20_transfers (USDC)',
        COUNT(*),
        COUNT(DISTINCT from_address) + COUNT(DISTINCT to_address),
        COUNT(DISTINCT contract),
        COUNT(DISTINCT tx_hash)
      FROM erc20_transfers
      WHERE contract = lower('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')
    `,
    format: 'JSONEachRow'
  })).json() as any[]

  for (const row of inventory) {
    console.log(`\n${row.source}:`)
    console.log(`  Rows: ${parseInt(row.total_rows).toLocaleString()}`)
    console.log(`  Unique wallets: ${parseInt(row.unique_wallets).toLocaleString()}`)
    console.log(`  Unique contracts/sources: ${parseInt(row.unique_contracts).toLocaleString()}`)
    console.log(`  Unique transactions: ${parseInt(row.unique_txs).toLocaleString()}`)
  }

  // Step 2: Decode token_ids and analyze what trades can be reconstructed
  console.log('\n[STEP 2] Token ID Decoding Test')
  console.log('─'.repeat(100))

  try {
    const decodeTest = await (await clickhouse.query({
      query: `
        SELECT
          token_id as token_id_hex,
          -- Try to convert hex string to UInt256
          CAST(replaceAll(token_id, '0x', '') AS UInt256) as token_id_uint,
          -- Extract condition_id: token_id >> 8
          CAST(replaceAll(token_id, '0x', '') AS UInt256) / 256 as condition_id_decoded,
          -- Extract outcome_index: token_id & 0xff
          CAST(replaceAll(token_id, '0x', '') AS UInt256) % 256 as outcome_index_decoded,
          COUNT(*) as count
        FROM erc1155_transfers
        GROUP BY token_id
        LIMIT 20
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log(`\nFirst 20 unique token_ids and their decoded values:`)
    console.log('Token ID'.padEnd(70) + ' | condition_id | outcome_idx')
    console.log('─'.repeat(100))

    for (const row of decodeTest) {
      const condId = BigInt(row.condition_id_decoded).toString(16).padStart(64, '0')
      console.log(
        `${row.token_id_hex.substring(0, 68)}... | ${condId.substring(0, 12)}... | ${row.outcome_index_decoded}`
      )
    }

    console.log('\n✅ Token ID decoding successful!')

  } catch (e: any) {
    console.error(`❌ Token ID decoding failed: ${e.message}`)
    return
  }

  // Step 3: Count how many unique trades can be reconstructed
  console.log('\n[STEP 3] Reconstruction Coverage Analysis')
  console.log('─'.repeat(100))

  try {
    const reconstructionStats = await (await clickhouse.query({
      query: `
        WITH decoded_trades AS (
          SELECT
            tx_hash,
            to_address as wallet,
            CAST(replaceAll(token_id, '0x', '') AS UInt256) / 256 as condition_id_decoded,
            CAST(replaceAll(token_id, '0x', '') AS UInt256) % 256 as outcome_index_decoded,
            value as shares_received,
            COUNT(*) as events_in_tx
          FROM erc1155_transfers
          WHERE from_address != lower('0x0000000000000000000000000000000000000000')  -- Exclude mints
          GROUP BY tx_hash, wallet, condition_id_decoded, outcome_index_decoded, shares_received
        ),
        trades_with_usdc AS (
          SELECT
            d.*,
            CASE WHEN e.tx_hash IS NOT NULL THEN 'YES' ELSE 'NO' END as has_usdc,
            e.usdc_flow
          FROM decoded_trades d
          LEFT JOIN (
            SELECT
              tx_hash,
              SUM(value) as usdc_flow
            FROM erc20_transfers
            WHERE contract = lower('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')
            GROUP BY tx_hash
          ) e ON d.tx_hash = e.tx_hash
        )
        SELECT
          COUNT(*) as total_reconstructed_trades,
          COUNT(DISTINCT wallet) as wallets_covered,
          COUNT(DISTINCT condition_id_decoded) as unique_conditions,
          SUM(CASE WHEN has_usdc = 'YES' THEN 1 ELSE 0 END) as with_usdc_transfer,
          SUM(CASE WHEN has_usdc = 'NO' THEN 1 ELSE 0 END) as without_usdc_transfer
        FROM trades_with_usdc
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    const stats = reconstructionStats[0]
    const totalReconstructed = parseInt(stats.total_reconstructed_trades)
    const coverage = (totalReconstructed / 159574259) * 100

    console.log(`\nReconstruction Results:`)
    console.log(`  Trades reconstructed from blockchain: ${totalReconstructed.toLocaleString()}`)
    console.log(`  Coverage vs trades_raw: ${coverage.toFixed(2)}% (target: 100%, current DB: 51.47%)`)
    console.log(`  Unique wallets: ${parseInt(stats.wallets_covered).toLocaleString()}`)
    console.log(`  Unique conditions: ${parseInt(stats.unique_conditions).toLocaleString()}`)
    console.log(`  With USDC transfer: ${parseInt(stats.with_usdc_transfer).toLocaleString()}`)
    console.log(`  Without USDC transfer: ${parseInt(stats.without_usdc_transfer).toLocaleString()}`)

    if (coverage > 51.47) {
      console.log(`\n✅ BREAKTHROUGH! Blockchain reconstruction exceeds current 51.47% coverage!`)
      console.log(`   Improvement: +${(coverage - 51.47).toFixed(2)} percentage points`)
      console.log(`   Additional trades recovered: ${(totalReconstructed - 82138586).toLocaleString()}`)
    } else if (coverage < 51.47) {
      console.log(`\n⚠️  Blockchain reconstruction covers ${coverage.toFixed(2)}% (less than current 51.47%)`)
      console.log(`   This suggests the 77.4M missing trades don't have blockchain evidence`)
    } else {
      console.log(`\n~ Blockchain reconstruction matches current coverage at ${coverage.toFixed(2)}%`)
    }

  } catch (e: any) {
    console.error(`❌ Reconstruction analysis failed: ${e.message}`)
  }

  // Step 4: Compare against trades_raw - which ones are covered?
  console.log('\n[STEP 4] Identify Recovery Opportunities')
  console.log('─'.repeat(100))

  try {
    const comparison = await (await clickhouse.query({
      query: `
        WITH blockchain_trades AS (
          SELECT
            to_address as wallet_address,
            lower(hex(CAST(replaceAll(token_id, '0x', '') AS UInt256) / 256)) as condition_id_decoded,
            CAST(replaceAll(token_id, '0x', '') AS UInt256) % 256 as outcome_index_decoded,
            COUNT(DISTINCT tx_hash) as blockchain_trades_count
          FROM erc1155_transfers
          WHERE from_address != lower('0x0000000000000000000000000000000000000000')
          GROUP BY wallet_address, condition_id_decoded, outcome_index_decoded
        ),
        trades_raw_with_id AS (
          SELECT
            wallet_address,
            lower(replaceAll(condition_id, '0x', '')) as condition_id_norm,
            outcome_index,
            COUNT(*) as raw_trades_count
          FROM trades_raw
          WHERE condition_id != ''
          GROUP BY wallet_address, condition_id_norm, outcome_index
        )
        SELECT
          'Both sources' as category,
          COUNT(DISTINCT b.wallet_address) as wallets,
          COUNT(*) as trade_groups
        FROM blockchain_trades b
        INNER JOIN trades_raw_with_id r
          ON b.wallet_address = r.wallet_address
          AND b.condition_id_decoded = r.condition_id_norm
          AND b.outcome_index_decoded = r.outcome_index
        UNION ALL
        SELECT
          'Only blockchain',
          COUNT(DISTINCT wallet_address),
          COUNT(*)
        FROM blockchain_trades
        WHERE (wallet_address, condition_id_decoded, outcome_index_decoded) NOT IN (
          SELECT wallet_address, condition_id_norm, outcome_index FROM trades_raw_with_id
        )
        UNION ALL
        SELECT
          'Only trades_raw',
          COUNT(DISTINCT wallet_address),
          COUNT(*)
        FROM trades_raw_with_id
        WHERE (wallet_address, condition_id_norm, outcome_index) NOT IN (
          SELECT wallet_address, condition_id_decoded, outcome_index_decoded FROM blockchain_trades
        )
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log(`\nData Source Comparison:`)
    for (const row of comparison) {
      console.log(`  ${row.category.padEnd(25)}: ${parseInt(row.wallets).toLocaleString()} wallets, ${parseInt(row.trade_groups).toLocaleString()} trade groups`)
    }

  } catch (e: any) {
    console.error(`Analysis failed: ${e.message}`)
  }

  console.log('\n' + '='.repeat(100))
  console.log('NEXT STEPS:')
  console.log('─'.repeat(100))
  console.log('If blockchain reconstruction > 51.47%: Proceed with full on-chain build')
  console.log('If blockchain reconstruction < 51.47%: Accept companion tables (trades_working)')
  console.log('='.repeat(100))
}

main().catch(e => console.error('Fatal error:', e))
