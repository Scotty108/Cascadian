/**
 * Describe pm_ctf_events table schema
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

async function describeCTFEvents() {
  console.log('🔍 Describing pm_ctf_events Schema\n')

  try {
    // Describe table
    const describeResult = await clickhouse.query({
      query: `DESCRIBE TABLE pm_ctf_events`,
      format: 'JSONEachRow'
    })
    const schema = await describeResult.json() as Array<{
      name: string
      type: string
      default_type: string
      default_expression: string
    }>

    console.log('Column Name                | Type')
    console.log('-'.repeat(60))
    schema.forEach(col => {
      const name = col.name.padEnd(26)
      console.log(`${name} | ${col.type}`)
    })

    // Sample a few rows
    console.log('\n' + '='.repeat(80))
    console.log('\nSample rows:\n')

    const sampleResult = await clickhouse.query({
      query: `SELECT * FROM pm_ctf_events LIMIT 3`,
      format: 'JSONEachRow'
    })
    const samples = await sampleResult.json()

    samples.forEach((row: any, idx: number) => {
      console.log(`Sample ${idx + 1}:`)
      console.log(JSON.stringify(row, null, 2))
      console.log()
    })

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}

describeCTFEvents()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
