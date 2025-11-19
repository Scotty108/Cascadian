#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

async function createMarketOutcomes() {
  const client = getClickHouseClient()

  try {
    console.log('=' .repeat(80))
    console.log('CREATE market_outcomes TABLE FROM gamma_markets')
    console.log('=' .repeat(80))
    console.log(`Started: ${new Date().toISOString()}`)
    console.log('=' .repeat(80))
    console.log('')

    // Step 1: Drop existing table if it exists
    console.log('Step 1: Dropping old market_outcomes table if exists...\n')

    await client.exec({
      query: 'DROP TABLE IF EXISTS market_outcomes'
    })

    console.log('✅ Old table dropped (if existed)\n')

    // Step 2: Create market_outcomes table structure
    console.log('Step 2: Creating market_outcomes table structure...\n')

    await client.exec({
      query: `
        CREATE TABLE market_outcomes (
          condition_id_norm String,
          outcomes Array(String)
        ) ENGINE = SharedMergeTree()
        ORDER BY condition_id_norm
      `
    })

    console.log('✅ Table structure created\n')

    // Step 3: Insert data from gamma_markets
    console.log('Step 3: Inserting data from gamma_markets...\n')
    console.log('⏳ This will parse JSON and normalize condition IDs...\n')

    await client.exec({
      query: `
        INSERT INTO market_outcomes
        SELECT
          lower(replaceAll(condition_id, '0x', '')) AS condition_id_norm,
          JSONExtract(outcomes_json, 'Array(String)') AS outcomes
        FROM gamma_markets
        WHERE length(outcomes_json) > 0
          AND length(replaceAll(condition_id, '0x', '')) = 64
      `
    })

    console.log('✅ Data inserted\n')

    // Step 4: Validate the table
    console.log('Step 4: Validating market_outcomes...\n')

    const countResult = await client.query({
      query: 'SELECT count() as total FROM market_outcomes',
      format: 'JSONEachRow'
    })
    const countData = await countResult.json<any[]>()
    const totalRows = parseInt(countData[0].total)

    console.log(`  Total markets: ${totalRows.toLocaleString()}\n`)

    // Check a sample row
    const sampleResult = await client.query({
      query: `
        SELECT
          condition_id_norm,
          outcomes,
          length(outcomes) as outcome_count
        FROM market_outcomes
        LIMIT 1
      `,
      format: 'JSONEachRow'
    })
    const sampleData = await sampleResult.json<any[]>()

    console.log('  Sample row:')
    console.log(`    condition_id_norm: ${sampleData[0].condition_id_norm}`)
    console.log(`    outcomes: ${JSON.stringify(sampleData[0].outcomes)}`)
    console.log(`    outcome_count: ${sampleData[0].outcome_count}\n`)

    // Step 5: Recreate market_outcomes_expanded view
    console.log('Step 5: Recreating market_outcomes_expanded view...\n')

    await client.exec({
      query: 'DROP VIEW IF EXISTS market_outcomes_expanded'
    })

    await client.exec({
      query: `
        CREATE VIEW market_outcomes_expanded AS
        SELECT
          mo.condition_id_norm,
          idx - 1 AS outcome_idx,
          upperUTF8(toString(mo.outcomes[idx])) AS outcome_label
        FROM market_outcomes AS mo
        ARRAY JOIN arrayEnumerate(mo.outcomes) AS idx
      `
    })

    console.log('✅ market_outcomes_expanded view created\n')

    // Validate the view
    const viewCountResult = await client.query({
      query: 'SELECT count() as total FROM market_outcomes_expanded',
      format: 'JSONEachRow'
    })
    const viewCountData = await viewCountResult.json<any[]>()
    const viewRows = parseInt(viewCountData[0].total)

    console.log(`  Expanded outcomes: ${viewRows.toLocaleString()}\n`)

    // Step 6: Check if winning_index view works now
    console.log('Step 6: Testing winning_index view...\n')

    try {
      const winningTestResult = await client.query({
        query: 'SELECT count() as total FROM winning_index',
        format: 'JSONEachRow'
      })
      const winningTestData = await winningTestResult.json<any[]>()
      const winningRows = parseInt(winningTestData[0].total)

      console.log(`✅ winning_index view works!`)
      console.log(`  Resolved markets: ${winningRows.toLocaleString()}\n`)
    } catch (error: any) {
      console.log(`⚠️  winning_index view error: ${error.message}\n`)
      console.log('This might need to be recreated or fixed separately.\n')
    }

    console.log('=' .repeat(80))
    console.log('✅ market_outcomes TABLE CREATED SUCCESSFULLY')
    console.log('=' .repeat(80))
    console.log(`Finished: ${new Date().toISOString()}\n`)
    console.log('Next step: Run Stage 4 to rebuild realized_pnl_by_market_final\n')

  } catch (error: any) {
    console.error('\n❌ Error:', error.message)
    console.error('\nStack trace:', error.stack)
    throw error
  } finally {
    await client.close()
  }
}

createMarketOutcomes()
