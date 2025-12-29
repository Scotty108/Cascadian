import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'

async function analyzeCTF() {
  console.log('🔍 Analyzing CTF Events\n')
  console.log('='.repeat(80))

  // Check CTF event types and structure
  console.log('\n📊 CTF Event Types (Global)\n')

  const typesResult = await clickhouse.query({
    query: `
      SELECT
        event_type,
        count() as event_count,
        sum(toFloat64OrZero(amount_or_payout)) / 1e6 as total_units
      FROM pm_ctf_events
      WHERE is_deleted = 0
      GROUP BY event_type
      ORDER BY event_count DESC
    `,
    format: 'JSONEachRow'
  })
  const types = await typesResult.json() as Array<{
    event_type: string
    event_count: string
    total_units: number
  }>

  console.log('Event Type       | Count        | Total Units')
  console.log('-'.repeat(55))
  types.forEach(row => {
    const type = row.event_type.padEnd(16)
    const count = parseInt(row.event_count).toLocaleString().padStart(12)
    const units = row.total_units.toFixed(2).padStart(11)
    console.log(`${type} | ${count} | ${units}`)
  })

  // Check for problem wallet
  console.log('\n' + '='.repeat(80))
  console.log(`\n📊 CTF Events for Wallet ${WALLET}\n`)

  const walletCTFResult = await clickhouse.query({
    query: `
      SELECT
        event_type,
        count() as event_count,
        sum(toFloat64OrZero(amount_or_payout)) / 1e6 as total_units
      FROM pm_ctf_events
      WHERE lower(user_address) = '${WALLET}'
        AND is_deleted = 0
      GROUP BY event_type
      ORDER BY event_count DESC
    `,
    format: 'JSONEachRow'
  })
  const walletCTF = await walletCTFResult.json() as Array<{
    event_type: string
    event_count: string
    total_units: number
  }>

  if (walletCTF.length > 0) {
    console.log('Event Type       | Count        | Total Units')
    console.log('-'.repeat(55))
    walletCTF.forEach(row => {
      const type = row.event_type.padEnd(16)
      const count = parseInt(row.event_count).toLocaleString().padStart(12)
      const units = row.total_units.toFixed(2).padStart(11)
      console.log(`${type} | ${count} | ${units}`)
    })

    const totalEvents = walletCTF.reduce((sum, r) => sum + parseInt(r.event_count), 0)
    console.log(`\nTotal CTF Events: ${totalEvents.toLocaleString()}`)
    console.log('✅ Wallet HAS CTF events - this explains part of the UI gap!')
  } else {
    console.log('❌ Wallet has NO CTF events')
    console.log('   CTF is not the cause of remaining gap')
  }

  // Sample CTF events
  console.log('\n' + '='.repeat(80))
  console.log('\n📊 Sample CTF Events (Any Wallet)\n')

  const sampleResult = await clickhouse.query({
    query: `
      SELECT *
      FROM pm_ctf_events
      WHERE is_deleted = 0
      LIMIT 5
    `,
    format: 'JSONEachRow'
  })
  const samples = await sampleResult.json()

  console.log('Sample events:')
  console.log(JSON.stringify(samples, null, 2))

  console.log('\n' + '='.repeat(80))
}

analyzeCTF()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
