#!/usr/bin/env npx tsx

import { createClient } from '@clickhouse/client'

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
})

async function main() {
  console.log('Getting view definition for vw_trades_canonical_xcn_repaired...\n')

  const query = `SHOW CREATE TABLE vw_trades_canonical_xcn_repaired`
  const response = await clickhouse.query({ query, format: 'TabSeparated' })
  const text = await response.text()

  console.log(text)

  await clickhouse.close()
}

main().catch(console.error)
