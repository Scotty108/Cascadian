#!/usr/bin/env npx tsx

/**
 * Remove 0x4bfb... from XCN wallet overrides
 */

import { createClient } from '@clickhouse/client'

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
})

const XCN_CANONICAL = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
const BAD_EXECUTOR = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e'

async function main() {
  console.log('Removing bad executor from XCN wallet overrides...\n')

  // Delete the bad executor mapping
  await clickhouse.command({
    query: `
      ALTER TABLE wallet_identity_overrides
      DELETE WHERE canonical_wallet = '${XCN_CANONICAL}'
        AND executor_wallet = '${BAD_EXECUTOR}'
    `
  })

  console.log(`✅ Removed mapping: ${BAD_EXECUTOR} -> ${XCN_CANONICAL}`)
  console.log()

  // Verify removal
  const verify = await clickhouse.query({
    query: `
      SELECT count() AS remaining
      FROM wallet_identity_overrides
      WHERE canonical_wallet = '${XCN_CANONICAL}'
    `,
    format: 'JSONEachRow'
  })
  const verifyData = await verify.json<any>()

  console.log(`Remaining executor mappings for XCN: ${verifyData[0].remaining}`)

  await clickhouse.close()
}

main().catch(console.error)
