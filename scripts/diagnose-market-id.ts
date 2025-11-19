import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function diagnose() {
  console.log('═'.repeat(70))
  console.log('TRADES_RAW MARKET_ID DIAGNOSIS')
  console.log('═'.repeat(70))
  console.log()

  try {
    // Check 1: Sample market_id values
    console.log('Check 1: Sample market_id values from trades_raw')
    const sample = await clickhouse.query({
      query: `SELECT DISTINCT market_id FROM trades_raw LIMIT 10`
    })
    const sampleData = JSON.parse(await sample.text()).data
    console.log('Sample values:')
    sampleData.forEach((row: any) => console.log('  -', row.market_id))
    console.log()

    // Check 2: Count non-empty market_ids
    console.log('Check 2: Market_id completeness in trades_raw')
    const completeness = await clickhouse.query({
      query: `
SELECT
  COUNT(*) as total_rows,
  COUNT(CASE WHEN market_id IS NOT NULL AND market_id != '' THEN 1 END) as with_market_id,
  COUNT(CASE WHEN market_id IS NULL OR market_id = '' THEN 1 END) as missing_market_id,
  ROUND(COUNT(CASE WHEN market_id IS NOT NULL AND market_id != '' THEN 1 END) * 100.0 / COUNT(*), 2) as coverage_percent
FROM trades_raw
      `
    })
    const completeData = JSON.parse(await completeness.text()).data[0]
    console.log(`  Total rows: ${completeData.total_rows.toLocaleString()}`)
    console.log(`  With market_id: ${completeData.with_market_id.toLocaleString()}`)
    console.log(`  Missing market_id: ${completeData.missing_market_id.toLocaleString()}`)
    console.log(`  Coverage: ${completeData.coverage_percent}%`)
    console.log()

    // Check 3: Sample CLOB market_id format
    console.log('Check 3: Sample market_id values from CLOB mapping')
    const clobSample = await clickhouse.query({
      query: `SELECT DISTINCT market_id FROM clob_market_mapping LIMIT 10`
    })
    const clobData = JSON.parse(await clobSample.text()).data
    console.log('Sample CLOB market_ids:')
    clobData.forEach((row: any) => console.log('  -', row.market_id))
    console.log()

    // Check 4: Try a sample join
    console.log('Check 4: Test join compatibility (100K sample)')
    const joinTest = await clickhouse.query({
      query: `
SELECT
  COUNT(DISTINCT t.market_id) as distinct_trade_markets,
  COUNT(DISTINCT c.market_id) as distinct_clob_markets,
  COUNT(CASE WHEN c.market_id IS NOT NULL THEN 1 END) as join_matches
FROM (
  SELECT DISTINCT market_id FROM trades_raw
  WHERE market_id IS NOT NULL AND market_id != ''
  LIMIT 100000
) t
LEFT JOIN clob_market_mapping c ON t.market_id = c.market_id
      `
    })
    const joinData = JSON.parse(await joinTest.text()).data[0]
    console.log(`  Distinct trade markets (sample): ${joinData.distinct_trade_markets}`)
    console.log(`  Distinct CLOB markets available: ${joinData.distinct_clob_markets}`)
    console.log(`  Successful joins: ${joinData.join_matches}`)
    const matchRate = joinData.distinct_trade_markets > 0
      ? (joinData.join_matches * 100.0 / joinData.distinct_trade_markets).toFixed(1)
      : '0'
    console.log(`  Match rate: ${matchRate}%`)
    console.log()

    console.log('═'.repeat(70))
  } catch (e) {
    console.error('Error:', (e as any).message)
  }
}

diagnose()
