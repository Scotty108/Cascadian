import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function verify() {
  console.log('═'.repeat(70))
  console.log('CRITICAL: Verify CLOB Table Population')
  console.log('═'.repeat(70))
  console.log()

  try {
    // Check 1: Row count in clob_market_mapping
    console.log('Check 1: Total rows in clob_market_mapping')
    const countResult = await clickhouse.query({
      query: `SELECT COUNT(*) as total_rows, COUNT(DISTINCT market_id) as unique_markets FROM clob_market_mapping`
    })
    const countData = JSON.parse(await countResult.text()).data[0]
    console.log(`  Total rows: ${countData.total_rows.toLocaleString()}`)
    console.log(`  Unique markets: ${countData.unique_markets.toLocaleString()}`)
    console.log()

    // Check 2: Sample of data
    console.log('Check 2: Sample of actual data in clob_market_mapping')
    const sampleResult = await clickhouse.query({
      query: `SELECT market_id, condition_id, question FROM clob_market_mapping LIMIT 5`
    })
    const sampleData = JSON.parse(await sampleResult.text()).data
    if (sampleData.length === 0) {
      console.log('  WARNING: No data found in table!')
    } else {
      sampleData.forEach((row: any, i: number) => {
        console.log(`  Row ${i+1}:`)
        console.log(`    market_id: ${row.market_id}`)
        console.log(`    condition_id: ${row.condition_id}`)
        console.log(`    question: ${row.question?.substring(0, 40)}...`)
      })
    }
    console.log()

    // Check 3: Distribution of market_ids
    console.log('Check 3: Distribution stats')
    const distResult = await clickhouse.query({
      query: `SELECT
        COUNT(CASE WHEN market_id = '' OR market_id IS NULL THEN 1 END) as empty_market_ids,
        COUNT(CASE WHEN condition_id = '' OR condition_id IS NULL THEN 1 END) as empty_condition_ids
      FROM clob_market_mapping`
    })
    const distData = JSON.parse(await distResult.text()).data[0]
    console.log(`  Empty market_ids: ${distData.empty_market_ids}`)
    console.log(`  Empty condition_ids: ${distData.empty_condition_ids}`)
    console.log()

    // Check 4: Re-run the join test with actual data
    console.log('Check 4: Re-test join with actual data')
    const joinTestResult = await clickhouse.query({
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
    const joinData = JSON.parse(await joinTestResult.text()).data[0]
    console.log(`  Distinct trade markets (sample): ${joinData.distinct_trade_markets}`)
    console.log(`  Distinct CLOB markets in join: ${joinData.distinct_clob_markets}`)
    console.log(`  Successful matches: ${joinData.join_matches}`)
    const matchRate = joinData.distinct_trade_markets > 0
      ? (joinData.join_matches * 100.0 / joinData.distinct_trade_markets).toFixed(1)
      : '0'
    console.log(`  Match rate: ${matchRate}%`)
    console.log()

    console.log('═'.repeat(70))
    if (countData.total_rows === 0) {
      console.log('🚨 CRITICAL: CLOB table is EMPTY despite worker reporting insertions!')
      console.log('   This explains the join test showing only 1 market.')
      console.log('   Worker may have had silent INSERT failures.')
    } else if (countData.total_rows < 10000) {
      console.log('⚠️  CLOB table has minimal data (' + countData.total_rows + ' rows)')
      console.log('   Worker may still be running, or had issues.')
    } else {
      console.log('✓ CLOB table has reasonable data: ' + countData.total_rows + ' rows')
      console.log('   Proceeding with data verification and TheGraph worker...')
    }
    console.log('═'.repeat(70))

  } catch (e) {
    console.error('Error:', (e as any).message)
  }
}

verify()
