#!/usr/bin/env npx tsx
/**
 * Extract unique block numbers from trades_raw where condition_id is empty
 * This will tell us exactly how many blocks we need to scan instead of all 41.2M
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function main() {
  console.log('Extracting unique blocks from trades_raw with empty condition_ids...\n')

  try {
    // Get count and block range
    const countResult = await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as trade_count,
          COUNT(DISTINCT block_number) as unique_blocks,
          MIN(block_number) as min_block,
          MAX(block_number) as max_block
        FROM trades_raw
        WHERE condition_id = ''
      `
    })

    const countText = await countResult.text()
    console.log('Stats on trades with empty condition_ids:')
    console.log(countText)
    console.log()

    // Get a sample of the actual block numbers
    console.log('\nSample blocks:')
    const sampleResult = await clickhouse.query({
      query: `
        SELECT DISTINCT block_number
        FROM trades_raw
        WHERE condition_id = ''
        ORDER BY block_number
        LIMIT 20
      `
    })
    const sampleText = await sampleResult.text()
    console.log(sampleText)

  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  }
}

main()
