import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function diagnose() {
  try {
    console.log('DIAGNOSING: Market ID ↔ Condition ID Mapping')
    console.log('═'.repeat(70))
    console.log()

    // STEP 1: Check what resolution tables exist
    console.log('STEP 1: Checking available resolution/market tables...')
    console.log()

    const tableQuery = `
SELECT name, engine FROM system.tables
WHERE database = 'default'
AND (name LIKE '%market%' OR name LIKE '%resolution%' OR name LIKE '%condition%')
ORDER BY name
    `

    const tableResult = await clickhouse.query({ query: tableQuery })
    const tableData = JSON.parse(await tableResult.text())

    if (tableData.data && tableData.data.length > 0) {
      console.log('Found tables:')
      tableData.data.forEach((row: any, idx: number) => {
        console.log(`  ${idx + 1}. ${row.name} (${row.engine})`)
      })
    } else {
      console.log('No market/resolution/condition tables found')
    }
    console.log()

    // STEP 2: Sample trades with condition_id to find mapping
    console.log('STEP 2: Finding sample trades WITH condition_id...')
    console.log()

    const sampleWithId = `
SELECT
  DISTINCT market_id,
  condition_id,
  COUNT(*) as cnt
FROM trades_raw
WHERE condition_id != ''
GROUP BY market_id, condition_id
LIMIT 100
    `

    const sampleResult = await clickhouse.query({ query: sampleWithId })
    const sampleData = JSON.parse(await sampleResult.text())

    console.log(`Sample market_id → condition_id mappings (first 10):`)
    if (sampleData.data && sampleData.data.length > 0) {
      sampleData.data.slice(0, 10).forEach((row: any, idx: number) => {
        const cid = row.condition_id.substring(0, 16) + '...'
        console.log(`  ${idx + 1}. market: ${row.market_id} → condition: ${cid} (${row.cnt} trades)`)
      })

      console.log()
      console.log(`Total distinct market_id/condition_id pairs: ${sampleData.data.length}`)
    } else {
      console.log('No trades found with condition_id!')
    }
    console.log()

    // STEP 3: Check if we can use this to build a mapping table
    console.log('STEP 3: Building reverse mapping from existing complete trades...')
    console.log()

    const mappingCheck = `
SELECT
  COUNT(DISTINCT market_id) as distinct_markets,
  COUNT(DISTINCT condition_id) as distinct_conditions,
  COUNT(*) as total_rows_with_id
FROM trades_raw
WHERE condition_id != ''
    `

    const mappingResult = await clickhouse.query({ query: mappingCheck })
    const mappingData = JSON.parse(await mappingResult.text()).data[0]

    console.log(`Trades WITH condition_id:`)
    console.log(`  Distinct markets: ${mappingData.distinct_markets}`)
    console.log(`  Distinct conditions: ${mappingData.distinct_conditions}`)
    console.log(`  Total rows: ${mappingData.total_rows_with_id}`)
    console.log()

    // STEP 4: Check market_resolutions_final structure again
    console.log('STEP 4: Checking market_resolutions_final structure...')
    console.log()

    const resCheck = `
SELECT
  COUNT(*) as total_rows,
  COUNT(DISTINCT condition_id_norm) as distinct_conditions,
  COUNT(DISTINCT winning_outcome) as distinct_outcomes
FROM market_resolutions_final
    `

    const resResult = await clickhouse.query({ query: resCheck })
    const resData = JSON.parse(await resResult.text()).data[0]

    console.log(`market_resolutions_final:`)
    console.log(`  Total rows: ${resData.total_rows}`)
    console.log(`  Distinct condition_id_norm: ${resData.distinct_conditions}`)
    console.log(`  Distinct outcomes: ${resData.distinct_outcomes}`)
    console.log()

    // STEP 5: Test JOIN strategy
    console.log('STEP 5: Testing JOIN strategy...')
    console.log()

    const joinTest = `
SELECT
  COUNT(DISTINCT t.market_id) as markets_with_both,
  COUNT(DISTINCT t.condition_id) as conditions_found,
  COUNT(*) as total_rows_matching
FROM trades_raw t
INNER JOIN market_resolutions_final r
  ON lower(replaceAll(t.condition_id, '0x', '')) = r.condition_id_norm
WHERE t.condition_id != ''
LIMIT 1000000
    `

    try {
      const joinResult = await clickhouse.query({ query: joinTest })
      const joinData = JSON.parse(await joinResult.text()).data[0]

      console.log('✓ JOIN via condition_id works!')
      console.log(`  Markets matched: ${joinData.markets_with_both}`)
      console.log(`  Conditions matched: ${joinData.conditions_found}`)
      console.log(`  Total rows matched (sample): ${joinData.total_rows_matching}`)
    } catch (e: any) {
      console.log(`✗ JOIN via condition_id failed: ${e.message.substring(0, 100)}`)
    }
    console.log()

    // STEP 6: Build a condition_id_norm mapping for 78.7M missing trades
    console.log('STEP 6: Strategy for enriching 78.7M missing trades...')
    console.log()

    const missingCount = `
SELECT COUNT(*) as cnt FROM trades_raw WHERE condition_id = ''
    `

    const missingResult = await clickhouse.query({ query: missingCount })
    const missingData = JSON.parse(await missingResult.text()).data[0]

    console.log(`Trades WITHOUT condition_id: ${missingData.cnt}`)
    console.log()
    console.log('⚠️  PROBLEM: market_resolutions_final keyed on condition_id_norm')
    console.log('    Cannot directly join 78.7M trades (lacking condition_id) to it')
    console.log()
    console.log('POSSIBLE SOLUTIONS:')
    console.log('1. Build market_id → condition_id_norm mapping from trades WITH condition_id')
    console.log('   - Sample from 82.1M complete trades')
    console.log('   - Take most-common condition_id for each market_id')
    console.log('   - Use this to enrich the 78.7M missing')
    console.log()
    console.log('2. Check if there is a markets or market_metadata table with condition_id')
    console.log('   - Would allow direct market_id lookup')
    console.log()
    console.log('3. Reverse lookup via market_id relationships in trades_raw')
    console.log('   - For each missing trade, find same market_id with condition_id')
    console.log('   - Copy condition_id to missing trade')
    console.log()

  } catch (e: any) {
    console.error('Error:', e.message.substring(0, 200))
  }
}

diagnose()
