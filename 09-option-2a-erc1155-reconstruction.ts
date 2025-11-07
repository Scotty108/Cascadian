#!/usr/bin/env npx tsx

/**
 * OPTION 2A: On-Chain Ground Truth Reconstruction
 *
 * Use ERC1155 token transfers (206K) + ERC20 USDC flows (387.7M)
 * to reconstruct exact position history for the 4 test wallets
 *
 * Goals:
 * 1. Validate position holdings match trades_raw
 * 2. Calculate actual cost basis from USDC flows
 * 3. Derive correct P&L formula
 * 4. Then apply to all 900K wallets
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

const TEST_WALLETS = [
  { address: '0x1489046ca0f9980fc2d9a950d103d3bec02c1307', ui_pnl: 137663 },
  { address: '0x8e9eedf20dfa70956d49f608a205e402d9df38e4', ui_pnl: 360492 },
  { address: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', ui_pnl: 94730 },
  { address: '0x6770bf688b8121331b1c5cfd7723ebd4152545fb', ui_pnl: 12171 },
]

async function execute() {
  console.log('='.repeat(100))
  console.log('OPTION 2A: On-Chain Ground Truth Reconstruction')
  console.log('Using ERC1155 + ERC20 to validate P&L formula')
  console.log('='.repeat(100))

  try {
    // Step 1: Check if ERC1155 and ERC20 tables exist and have data
    console.log('\n[STEP 1] Checking on-chain data availability...')

    const erc1155Check = await (await clickhouse.query({
      query: `
        SELECT
          count() as row_count,
          uniqExact(lower(concat('0x', hex(from_address)))) as unique_senders,
          uniqExact(lower(concat('0x', hex(to_address)))) as unique_receivers,
          min(block_time) as earliest,
          max(block_time) as latest
        FROM pm_erc1155_flats
        LIMIT 1
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    if (erc1155Check[0]) {
      console.log(`✅ pm_erc1155_flats available:`)
      console.log(`   Rows: ${erc1155Check[0].row_count}`)
      console.log(`   Senders: ${erc1155Check[0].unique_senders}`)
      console.log(`   Receivers: ${erc1155Check[0].unique_receivers}`)
    } else {
      console.log(`❌ pm_erc1155_flats not populated (expected - requires backfill)`)
    }

    const erc20Check = await (await clickhouse.query({
      query: `
        SELECT
          count() as row_count,
          uniqExact(lower(from_addr)) as unique_senders,
          min(block_time) as earliest,
          max(block_time) as latest
        FROM erc20_transfers
        WHERE token = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174'
        LIMIT 1
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    if (erc20Check[0] && parseFloat(erc20Check[0].row_count) > 0) {
      console.log(`✅ erc20_transfers (USDC) available:`)
      console.log(`   Rows: ${erc20Check[0].row_count}`)
      console.log(`   Date range: ${erc20Check[0].earliest} to ${erc20Check[0].latest}`)
    } else {
      console.log(`⚠️  erc20_transfers USDC data: ${erc20Check[0]?.row_count || 0} rows`)
    }

    // Step 2: Check what on-chain data we have for test wallets
    console.log('\n[STEP 2] Checking on-chain activity for test wallets...')

    const walletList = TEST_WALLETS.map(w => `'${w.address.toLowerCase()}'`).join(',')

    // ERC1155 activity
    const erc1155Activity = await (await clickhouse.query({
      query: `
        SELECT
          lower(concat('0x', hex(from_address))) as from_addr,
          count() as transfer_count
        FROM pm_erc1155_flats
        WHERE lower(concat('0x', hex(from_address))) IN (${walletList})
           OR lower(concat('0x', hex(to_address))) IN (${walletList})
        GROUP BY from_addr
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    if (erc1155Activity.length > 0) {
      console.log('ERC1155 transfers found for test wallets:')
      for (const row of erc1155Activity) {
        console.log(`  ${row.from_addr?.substring(0, 12)}...: ${row.transfer_count} transfers`)
      }
    } else {
      console.log('⚠️  ERC1155 transfers: No data for test wallets (table may be empty)')
    }

    // ERC20 (USDC) activity
    const erc20Activity = await (await clickhouse.query({
      query: `
        SELECT
          lower(from_addr) as from_addr,
          count() as transfer_count,
          round(sum(toFloat64(value) / 1e6), 2) as total_usdc
        FROM erc20_transfers
        WHERE token = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174'
          AND (lower(from_addr) IN (${walletList}) OR lower(to_addr) IN (${walletList}))
        GROUP BY from_addr
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    if (erc20Activity.length > 0) {
      console.log('ERC20 USDC transfers found for test wallets:')
      for (const row of erc20Activity) {
        console.log(`  ${row.from_addr?.substring(0, 12)}...: ${row.transfer_count} transfers ($${row.total_usdc})`)
      }
    } else {
      console.log('⚠️  ERC20 USDC transfers: No data for test wallets')
    }

    console.log('\n' + '='.repeat(100))
    console.log('FINDINGS')
    console.log('='.repeat(100))

    if ((erc1155Activity.length === 0 || parseFloat(erc1155Check[0]?.row_count || 0) === 0) &&
        (erc20Activity.length === 0 || parseFloat(erc20Check[0]?.row_count || 0) === 0)) {
      console.log('\n⚠️  Neither ERC1155 nor ERC20 data populated for test wallets')
      console.log('   This means on-chain reconstruction requires backfill first.')
      console.log('\n📊 ALTERNATIVE: Fall back to trades_raw diagnosis')
      console.log('   - Wallets have trades_raw data (we verified 2015 trades for wallet 1)')
      console.log('   - Settlement calculation shows 5x error (680K vs 137K expected)')
      console.log('   - Root cause: Likely offset application or position aggregation grain')
      console.log('\n💡 RECOMMENDATION:')
      console.log('   Debug settlement formula directly on trades_raw with step-by-step breakdown')
      console.log('   1. Group trades by condition first')
      console.log('   2. Calculate cost basis per condition')
      console.log('   3. Calculate settlement per condition')
      console.log('   4. Sum per wallet')
      console.log('   Then apply proven formula to all 900K wallets')
    } else {
      console.log('\n✅ On-chain data available - can reconstruct ground truth')
      console.log('   Next: Build position history from ERC1155 + USDC flows')
    }

  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

execute()
