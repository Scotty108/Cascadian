#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { createClient } from '@clickhouse/client'

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || '',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
})

async function main() {
  console.log('='.repeat(80))
  console.log('DEFINITIVE ANSWER: ROOT CAUSE OF 11.88% RESOLUTION RATE')
  console.log('='.repeat(80))
  
  // Full overlap calculation
  const fullOverlapResult = await client.query({
    query: `
      WITH traded AS (
        SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as cid_norm
        FROM fact_trades_clean
      ),
      markets AS (
        SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid_norm
        FROM api_markets_staging
        WHERE condition_id IS NOT NULL AND condition_id != ''
      )
      SELECT 
        (SELECT uniq(cid_norm) FROM traded) as total_traded_cids,
        (SELECT uniq(cid_norm) FROM markets) as total_market_cids,
        (SELECT count() FROM traded t INNER JOIN markets m ON t.cid_norm = m.cid_norm) as overlap_count
    `,
    format: 'JSONEachRow'
  })
  const overlap = (await fullOverlapResult.json<any>())[0]
  
  const tradedCount = Number(overlap.total_traded_cids)
  const marketCount = Number(overlap.total_market_cids)
  const overlapCount = Number(overlap.overlap_count)
  const overlapPct = (overlapCount / tradedCount * 100).toFixed(2)
  
  console.log(`\n📊 Complete Analysis:`)
  console.log(`   Total unique traded condition_ids: ${tradedCount.toLocaleString()}`)
  console.log(`   Total unique markets in api_markets_staging: ${marketCount.toLocaleString()}`)
  console.log(`   Traded cids that exist in api_markets: ${overlapCount.toLocaleString()} (${overlapPct}%)`)
  console.log(`   Missing from api_markets: ${(tradedCount - overlapCount).toLocaleString()} (${(100 - Number(overlapPct)).toFixed(2)}%)`)
  
  // Now check how many of the matched ones are CLOSED
  const closedResult = await client.query({
    query: `
      WITH traded AS (
        SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as cid_norm
        FROM fact_trades_clean
      )
      SELECT 
        count() as total_matched,
        countIf(m.closed = true) as closed_count,
        countIf(m.closed = false) as open_count
      FROM traded t
      INNER JOIN api_markets_staging m
        ON t.cid_norm = lower(replaceAll(m.condition_id, '0x', ''))
    `,
    format: 'JSONEachRow'
  })
  const closed = (await closedResult.json<any>())[0]
  
  const totalMatched = Number(closed.total_matched)
  const closedCount = Number(closed.closed_count)
  const openCount = Number(closed.open_count)
  const closedPct = (closedCount / totalMatched * 100).toFixed(2)
  
  console.log(`\n🎯 Of the ${overlapCount.toLocaleString()} traded markets in api_markets:`)
  console.log(`   Closed (resolved): ${closedCount.toLocaleString()} (${closedPct}%)`)
  console.log(`   Still open: ${openCount.toLocaleString()} (${(100 - Number(closedPct)).toFixed(2)}%)`)
  
  // Calculate what percentage of ALL trades can be resolved
  const maxResolvable = closedCount
  const maxResolvablePct = (maxResolvable / tradedCount * 100).toFixed(2)
  
  console.log(`\n🔬 FINAL ANSWER:`)
  console.log(`   Maximum resolvable: ${maxResolvable.toLocaleString()} / ${tradedCount.toLocaleString()} condition_ids (${maxResolvablePct}%)`)
  console.log(`   Currently resolving: 11.88% (according to user)`)
  console.log(`   Gap: ${(Number(maxResolvablePct) - 11.88).toFixed(2)}% are resolvable but NOT being resolved`)
  
  console.log(`\n🚨 ROOT CAUSE:`)
  if (Number(maxResolvablePct) < 20) {
    console.log(`   A) MISSING DATA: Only ${maxResolvablePct}% of traded markets exist in api_markets_staging`)
    console.log(`      Need to backfill missing markets from Polymarket API`)
  } else if (Number(maxResolvablePct) > 50 && Number(maxResolvablePct) - 11.88 > 10) {
    console.log(`   B) BAD JOINS: ${maxResolvablePct}% SHOULD be resolvable, but only 11.88% are`)
    console.log(`      Fix the join logic between trades and resolutions`)
  } else {
    console.log(`   C) MIXED: Some missing data + some join issues`)
  }
  
  console.log('\n' + '='.repeat(80))
  
  await client.close()
}

main().catch(console.error)
