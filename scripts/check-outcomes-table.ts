import { config } from 'dotenv'
import { resolve } from 'path'

// Load environment variables from .env.local
config({ path: resolve(__dirname, '../.env.local') })

import { getClickHouseClient } from '../lib/clickhouse/client'

async function main() {
  const client = getClickHouseClient()

  console.log('=== Checking market_outcomes table ===\n')

  // Check schema
  const schemaResult = await client.query({
    query: `DESCRIBE market_outcomes`,
    format: 'JSONEachRow',
  })

  const schema = await schemaResult.json()
  console.log('Schema:')
  console.table(schema)

  // Check sample data
  console.log('\n=== Sample data from market_outcomes ===')
  const sampleResult = await client.query({
    query: `
      SELECT
        condition_id_norm,
        outcomes,
        arrayElement(outcomes, 1) as outcome_0,
        arrayElement(outcomes, 2) as outcome_1,
        length(outcomes) as outcome_count
      FROM market_outcomes
      LIMIT 10
    `,
    format: 'JSONEachRow',
  })

  const sample = await sampleResult.json()
  console.table(sample)

  // Check if outcomes are empty
  console.log('\n=== Checking for empty outcomes ===')
  const emptyCheck = await client.query({
    query: `
      SELECT
        COUNT(*) as total_rows,
        COUNT(CASE WHEN length(outcomes) = 0 THEN 1 END) as empty_outcomes,
        COUNT(CASE WHEN length(outcomes) > 0 THEN 1 END) as has_outcomes
      FROM market_outcomes
    `,
    format: 'JSONEachRow',
  })

  const emptyStats = await emptyCheck.json()
  console.table(emptyStats)

  // Try to expand view with specific condition
  console.log('\n=== Testing market_outcomes_expanded view ===')
  const expandedResult = await client.query({
    query: `
      SELECT
        condition_id_norm,
        outcome_idx,
        outcome_label
      FROM market_outcomes_expanded
      LIMIT 10
    `,
    format: 'JSONEachRow',
  })

  const expanded = await expandedResult.json()
  console.table(expanded)

  // Check one specific condition from first query
  console.log('\n=== Checking specific condition ===')
  const specificResult = await client.query({
    query: `
      SELECT
        condition_id_norm,
        outcomes,
        length(outcomes) as outcome_count
      FROM market_outcomes
      WHERE condition_id_norm = '031c767a89ae769cafea9fd0862935aed84767093927681e0dc16895f70ef838'
      LIMIT 5
    `,
    format: 'JSONEachRow',
  })

  const specific = await specificResult.json()
  console.log('Specific condition data:')
  console.table(specific)

  await client.close()
}

main().catch(error => {
  console.error('Error:', error)
  process.exit(1)
})
