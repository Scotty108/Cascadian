#!/usr/bin/env npx tsx

/**
 * Check if wallet_identity_overrides table exists and has the correct mapping
 */

import { createClient } from '@clickhouse/client'

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
})

const XCN_EXECUTOR = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e'
const XCN_CANONICAL = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'

async function main() {
  console.log('════════════════════════════════════════════════════════════════════')
  console.log('CHECK WALLET_IDENTITY_OVERRIDES TABLE')
  console.log('════════════════════════════════════════════════════════════════════\n')

  try {
    // Check if table exists
    const tablesQuery = `SHOW TABLES LIKE 'wallet_identity%'`
    const tablesResponse = await clickhouse.query({ query: tablesQuery, format: 'JSONEachRow' })
    const tables = await tablesResponse.json<any>()

    console.log('Tables matching "wallet_identity%":\n')
    tables.forEach(t => {
      console.log(`  - ${t.name}`)
    })
    console.log()

    // If wallet_identity_overrides exists, check it
    const hasOverrides = tables.some(t => t.name === 'wallet_identity_overrides')

    if (hasOverrides) {
      console.log('Checking wallet_identity_overrides for XCN mapping:\n')

      const overridesQuery = `
        SELECT *
        FROM wallet_identity_overrides
        WHERE canonical_wallet = '${XCN_CANONICAL}'
           OR executor_wallet = '${XCN_EXECUTOR}'
      `
      const overridesResponse = await clickhouse.query({
        query: overridesQuery,
        format: 'JSONEachRow',
      })
      const overridesData = await overridesResponse.json<any>()

      console.log(`Found ${overridesData.length} entries`)
      overridesData.forEach((row, i) => {
        console.log(`${i + 1}. ${JSON.stringify(row, null, 2)}`)
      })
    } else {
      console.log('❌ wallet_identity_overrides table does NOT exist')
      console.log('   This is the table mentioned in user\'s SQL query')
      console.log('   We may need to update the view to use a different table')
    }

  } catch (error) {
    console.error('Error:', error)
  }

  await clickhouse.close()
}

main().catch(console.error)
