import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

/**
 * Check if the remaining 77M trades from trades_raw can be recovered
 * using the same ERC1155 blockchain reconstruction method
 */

async function checkRecoveryPotential() {
  try {
    console.log('═'.repeat(70))
    console.log('RECOVERY POTENTIAL CHECK - Remaining 77M Trades')
    console.log('═'.repeat(70))
    console.log()

    // Step 1: Check current state
    console.log('Step 1: Current state analysis...')

    const stateResult = await clickhouse.query({
      query: `
        SELECT
          (SELECT COUNT(*) FROM trades_raw) as total_raw,
          (SELECT COUNT(*) FROM trades_with_direction) as in_direction,
          (SELECT COUNT(*) FROM trades_raw) - (SELECT COUNT(*) FROM trades_with_direction) as remaining
        FROM system.one
      `
    })

    const state = JSON.parse(await stateResult.text()).data[0]
    console.log(`  trades_raw: ${parseInt(state.total_raw).toLocaleString()}`)
    console.log(`  trades_with_direction: ${parseInt(state.in_direction).toLocaleString()}`)
    console.log(`  Remaining to recover: ${parseInt(state.remaining).toLocaleString()}`)
    console.log()

    // Step 2: Check the remaining trades - do they have tx_hashes?
    console.log('Step 2: Analyzing remaining trades...')

    const remainingAnalysis = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total_remaining,
          COUNT(CASE WHEN transaction_hash != '' AND transaction_hash IS NOT NULL THEN 1 END) as with_tx_hash,
          COUNT(CASE WHEN market_id = '0x0000000000000000000000000000000000000000000000000000000000000000' THEN 1 END) as with_zero_market,
          COUNT(CASE WHEN condition_id = '' OR condition_id IS NULL THEN 1 END) as missing_condition
        FROM trades_raw
        WHERE trade_id NOT IN (
          SELECT CONCAT(tx_hash, '_', condition_id_norm)
          FROM trades_with_direction
          LIMIT 1000000
        )
        LIMIT 1000000
      `
    })

    const remaining = JSON.parse(await remainingAnalysis.text()).data[0]
    console.log(`  Sample of remaining trades: ${parseInt(remaining.total_remaining).toLocaleString()}`)
    console.log(`  With tx_hash: ${parseInt(remaining.with_tx_hash).toLocaleString()}`)
    console.log(`  With zero market_id: ${parseInt(remaining.with_zero_market).toLocaleString()}`)
    console.log(`  Missing condition_id: ${parseInt(remaining.missing_condition).toLocaleString()}`)
    console.log()

    // Step 3: Check if those tx_hashes exist in erc1155_transfers
    console.log('Step 3: Checking blockchain data availability...')

    const blockchainCheckResult = await clickhouse.query({
      query: `
        SELECT
          COUNT(DISTINCT t.transaction_hash) as unique_tx_hashes,
          COUNT(DISTINCT e.tx_hash) as found_in_erc1155,
          ROUND(100.0 * COUNT(DISTINCT e.tx_hash) / COUNT(DISTINCT t.transaction_hash), 2) as match_rate
        FROM (
          SELECT DISTINCT transaction_hash
          FROM trades_raw
          WHERE condition_id = '' OR condition_id IS NULL
          LIMIT 100000
        ) t
        LEFT JOIN erc1155_transfers e
          ON t.transaction_hash = e.tx_hash
      `
    })

    const blockchainCheck = JSON.parse(await blockchainCheckResult.text()).data[0]
    console.log(`  Unique tx_hashes sampled: ${parseInt(blockchainCheck.unique_tx_hashes).toLocaleString()}`)
    console.log(`  Found in erc1155_transfers: ${parseInt(blockchainCheck.found_in_erc1155).toLocaleString()}`)
    console.log(`  Match rate: ${blockchainCheck.match_rate}%`)
    console.log()

    // Step 4: Estimate recovery potential
    console.log('Step 4: Recovery potential estimate...')

    const estimatedRecoverable = parseInt(state.remaining) * (parseFloat(blockchainCheck.match_rate) / 100)

    console.log(`  Estimated recoverable trades: ~${Math.round(estimatedRecoverable).toLocaleString()}`)
    console.log(`  New total coverage: ~${Math.round(parseInt(state.in_direction) + estimatedRecoverable).toLocaleString()} / ${parseInt(state.total_raw).toLocaleString()}`)
    console.log(`  New coverage %: ${((parseInt(state.in_direction) + estimatedRecoverable) / parseInt(state.total_raw) * 100).toFixed(2)}%`)
    console.log()

    // Step 5: Sample test - try to recover 10 trades
    console.log('Step 5: Testing recovery on sample...')

    const testRecoveryResult = await clickhouse.query({
      query: `
        WITH erc1155_decoded AS (
          SELECT
            tx_hash,
            from_address,
            to_address,
            leftPad(lowerUTF8(hex(intDiv(CAST(token_id AS UInt256), 256))), 64, '0') as condition_id_decoded,
            CAST(token_id AS UInt256) % 256 as outcome_decoded
          FROM erc1155_transfers
          WHERE length(token_id) > 10
        )
        SELECT
          t.trade_id,
          t.transaction_hash,
          t.wallet_address,
          t.outcome_index,
          e.condition_id_decoded,
          CASE
            WHEN e.condition_id_decoded IS NOT NULL THEN 'RECOVERABLE'
            ELSE 'NOT_FOUND'
          END as status
        FROM (
          SELECT *
          FROM trades_raw
          WHERE condition_id = '' OR condition_id IS NULL
          LIMIT 10
        ) t
        LEFT JOIN erc1155_decoded e
          ON t.transaction_hash = e.tx_hash
          AND t.outcome_index = e.outcome_decoded
          AND (lower(t.wallet_address) = lower(e.from_address) OR lower(t.wallet_address) = lower(e.to_address))
      `
    })

    const testRecovery = JSON.parse(await testRecoveryResult.text()).data
    const recovered = testRecovery.filter((r: any) => r.status === 'RECOVERABLE').length

    console.log(`  Sample test: ${recovered} / ${testRecovery.length} trades recovered`)
    if (testRecovery.length > 0) {
      console.log(`  Sample recovery rate: ${(recovered / testRecovery.length * 100).toFixed(1)}%`)
    }
    console.log()

    console.log('═'.repeat(70))

    if (parseFloat(blockchainCheck.match_rate) > 10) {
      console.log('✅ RECOVERY FEASIBLE')
      console.log(`   Can recover ~${blockchainCheck.match_rate}% of remaining trades`)
      console.log(`   Estimated ${Math.round(estimatedRecoverable).toLocaleString()} additional trades`)
      console.log()
      console.log('NEXT STEP: Run the recovery script (43-erc1155-recovery-improved.ts) on remaining trades')
    } else if (parseFloat(blockchainCheck.match_rate) > 0) {
      console.log('⚠️  LIMITED RECOVERY POSSIBLE')
      console.log(`   Only ${blockchainCheck.match_rate}% of remaining trades have blockchain data`)
      console.log(`   Worth recovering: ${Math.round(estimatedRecoverable).toLocaleString()} trades`)
    } else {
      console.log('❌ RECOVERY NOT POSSIBLE')
      console.log('   Remaining trades have no blockchain traces in erc1155_transfers')
      console.log('   The 82.1M in trades_with_direction is the maximum recoverable')
    }

    console.log('═'.repeat(70))
    console.log()

    return {
      success: true,
      totalRaw: state.total_raw,
      inDirection: state.in_direction,
      remaining: state.remaining,
      matchRate: blockchainCheck.match_rate,
      estimatedRecoverable: Math.round(estimatedRecoverable),
      newCoveragePercent: ((parseInt(state.in_direction) + estimatedRecoverable) / parseInt(state.total_raw) * 100).toFixed(2)
    }

  } catch (e: any) {
    console.error('ERROR:', e.message)
    return {
      success: false,
      error: e.message
    }
  }
}

checkRecoveryPotential().then(result => {
  console.log('Check Result:', JSON.stringify(result, null, 2))
  process.exit(result.success ? 0 : 1)
})
