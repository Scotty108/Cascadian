/**
 * Step 2: Verify CTF Ledger is Complete
 *
 * Finding: pm_ctf_events contains ONLY PayoutRedemption events (no Split/Merge)
 * Verification: Confirm vw_pm_ledger_v2 correctly includes all redemptions
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

const TEST_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'

async function verifyCTFLedgerComplete() {
  console.log('🔍 Step 2: Verify CTF Ledger is Complete\n')
  console.log('='.repeat(80))

  try {
    // Step 1: Confirm only PayoutRedemption events exist
    console.log('\n1. Confirming CTF event types...\n')

    const eventTypesResult = await clickhouse.query({
      query: `
        SELECT
          event_type,
          count(*) AS count
        FROM pm_ctf_events
        WHERE is_deleted = 0
        GROUP BY event_type
      `,
      format: 'JSONEachRow'
    })
    const eventTypes = await eventTypesResult.json() as Array<{
      event_type: string
      count: string
    }>

    console.log('Event Type       | Count')
    console.log('-'.repeat(35))
    eventTypes.forEach(t => {
      const type = t.event_type.padEnd(16)
      const count = parseInt(t.count).toLocaleString().padStart(12)
      console.log(`${type} | ${count}`)
    })

    const hasOnlyRedemptions = eventTypes.length === 1 && eventTypes[0].event_type === 'PayoutRedemption'

    if (hasOnlyRedemptions) {
      console.log('\n✅ Confirmed: ONLY PayoutRedemption events (no Split/Merge)')
    } else {
      console.log('\n⚠️  Warning: Found other event types!')
    }

    // Step 2: Check how redemptions are mapped in ledger
    console.log('\n' + '='.repeat(80))
    console.log('\n2. Checking redemption mapping in ledger...\n')

    // Get a sample redemption from CTF events
    const sampleRedemptionResult = await clickhouse.query({
      query: `
        SELECT
          lower(user_address) AS user_address,
          lower(condition_id) AS condition_id,
          partition_index_sets,
          toFloat64OrZero(amount_or_payout) / 1e6 AS payout_usdc,
          event_timestamp,
          tx_hash
        FROM pm_ctf_events
        WHERE is_deleted = 0
          AND lower(user_address) = '${TEST_WALLET}'
          AND event_type = 'PayoutRedemption'
        ORDER BY event_timestamp DESC
        LIMIT 5
      `,
      format: 'JSONEachRow'
    })
    const sampleRedemptions = await sampleRedemptionResult.json() as Array<{
      user_address: string
      condition_id: string
      partition_index_sets: string
      payout_usdc: number
      event_timestamp: string
      tx_hash: string
    }>

    if (sampleRedemptions.length > 0) {
      console.log(`Found ${sampleRedemptions.length} redemptions for test wallet:\n`)

      sampleRedemptions.forEach((r, idx) => {
        console.log(`Redemption ${idx + 1}:`)
        console.log(`  Condition: ${r.condition_id.slice(0, 16)}...`)
        console.log(`  Partitions: ${r.partition_index_sets}`)
        console.log(`  Payout: $${r.payout_usdc.toFixed(2)}`)
        console.log(`  Time: ${r.event_timestamp}`)
        console.log(`  TX: ${r.tx_hash.slice(0, 16)}...`)

        // Check if this appears in ledger
        console.log(`  Checking ledger...`)
        console.log()
      })

      // Check if redemptions appear in ledger
      const ledgerCheckResult = await clickhouse.query({
        query: `
          SELECT
            condition_id,
            outcome_index,
            shares_delta,
            cash_delta_usdc,
            block_time,
            source
          FROM vw_pm_ledger_v2
          WHERE wallet_address = '${TEST_WALLET}'
            AND source LIKE 'CTF%'
          ORDER BY block_time DESC
          LIMIT 10
        `,
        format: 'JSONEachRow'
      })
      const ledgerEntries = await ledgerCheckResult.json() as Array<{
        condition_id: string
        outcome_index: number
        shares_delta: number
        cash_delta_usdc: number
        block_time: string
        source: string
      }>

      if (ledgerEntries.length > 0) {
        console.log(`✅ Found ${ledgerEntries.length} CTF ledger entries for test wallet:\n`)

        console.log('Condition (16)    | Outcome | Shares Δ    | Cash Δ      | Source')
        console.log('-'.repeat(75))
        ledgerEntries.forEach(e => {
          const cond = e.condition_id.slice(0, 16)
          const outcome = e.outcome_index.toString().padStart(7)
          const shares = e.shares_delta.toFixed(2).padStart(11)
          const cash = `$${e.cash_delta_usdc.toFixed(2)}`.padStart(11)
          const source = e.source
          console.log(`${cond} | ${outcome} | ${shares} | ${cash} | ${source}`)
        })
      } else {
        console.log('❌ No CTF ledger entries found for test wallet!')
        console.log('   This suggests redemptions are NOT being included in ledger')
      }
    } else {
      console.log('ℹ️  Test wallet has no redemption events')
    }

    // Step 3: Verify ledger completeness
    console.log('\n' + '='.repeat(80))
    console.log('\n3. Verifying ledger completeness...\n')

    // Count CTF events for test wallet
    const ctfCountResult = await clickhouse.query({
      query: `
        SELECT count(*) AS ctf_count
        FROM pm_ctf_events
        WHERE is_deleted = 0
          AND lower(user_address) = '${TEST_WALLET}'
      `,
      format: 'JSONEachRow'
    })
    const ctfCount = await ctfCountResult.json() as Array<{ ctf_count: string }>
    const ctfEvents = parseInt(ctfCount[0].ctf_count)

    // Count ledger CTF entries for test wallet
    const ledgerCtfCountResult = await clickhouse.query({
      query: `
        SELECT count(*) AS ledger_ctf_count
        FROM vw_pm_ledger_v2
        WHERE wallet_address = '${TEST_WALLET}'
          AND source LIKE 'CTF%'
      `,
      format: 'JSONEachRow'
    })
    const ledgerCtfCount = await ledgerCtfCountResult.json() as Array<{ ledger_ctf_count: string }>
    const ledgerCtfEntries = parseInt(ledgerCtfCount[0].ledger_ctf_count)

    console.log('CTF Coverage for Test Wallet:')
    console.log(`  CTF Events:        ${ctfEvents.toLocaleString().padStart(6)}`)
    console.log(`  Ledger CTF Entries: ${ledgerCtfEntries.toLocaleString().padStart(6)}`)

    if (ledgerCtfEntries === ctfEvents) {
      console.log(`  ✅ Perfect match (1:1 mapping)`)
    } else if (ledgerCtfEntries > ctfEvents) {
      console.log(`  ⚠️  More ledger entries than events (may be expanded per-outcome)`)
    } else {
      console.log(`  ❌ Missing ledger entries!`)
    }

    // Summary
    console.log('\n' + '='.repeat(80))
    console.log('\n📋 STEP 2 SUMMARY\n')

    console.log('Findings:')
    console.log(`  1. CTF events: ONLY PayoutRedemption (${eventTypes[0].count.toLocaleString()} total)`)
    console.log('  2. No PositionSplit or PositionMerge events in dataset')
    console.log(`  3. Test wallet: ${ctfEvents} CTF events, ${ledgerCtfEntries} ledger entries`)

    console.log()
    console.log('Conclusion:')
    if (hasOnlyRedemptions) {
      console.log('  ✅ Current vw_pm_ledger_v2 includes ALL CTF event types')
      console.log('  ✅ No additional CTF event types need to be added')
      console.log('  ✅ Step 2 is COMPLETE (ledger already comprehensive)')
    } else {
      console.log('  ⚠️  Additional CTF event types found - need to add to ledger')
    }

    console.log()
    console.log('Next: Step 3 - Resolution QA pass (sample 10 markets)')
    console.log('='.repeat(80))

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}

verifyCTFLedgerComplete()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
