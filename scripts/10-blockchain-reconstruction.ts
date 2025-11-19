#!/usr/bin/env npx tsx

/**
 * OPTION 2A: Blockchain Ground Truth Reconstruction
 *
 * Step 1: Extract ERC1155 position transfers and ERC20 USDC flows for 4 test wallets
 * Step 2: Reconstruct position history from token movements
 * Step 3: Calculate cost basis from USDC flows
 * Step 4: Compute realized P&L by market
 * Step 5: Compare vs trades_raw to validate
 * Step 6: Derive correct formula
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
  console.log('OPTION 2A: Blockchain Ground Truth Reconstruction')
  console.log('Using ERC1155 + ERC20 to validate P&L formula')
  console.log('='.repeat(100))

  try {
    // Step 1: Extract ERC1155 position transfers
    console.log('\n[STEP 1] Extracting ERC1155 position transfers for test wallets...')

    const walletList = TEST_WALLETS.map(w => `'${w.address.toLowerCase()}'`).join(',')

    const erc1155Data = await (await clickhouse.query({
      query: `
        SELECT
          lower(concat('0x', hex(from_address))) as from_addr,
          lower(concat('0x', hex(to_address))) as to_addr,
          token_id,
          amount,
          block_time,
          tx_hash,
          log_index
        FROM pm_erc1155_flats
        WHERE lower(concat('0x', hex(from_address))) IN (${walletList})
           OR lower(concat('0x', hex(to_address))) IN (${walletList})
        ORDER BY block_time ASC, log_index ASC
        LIMIT 10000
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    if (erc1155Data.length > 0) {
      console.log(`✅ Found ${erc1155Data.length} ERC1155 transfers for test wallets`)
      console.log(`   Sample transfers:`)
      for (const t of erc1155Data.slice(0, 5)) {
        console.log(`   - ${t.from_addr?.substring(0, 12)} → ${t.to_addr?.substring(0, 12)} | Token ${t.token_id} | Amount: ${t.amount} | Block time: ${t.block_time}`)
      }
    } else {
      console.log(`⚠️  No ERC1155 transfers found`)
    }

    // Step 2: Extract ERC20 USDC flows
    console.log('\n[STEP 2] Extracting ERC20 USDC flows for test wallets...')

    const erc20Data = await (await clickhouse.query({
      query: `
        SELECT
          lower(from_address) as from_addr,
          lower(to_address) as to_addr,
          value as usdc_amount,
          block_timestamp,
          tx_hash,
          log_index
        FROM erc20_transfers
        WHERE contract = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174'
          AND (lower(from_address) IN (${walletList}) OR lower(to_address) IN (${walletList}))
        ORDER BY block_timestamp ASC, log_index ASC
        LIMIT 10000
      `,
      format: 'JSONEachRow'
    })).json() as any[]

    if (erc20Data.length > 0) {
      console.log(`✅ Found ${erc20Data.length} ERC20 USDC transfers for test wallets`)
      console.log(`   Sample USDC flows:`)
      for (const t of erc20Data.slice(0, 5)) {
        const amountUSD = parseFloat(t.usdc_amount) / 1e6
        console.log(`   - ${t.from_addr?.substring(0, 12)} → ${t.to_addr?.substring(0, 12)} | $${amountUSD.toFixed(2)} | ${t.block_timestamp}`)
      }
    } else {
      console.log(`⚠️  No ERC20 USDC transfers found`)
    }

    // Step 3: Analyze per-wallet activity
    console.log('\n[STEP 3] Per-wallet activity summary...')

    for (const wallet of TEST_WALLETS) {
      const walletLower = wallet.address.toLowerCase()
      const erc1155Count = erc1155Data.filter(t =>
        t.from_addr === walletLower || t.to_addr === walletLower
      ).length

      const erc20Count = erc20Data.filter(t =>
        t.from_addr === walletLower || t.to_addr === walletLower
      ).length

      const erc1155In = erc1155Data.filter(t => t.to_addr === walletLower).length
      const erc1155Out = erc1155Data.filter(t => t.from_addr === walletLower).length

      const erc20In = erc20Data.filter(t => t.to_addr === walletLower)
        .reduce((sum, t) => sum + parseFloat(t.usdc_amount || 0) / 1e6, 0)
      const erc20Out = erc20Data.filter(t => t.from_addr === walletLower)
        .reduce((sum, t) => sum + parseFloat(t.usdc_amount || 0) / 1e6, 0)

      console.log(`\n  Wallet ${walletLower.substring(0, 12)}... (UI P&L: $${wallet.ui_pnl})`)
      console.log(`    ERC1155: ${erc1155Count} transfers (${erc1155In} in, ${erc1155Out} out)`)
      console.log(`    ERC20: ${erc20Count} transfers (${erc20In.toFixed(2)} USDC in, ${erc20Out.toFixed(2)} USDC out)`)
      console.log(`    Net USDC flow: $${(erc20In - erc20Out).toFixed(2)}`)
    }

    console.log('\n' + '='.repeat(100))
    console.log('FINDINGS')
    console.log('='.repeat(100))

    if (erc1155Data.length === 0 && erc20Data.length === 0) {
      console.log('\n⚠️  NO blockchain data found for test wallets')
      console.log('   Possible reasons:')
      console.log('   1. ERC1155_flats or erc20_transfers tables are empty or not indexed for these wallets')
      console.log('   2. Wallets may have used different addresses or contracts')
      console.log('   3. Data may need to be backfilled from chain')
      console.log('\n💡 RECOMMENDATION:')
      console.log('   Try querying raw on-chain APIs or Dune Analytics')
      console.log('   Alternative: Debug trades_raw formula more carefully with offset analysis')
    } else if (erc1155Data.length > 0 && erc20Data.length > 0) {
      console.log('\n✅ Blockchain data available for reconstruction!')
      console.log('   Next: Build position history from token movements')
      console.log('   Then: Match settlements to reconstruct formula')
    } else {
      console.log('\n⚠️  Partial blockchain data available')
      console.log(`   ERC1155: ${erc1155Data.length > 0 ? 'YES' : 'NO'}`)
      console.log(`   ERC20: ${erc20Data.length > 0 ? 'YES' : 'NO'}`)
      console.log('   Will use available data to validate as much as possible')
    }

  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

execute()
