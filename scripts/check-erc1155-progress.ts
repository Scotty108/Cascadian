#!/usr/bin/env npx tsx

import { clickhouse } from './lib/clickhouse/client'

async function main() {
  try {
    const result = await clickhouse.query({
      query: 'SELECT COUNT(*) as count, COUNT(DISTINCT tx_hash) as unique_txs, MAX(block_number) as max_block FROM erc1155_transfers'
    })

    const text = await result.text()
    const lines = text.trim().split('\n')

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('BACKFILL PROGRESS CHECK')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

    if (lines.length > 0) {
      const parts = lines[0].split('\t')
      const count = parseInt(parts[0]).toLocaleString()
      const unique = parseInt(parts[1]).toLocaleString()
      const maxBlock = parseInt(parts[2])

      console.log(`Total events: ${count}`)
      console.log(`Unique tx_hash: ${unique}`)
      console.log(`Max block processed: ${maxBlock.toLocaleString()}`)
      console.log('')

      // Calculate progress
      const startBlock = 37515000
      const endBlock = 78736386
      const blocksProcessed = maxBlock - startBlock
      const totalBlocks = endBlock - startBlock
      const pct = ((blocksProcessed / totalBlocks) * 100).toFixed(1)

      console.log(`Progress: ${pct}% complete`)
      console.log(`  Blocks: ${blocksProcessed.toLocaleString()} / ${totalBlocks.toLocaleString()}`)
    }
  } catch (e: any) {
    console.error('Error:', e.message)
    process.exit(1)
  }
}

main()
