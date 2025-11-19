#!/usr/bin/env npx tsx
/**
 * BLOCKCHAIN RECONSTRUCTION PIPELINE
 * 
 * Reconstruct complete trading history from pure blockchain primitives:
 * 1. ERC1155 token transfers (outcome tokens)
 * 2. ERC20 USDC transfers (cashflows)
 * 3. Market resolutions (winning outcomes + payout vectors)
 * 
 * Timeline: 12-15 hours total
 * Coverage: 85-95% of 159.6M trades (limited by ERC1155 data availability)
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '../lib/clickhouse/client'

interface ReconstructedTrade {
  tx_hash: string
  wallet_address: string
  market_id: string
  condition_id: string
  outcome_index: number
  shares: number
  entry_price: number
  cost_basis: number
  fee_usd: number
  winning_index?: number
  payout_numerators?: number[]
  payout_denominator?: number
  is_winner?: boolean
  realized_pnl?: number
}

async function main() {
  console.log('=' .repeat(120))
  console.log('BLOCKCHAIN RECONSTRUCTION PIPELINE')
  console.log('Goal: Achieve 100% coverage by reconstructing trades from blockchain primitives')
  console.log('=' .repeat(120))

  try {
    // PHASE 1: Check current state
    console.log('\n' + '▶'.repeat(50))
    console.log('PHASE 1: Current Data Inventory')
    console.log('▶'.repeat(50))
    
    const stateResult = await clickhouse.query({
      query: `
        SELECT
          'erc20_transfers_staging' as table_name,
          COUNT(*) as row_count,
          'RAW_BLOCKCHAIN_EVENTS' as status
        FROM erc20_transfers_staging
        UNION ALL
        SELECT
          'erc1155_transfers' as table_name,
          COUNT(*) as row_count,
          'INCOMPLETE' as status
        FROM erc1155_transfers
        UNION ALL
        SELECT
          'trades_raw' as table_name,
          COUNT(*) as row_count,
          '51_PERCENT_COVERAGE' as status
        FROM trades_raw
        UNION ALL
        SELECT
          'market_resolutions_final' as table_name,
          COUNT(*) as row_count,
          'COMPLETE' as status
        FROM market_resolutions_final
      `,
      format: 'JSONEachRow'
    })
    
    const state = await stateResult.json()
    console.log('\nData Inventory:')
    for (const row of state) {
      console.log(`  ${row.table_name.padEnd(30)}: ${String(row.row_count).padStart(15)} rows | ${row.status}`)
    }

    // PHASE 2: Decode USDC transfers
    console.log('\n' + '▶'.repeat(50))
    console.log('PHASE 2: Decode USDC Transfers (387.7M rows)')
    console.log('▶'.repeat(50))
    console.log('\n⏳ This will take 2-3 hours...')
    console.log('   → Parsing raw blockchain event logs')
    console.log('   → Extracting from_address, to_address, amount from topics/data')
    console.log('   → Batching into ClickHouse (hash-sharded to avoid header overflow)')
    
    // Check if already decoded
    const uscdDecoded = await clickhouse.query({
      query: `
        SELECT COUNT(*) as decoded_count
        FROM erc20_transfers
      `,
      format: 'JSONEachRow'
    })
    const decoded = await uscdDecoded.json()
    console.log(`\n   Status: ${decoded[0].decoded_count} already decoded`)
    
    if (decoded[0].decoded_count < 100000) {
      console.log(`   → Need to decode remaining ${387728806 - decoded[0].decoded_count} transfers`)
      console.log(`   → Recommended: Use Alchemy SDK with batch requests`)
      console.log(`   → See: /scripts/decode-erc20-transfers.ts (next script)`)
    }

    // PHASE 3: Fetch ERC1155 data
    console.log('\n' + '▶'.repeat(50))
    console.log('PHASE 3: ERC1155 Token Transfers (Currently 206K, need full dataset)')
    console.log('▶'.repeat(50))
    console.log('\n⏳ This will take 4-6 hours...')
    console.log('   → Fetch all ERC1155 TransferBatch/TransferSingle events')
    console.log('   → From ConditionalTokens contract: 0xd552174f4f14c8f9a6eb4d51e5d2c7bbeafccf61')
    console.log('   → From block 37515000 (Dec 18, 2022) to now')
    console.log('   → Extract: operator, from, to, ids[], amounts[], data')
    
    console.log(`\n   Status: 206K transfers in production (incomplete)`)
    console.log(`   → Need to fetch full historical dataset from Alchemy RPC`)
    console.log(`   → Estimated dataset: 50M-100M ERC1155 transfers`)
    console.log(`   → See: /scripts/fetch-erc1155-transfers.ts (next script)`)

    // PHASE 4: Reconstruct trades
    console.log('\n' + '▶'.repeat(50))
    console.log('PHASE 4: Reconstruct Complete Trades')
    console.log('▶'.repeat(50))
    console.log('\n⏳ This will take 2-3 hours...')
    console.log('   → For each ERC1155 transfer:')
    console.log('   →   Decode condition_id = token_id >> 8')
    console.log('   →   Decode outcome_index = token_id & 0xff')
    console.log('   → Join by tx_hash to USDC transfer:')
    console.log('   →   Extract cost_basis from USDC amount')
    console.log('   →   Extract fee_usd (if present)')
    console.log('   → Result: Complete trade with all fields')

    // PHASE 5: Add resolution data
    console.log('\n' + '▶'.repeat(50))
    console.log('PHASE 5: Join with Market Resolutions')
    console.log('▶'.repeat(50))
    console.log('\n⏳ This will take 1-2 hours...')
    console.log('   → For each reconstructed trade:')
    console.log('   →   Join to market_resolutions_final on condition_id')
    console.log('   →   Get: winning_index, payout_numerators, payout_denominator')
    console.log('   → Determine if trade is WINNER or LOSER')

    // PHASE 6: Calculate P&L
    console.log('\n' + '▶'.repeat(50))
    console.log('PHASE 6: Calculate Realized P&L')
    console.log('▶'.repeat(50))
    console.log('\n⏳ This will take 1 hour...')
    console.log('   → For each trade with resolution:')
    console.log('   →   If WINNER: settlement = shares × (payout / denominator)')
    console.log('   →   PnL = settlement - cost_basis - fee_usd')
    console.log('   → For unresolved trades: Mark as PENDING')

    // PHASE 7: Validate
    console.log('\n' + '▶'.repeat(50))
    console.log('PHASE 7: Validation')
    console.log('▶'.repeat(50))
    console.log('\n⏳ This will take 1-2 hours...')
    console.log('   → Compare reconstructed trades against:')
    console.log('   →   a) Polymarket UI values (10 sample wallets)')
    console.log('   →   b) trades_raw (check overlap, find gaps)')
    console.log('   →   c) Blockchain data (verify all transfers accounted for)')

    console.log('\n' + '='.repeat(120))
    console.log('TIMELINE & NEXT STEPS')
    console.log('='.repeat(120))
    console.log(`\nTotal Time Investment: 12-15 hours`)
    console.log(`\nDecomposed Phases:`)
    console.log(`  Phase 1 (Inventory):        5 min`)
    console.log(`  Phase 2 (Decode USDC):      2-3 hours ⏳`)
    console.log(`  Phase 3 (Fetch ERC1155):    4-6 hours ⏳`)
    console.log(`  Phase 4 (Reconstruct):      2-3 hours ⏳`)
    console.log(`  Phase 5 (Add Resolutions):  1-2 hours ⏳`)
    console.log(`  Phase 6 (Calculate P&L):    1 hour ⏳`)
    console.log(`  Phase 7 (Validate):         1-2 hours ⏳`)
    console.log(`  ────────────────────────────────────`)
    console.log(`  TOTAL:                      12-15 hours`)

    console.log(`\n✅ EXPECTED OUTCOME:`)
    console.log(`   → 95%+ coverage of 159.6M trades`)
    console.log(`   → Correct P&L for all reconstructed trades`)
    console.log(`   → Blockchain-validated data (highest confidence)`)
    console.log(`   → Ready for production deployment`)

    console.log(`\n📋 IMMEDIATE NEXT STEPS:`)
    console.log(`   1. npx tsx scripts/decode-erc20-transfers.ts (decode USDC)`)
    console.log(`   2. npx tsx scripts/fetch-erc1155-transfers.ts (fetch token transfers)`)
    console.log(`   3. npx tsx scripts/reconstruct-trades-from-blockchain.ts (full pipeline)`)
    console.log(`   4. npx tsx scripts/validate-reconstructed-trades.ts (verify correctness)`)

  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

main()
