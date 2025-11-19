import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function explore() {
  try {
    console.log('EXPLORING MARKET-TO-CONDITION MAPPING')
    console.log('═'.repeat(70))
    console.log()

    // STEP 1: Check market_metadata schema
    console.log('STEP 1: Inspecting market_metadata table...')
    console.log()

    const metadataCheck = `
SELECT name FROM system.columns
WHERE table = 'market_metadata' AND database = 'default'
ORDER BY position
    `

    try {
      const metaResult = await clickhouse.query({ query: metadataCheck })
      const metaData = JSON.parse(await metaResult.text())

      if (metaData.data && metaData.data.length > 0) {
        console.log('market_metadata columns:')
        metaData.data.forEach((row: any, idx: number) => {
          console.log(`  ${idx + 1}. ${row.name}`)
        })
        console.log()

        // Sample a row
        console.log('Sample row from market_metadata:')
        const sampleMeta = `SELECT * FROM market_metadata LIMIT 1`
        const sampleResult = await clickhouse.query({ query: sampleMeta })
        const sampleData = JSON.parse(await sampleResult.text())

        if (sampleData.data && sampleData.data.length > 0) {
          const row = sampleData.data[0]
          Object.entries(row).forEach(([key, value]: [string, any]) => {
            const v = typeof value === 'string' && value.length > 60 ? value.substring(0, 60) + '...' : value
            console.log(`  ${key}: ${v}`)
          })
        }
      }
    } catch (e: any) {
      console.log(`✗ Error checking market_metadata: ${e.message.substring(0, 80)}`)
    }
    console.log()

    // STEP 2: Check if market_metadata has condition_id
    console.log('STEP 2: Checking if market_metadata links to condition_id...')
    console.log()

    try {
      const hasCondition = `
SELECT COUNT(*) as cnt FROM market_metadata
WHERE condition_id IS NOT NULL AND condition_id != ''
LIMIT 1000000
      `

      const hasCondResult = await clickhouse.query({ query: hasCondition })
      const hasCondData = JSON.parse(await hasCondResult.text()).data[0]

      console.log(`market_metadata rows with condition_id: ${hasCondData.cnt}`)

      if (parseInt(hasCondData.cnt) > 0) {
        console.log('✓ market_metadata HAS condition_id column!')
        console.log('  This can be used for enrichment!')
      } else {
        console.log('✗ market_metadata does NOT have condition_id values')
      }
    } catch (e: any) {
      console.log(`✗ Checking condition_id in market_metadata: ${e.message.substring(0, 80)}`)
    }
    console.log()

    // STEP 3: Test JOIN via market_metadata
    console.log('STEP 3: Testing JOIN via market_metadata...')
    console.log()

    try {
      const joinTest = `
SELECT
  COUNT(DISTINCT t.market_id) as markets_matched,
  COUNT(DISTINCT m.condition_id) as conditions_found,
  COUNT(*) as total_matched
FROM (SELECT * FROM trades_raw WHERE condition_id = '' LIMIT 1000000) t
LEFT JOIN market_metadata m ON t.market_id = m.market_id
WHERE m.condition_id IS NOT NULL AND m.condition_id != ''
      `

      const joinResult = await clickhouse.query({ query: joinTest })
      const joinData = JSON.parse(await joinResult.text()).data[0]

      console.log('Sample JOIN of 1M missing trades to market_metadata:')
      console.log(`  Markets matched: ${joinData.markets_matched}`)
      console.log(`  Conditions found: ${joinData.conditions_found}`)
      console.log(`  Total matched rows: ${joinData.total_matched}`)

      if (parseInt(joinData.total_matched) > 0) {
        const recovery = (parseInt(joinData.total_matched) / 1000000 * 100).toFixed(1)
        console.log(`  Recovery rate on sample: ${recovery}%`)
      }
    } catch (e: any) {
      console.log(`✗ JOIN test failed: ${e.message.substring(0, 100)}`)
    }
    console.log()

    // STEP 4: Check market_to_condition_dict
    console.log('STEP 4: Checking market_to_condition_dict...')
    console.log()

    try {
      const dictCheck = `SELECT COUNT(*) as cnt FROM market_to_condition_dict`
      const dictResult = await clickhouse.query({ query: dictCheck })
      const dictData = JSON.parse(await dictResult.text()).data[0]

      console.log(`market_to_condition_dict rows: ${dictData.cnt}`)

      // Try to sample it
      const dictSample = `SELECT * FROM market_to_condition_dict LIMIT 3`
      try {
        const sampleResult = await clickhouse.query({ query: dictSample })
        const sampleData = JSON.parse(await sampleResult.text())

        if (sampleData.data && sampleData.data.length > 0) {
          console.log('Sample rows:')
          sampleData.data.forEach((row: any, idx: number) => {
            console.log(`  ${idx + 1}. ${JSON.stringify(row).substring(0, 80)}...`)
          })
        }
      } catch (e: any) {
        console.log(`Could not sample: ${e.message.substring(0, 60)}`)
      }
    } catch (e: any) {
      console.log(`✗ Error checking dict: ${e.message.substring(0, 80)}`)
    }
    console.log()

    // STEP 5: Final recommendation
    console.log('═'.repeat(70))
    console.log('ENRICHMENT STRATEGY RECOMMENDATION:')
    console.log()
    console.log('If market_metadata.condition_id exists:')
    console.log('  ✓ Use LEFT JOIN trades_raw → market_metadata on market_id')
    console.log('  ✓ COALESCE(trades.condition_id, market_metadata.condition_id)')
    console.log()
    console.log('Otherwise:')
    console.log('  ✓ Build market_id → condition_id mapping from 82.1M complete trades')
    console.log('  ✓ Use most-common condition_id per market_id')
    console.log('  ✓ Apply COALESCE pattern')

  } catch (e: any) {
    console.error('Error:', e.message.substring(0, 200))
  }
}

explore()
