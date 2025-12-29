/**
 * Step 2: Check CTF Event Types
 *
 * Verify what event types exist in pm_ctf_events and
 * check if our test wallet has any Split/Merge operations
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

const TEST_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'

async function checkCTFEventTypes() {
  console.log('🔍 Step 2: Check CTF Event Types\n')
  console.log('='.repeat(80))

  try {
    // Step 1: Get count by event type (all wallets)
    console.log('\n1. CTF Event Type Distribution (all wallets)...\n')

    const typeDistResult = await clickhouse.query({
      query: `
        SELECT
          event_type,
          count(*) AS event_count,
          sum(toFloat64OrZero(amount_or_payout) / 1e6) AS total_amount_usdc
        FROM pm_ctf_events
        WHERE is_deleted = 0
        GROUP BY event_type
        ORDER BY event_count DESC
      `,
      format: 'JSONEachRow'
    })
    const typeDist = await typeDistResult.json() as Array<{
      event_type: string
      event_count: string
      total_amount_usdc: number
    }>

    console.log('Event Type       | Count       | Total Amount (USDC)')
    console.log('-'.repeat(60))
    typeDist.forEach(t => {
      const eventType = t.event_type.padEnd(16)
      const count = parseInt(t.event_count).toLocaleString().padStart(11)
      const amount = `$${t.total_amount_usdc.toLocaleString(undefined, {maximumFractionDigits: 2})}`.padStart(20)
      console.log(`${eventType} | ${count} | ${amount}`)
    })

    // Step 2: Check test wallet specifically
    console.log('\n' + '='.repeat(80))
    console.log(`\n2. Test Wallet CTF Events (${TEST_WALLET})...\n`)

    const walletEventsResult = await clickhouse.query({
      query: `
        SELECT
          event_type,
          count(*) AS event_count
        FROM pm_ctf_events
        WHERE is_deleted = 0
          AND lower(user_address) = '${TEST_WALLET}'
        GROUP BY event_type
        ORDER BY event_count DESC
      `,
      format: 'JSONEachRow'
    })
    const walletEvents = await walletEventsResult.json() as Array<{
      event_type: string
      event_count: string
    }>

    if (walletEvents.length > 0) {
      console.log('Event Type       | Count')
      console.log('-'.repeat(30))
      walletEvents.forEach(e => {
        const eventType = e.event_type.padEnd(16)
        const count = parseInt(e.event_count).toLocaleString().padStart(6)
        console.log(`${eventType} | ${count}`)
      })
    } else {
      console.log('❌ Test wallet has ZERO CTF events')
    }

    // Step 3: Sample some events to understand schema
    console.log('\n' + '='.repeat(80))
    console.log('\n3. Sample CTF Events (3 of each type)...\n')

    for (const type of typeDist) {
      console.log(`--- ${type.event_type} ---\n`)

      const sampleResult = await clickhouse.query({
        query: `
          SELECT
            event_type,
            lower(user_address) AS user_address,
            lower(condition_id) AS condition_id,
            outcome_indexes,
            toFloat64OrZero(amount_or_payout) / 1e6 AS amount_usdc,
            event_timestamp,
            tx_hash
          FROM pm_ctf_events
          WHERE is_deleted = 0
            AND event_type = '${type.event_type}'
          LIMIT 3
        `,
        format: 'JSONEachRow'
      })
      const samples = await sampleResult.json() as Array<{
        event_type: string
        user_address: string
        condition_id: string
        outcome_indexes: string
        amount_usdc: number
        event_timestamp: string
        tx_hash: string
      }>

      samples.forEach((s, idx) => {
        console.log(`Sample ${idx + 1}:`)
        console.log(`  User: ${s.user_address.slice(0, 10)}...`)
        console.log(`  Condition: ${s.condition_id.slice(0, 10)}...`)
        console.log(`  Outcomes: ${s.outcome_indexes}`)
        console.log(`  Amount: $${s.amount_usdc.toFixed(2)}`)
        console.log(`  Time: ${s.event_timestamp}`)
        console.log()
      })
    }

    // Step 4: Design implications
    console.log('='.repeat(80))
    console.log('\n📋 DESIGN IMPLICATIONS\n')

    const hasSplit = typeDist.some(t => t.event_type === 'PositionSplit')
    const hasMerge = typeDist.some(t => t.event_type === 'PositionMerge')
    const hasRedeem = typeDist.some(t => t.event_type === 'PayoutRedemption')

    console.log('Event Type Coverage:')
    console.log(`  ✅ PayoutRedemption: ${hasRedeem ? `${typeDist.find(t => t.event_type === 'PayoutRedemption')?.event_count.toLocaleString() || '0'} events` : 'NOT FOUND'}`)
    console.log(`  ${hasSplit ? '✅' : '❌'} PositionSplit:     ${hasSplit ? `${typeDist.find(t => t.event_type === 'PositionSplit')?.event_count.toLocaleString() || '0'} events` : 'NOT FOUND'}`)
    console.log(`  ${hasMerge ? '✅' : '❌'} PositionMerge:     ${hasMerge ? `${typeDist.find(t => t.event_type === 'PositionMerge')?.event_count.toLocaleString() || '0'} events` : 'NOT FOUND'}`)

    console.log()

    if (hasSplit || hasMerge) {
      console.log('🔄 CTF SPLIT/MERGE LEDGER DESIGN:')
      console.log()
      console.log('PositionSplit (Mint complete set → individual outcomes):')
      console.log('  - Spend: $1 per complete set (cash_delta = -amount)')
      console.log('  - Gain: +1 share of EACH outcome (shares_delta = +amount per outcome)')
      console.log('  - Need to create ONE ledger row PER outcome_index')
      console.log()
      console.log('PositionMerge (Combine outcomes → complete set):')
      console.log('  - Gain: $1 per complete set (cash_delta = +amount)')
      console.log('  - Lose: -1 share of EACH outcome (shares_delta = -amount per outcome)')
      console.log('  - Need to create ONE ledger row PER outcome_index')
      console.log()
      console.log('PayoutRedemption (Burn winning shares):')
      console.log('  - Current implementation: single row with outcome_index = 0')
      console.log('  - May need to update to match actual winning outcome_index')
    } else {
      console.log('✅ No Split/Merge events found - current ledger is complete')
    }

    console.log()
    console.log('='.repeat(80))

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}

checkCTFEventTypes()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
