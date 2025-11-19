#!/usr/bin/env npx tsx

import { clickhouse } from './lib/clickhouse/client'

async function main() {
  const result = await clickhouse.query({
    query: 'SELECT COUNT(*) as count FROM erc1155_transfers'
  })

  const text = await result.text()
  const count = parseInt(text.trim())

  console.log('Current row count: ' + count.toLocaleString())
}

main().catch(e => console.error(e.message))
