#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function check() {
  console.log('Checking condition_id field in trades_raw...\n')

  try {
    // Check if condition_id is populated
    const query = `
      SELECT
        COUNT(*) as total_rows,
        SUM(CASE WHEN condition_id IS NOT NULL AND condition_id != '' THEN 1 ELSE 0 END) as populated,
        SUM(CASE WHEN condition_id IS NULL OR condition_id = '' THEN 1 ELSE 0 END) as empty,
        COUNT(DISTINCT condition_id) as unique_values
      FROM trades_raw
      WHERE wallet_address = '0x961b5ad4c66ec18d073c216054ddd42523336a1d';
    `

    const result = await clickhouse.query({
      query: query,
      format: 'JSONEachRow'
    })

    const rows = await result.json()
    const row = rows[0]

    console.log('='.repeat(80))
    console.log('Condition ID Population Check')
    console.log('='.repeat(80))
    console.log(`Total trades:        ${row.total_rows}`)
    console.log(`With condition_id:   ${row.populated}`)
    console.log(`Empty/NULL:          ${row.empty}`)
    console.log(`Unique values:       ${row.unique_values}`)
    console.log('='.repeat(80))

    if (row.empty > 0) {
      console.log('\n🚨 PROBLEM: condition_id field is EMPTY for many trades!')
      console.log('This is why the JOIN fails.\n')
    }

  } catch (error) {
    console.error('Error:', error)
  }
}

check()
