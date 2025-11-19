#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { clickhouse } from './lib/clickhouse/client'

async function analyze() {
  console.log('\n' + '='.repeat(120))
  console.log('ANALYZING ACTUAL ERC1155 DATA GAP')
  console.log('='.repeat(120))
  
  // Get trades_raw date range
  const tradesResult = await clickhouse.query({
    query: `
      SELECT 
        MIN(timestamp) as earliest_trade,
        MAX(timestamp) as latest_trade,
        COUNT(*) as total_trades
      FROM trades_raw
    `,
    format: 'JSONEachRow'
  })
  
  const tradesData = await tradesResult.json()
  const trades = tradesData[0]
  
  console.log('\nTRADES_RAW Date Range:')
  console.log(`  Earliest trade: ${trades.earliest_trade}`)
  console.log(`  Latest trade: ${trades.latest_trade}`)
  console.log(`  Total trades: ${trades.total_trades.toLocaleString()}`)
  
  // Get ERC1155 date range
  const erc1155Result = await clickhouse.query({
    query: `
      SELECT 
        MIN(block_timestamp) as earliest_erc1155,
        MAX(block_timestamp) as latest_erc1155,
        COUNT(*) as total_erc1155
      FROM erc1155_transfers
    `,
    format: 'JSONEachRow'
  })
  
  const erc1155Data = await erc1155Result.json()
  const erc1155 = erc1155Data[0]
  
  console.log('\nERC1155_TRANSFERS Date Range:')
  console.log(`  Earliest transfer: ${erc1155.earliest_erc1155}`)
  console.log(`  Latest transfer: ${erc1155.latest_erc1155}`)
  console.log(`  Total transfers: ${erc1155.total_erc1155.toLocaleString()}`)
  
  // Calculate gaps
  const tradesEarliest = new Date(trades.earliest_trade)
  const erc1155Earliest = new Date(erc1155.earliest_erc1155)
  const erc1155Latest = new Date(erc1155.latest_erc1155)
  const tradesLatest = new Date(trades.latest_trade)
  
  const gapBefore = (erc1155Earliest.getTime() - tradesEarliest.getTime()) / (1000 * 60 * 60 * 24)
  const gapAfter = (tradesLatest.getTime() - erc1155Latest.getTime()) / (1000 * 60 * 60 * 24)
  
  console.log('\n' + '='.repeat(120))
  console.log('DATA GAP ANALYSIS')
  console.log('='.repeat(120))
  
  console.log(`\nGap BEFORE ERC1155 data starts:`)
  console.log(`  ${tradesEarliest.toISOString()} ← trades_raw earliest`)
  console.log(`  ${erc1155Earliest.toISOString()} ← ERC1155 earliest`)
  console.log(`  Gap: ${gapBefore.toFixed(1)} days (${(gapBefore/30).toFixed(1)} months)`)
  
  console.log(`\nGap AFTER ERC1155 data ends:`)
  console.log(`  ${erc1155Latest.toISOString()} ← ERC1155 latest`)
  console.log(`  ${tradesLatest.toISOString()} ← trades_raw latest`)
  console.log(`  Gap: ${gapAfter.toFixed(1)} days (${(gapAfter/30).toFixed(1)} months)`)
  
  console.log(`\nTotal coverage needed: ${(gapBefore + gapAfter).toFixed(1)} days`)
  
  console.log('\n' + '='.repeat(120))
  console.log('WHAT TO FETCH IN PHASE 2')
  console.log('='.repeat(120))
  
  if (gapBefore > 0) {
    console.log(`\n✅ Must fetch BEFORE current data:`)
    console.log(`   From: ${tradesEarliest.toISOString()}`)
    console.log(`   To: ${erc1155Earliest.toISOString()}`)
    console.log(`   Duration: ${gapBefore.toFixed(1)} days`)
  }
  
  if (gapAfter > 0) {
    console.log(`\n✅ Must fetch AFTER current data:`)
    console.log(`   From: ${erc1155Latest.toISOString()}`)
    console.log(`   To: ${tradesLatest.toISOString()}`)
    console.log(`   Duration: ${gapAfter.toFixed(1)} days`)
  }
  
  const totalDays = gapBefore + gapAfter
  const estimatedTime = totalDays > 200 ? '4-6 hours' : totalDays > 100 ? '3-4 hours' : '2-3 hours'
  
  console.log(`\nEstimated Phase 2 fetch time: ${estimatedTime}`)
  console.log(`Blocks to fetch: ~${(totalDays * 28800).toLocaleString()}`)
}

analyze().catch(e => console.error('Error:', (e as Error).message))
