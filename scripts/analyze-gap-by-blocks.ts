#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { clickhouse } from './lib/clickhouse/client'

async function analyze() {
  console.log('\n' + '='.repeat(120))
  console.log('ANALYZING ERC1155 DATA GAP (BY BLOCK NUMBER)')
  console.log('='.repeat(120))
  
  // Get trades_raw block range
  const tradesResult = await clickhouse.query({
    query: `
      SELECT 
        MIN(timestamp) as earliest_trade_date,
        MAX(timestamp) as latest_trade_date,
        COUNT(*) as total_trades,
        COUNT(DISTINCT market_id) as unique_markets
      FROM trades_raw
    `,
    format: 'JSONEachRow'
  })
  
  const tradesData = await tradesResult.json()
  const trades = tradesData[0]
  
  console.log('\nTRADES_RAW Coverage:')
  console.log(`  Date range: ${trades.earliest_trade_date} to ${trades.latest_trade_date}`)
  console.log(`  Total trades: ${trades.total_trades.toLocaleString()}`)
  console.log(`  Unique markets: ${trades.unique_markets.toLocaleString()}`)
  
  // Get ERC1155 block range (more reliable than timestamp)
  const erc1155Result = await clickhouse.query({
    query: `
      SELECT 
        MIN(block_number) as earliest_block,
        MAX(block_number) as latest_block,
        COUNT(*) as total_erc1155,
        COUNT(DISTINCT tx_hash) as unique_txs
      FROM erc1155_transfers
    `,
    format: 'JSONEachRow'
  })
  
  const erc1155Data = await erc1155Result.json()
  const erc1155 = erc1155Data[0]
  
  console.log('\nERC1155_TRANSFERS Coverage:')
  console.log(`  Block range: ${erc1155.earliest_block.toLocaleString()} to ${erc1155.latest_block.toLocaleString()}`)
  console.log(`  Total transfers: ${erc1155.total_erc1155.toLocaleString()}`)
  console.log(`  Unique transactions: ${erc1155.unique_txs.toLocaleString()}`)
  
  // Dec 18, 2022 starts at block 37515000 on Polygon
  const targetStartBlock = 37515000
  const currentEarliestBlock = Number(erc1155.earliest_block)
  const currentLatestBlock = Number(erc1155.latest_block)
  
  const blocksBefore = currentEarliestBlock - targetStartBlock
  const blocksAfter = 0 // We have data up to present
  
  // Polygon: ~2 blocks/sec = 172,800 blocks/day
  const blocksPerDay = 172800
  const daysBefore = blocksBefore / blocksPerDay
  
  console.log('\n' + '='.repeat(120))
  console.log('MISSING DATA ANALYSIS')
  console.log('='.repeat(120))
  
  console.log(`\nStarting point (Dec 18, 2022): Block ${targetStartBlock.toLocaleString()}`)
  console.log(`Current ERC1155 earliest: Block ${currentEarliestBlock.toLocaleString()}`)
  console.log(`\nMissing blocks: ${blocksBefore.toLocaleString()} (${daysBefore.toFixed(1)} days / ${(daysBefore/30).toFixed(1)} months)`)
  
  console.log(`\n${'='.repeat(120)}`)
  console.log(`PHASE 2 FETCH SCOPE`)
  console.log(`${'='.repeat(120)}`)
  
  if (blocksBefore > 0) {
    console.log(`\n📍 MUST FETCH: Blocks ${targetStartBlock.toLocaleString()} to ${currentEarliestBlock.toLocaleString()}`)
    console.log(`   Duration: ${daysBefore.toFixed(1)} days (${(daysBefore/30).toFixed(1)} months)`)
    console.log(`   Polygon blocks at 2 blocks/sec`)
    
    // Estimate time
    const requestsNeeded = blocksBefore / 1000 // 1000 blocks per request
    const timeAtMaxRate = requestsNeeded / 100 // 100 req/sec
    const estimatedMinutes = timeAtMaxRate / 60
    
    console.log(`\n⏱️ Estimated time: ${estimatedMinutes.toFixed(0)} minutes (${(estimatedMinutes/60).toFixed(1)} hours)`)
    console.log(`   ~${requestsNeeded.toLocaleString()} API requests needed`)
  } else {
    console.log(`\n✅ ERC1155 data ALREADY COVERS Dec 18, 2022 onwards`)
    console.log(`   Earliest block: ${currentEarliestBlock.toLocaleString()} (is before target ${targetStartBlock.toLocaleString()})`)
    console.log(`   Latest block: ${currentLatestBlock.toLocaleString()} (current)`)
  }
  
  // Check coverage of 77.4M missing trades
  console.log(`\n${'='.repeat(120)}`)
  console.log(`COVERAGE OF 77.4M MISSING CONDITION_ID TRADES`)
  console.log(`${'='.repeat(120)}`)
  
  const coverageCheck = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as missing_cond_trades,
        SUM(CASE WHEN e.tx_hash IS NOT NULL THEN 1 ELSE 0 END) as matched_to_erc1155,
        ROUND(100.0 * SUM(CASE WHEN e.tx_hash IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 2) as coverage_pct
      FROM trades_raw t
      LEFT JOIN erc1155_transfers e ON t.transaction_hash = e.tx_hash
      WHERE t.condition_id = '' OR t.condition_id IS NULL
    `,
    format: 'JSONEachRow'
  })
  
  const coverageData = await coverageCheck.json()
  const coverage = coverageData[0]
  
  console.log(`\nTrades with MISSING condition_id: ${coverage.missing_cond_trades.toLocaleString()}`)
  console.log(`Matched to ERC1155 transfers: ${coverage.matched_to_erc1155.toLocaleString()}`)
  console.log(`Coverage: ${coverage.coverage_pct}%`)
  
  if (coverage.coverage_pct > 0) {
    console.log(`\n✅ Phase 2 will recover: ${coverage.matched_to_erc1155.toLocaleString()} missing condition_ids`)
  }
}

analyze().catch(e => console.error('Error:', (e as Error).message))
