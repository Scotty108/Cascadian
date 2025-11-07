#!/usr/bin/env tsx
/**
 * Comprehensive P&L System Diagnostic
 *
 * Purpose: Verify claims that P&L tables are empty and investigate actual data availability
 * Wallet: niggemon (0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0)
 *
 * Time estimate: 2-3 minutes
 */

import { getClickHouseClient } from '../lib/clickhouse/client'

const NIGGEMON_WALLET = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'

interface QueryResult {
  query: string
  result: any
  interpretation: string
  implication: string
}

async function runDiagnostic() {
  const client = getClickHouseClient()
  const results: QueryResult[] = []

  console.log('=' .repeat(80))
  console.log('CASCADIAN P&L SYSTEM DIAGNOSTIC')
  console.log('=' .repeat(80))
  console.log(`Target Wallet: ${NIGGEMON_WALLET}`)
  console.log(`Timestamp: ${new Date().toISOString()}`)
  console.log('=' .repeat(80))
  console.log()

  // Test 1: Check P&L table existence and row counts
  console.log('🔍 TEST 1: P&L Table Existence & Row Counts')
  console.log('-' .repeat(80))

  const pnlTables = [
    'wallet_pnl_summary_final',
    'wallet_realized_pnl_v2',
    'realized_pnl_by_market_v2',
    'wallet_pnl_summary_v2',
    'realized_pnl_by_market_final',
    'wallet_pnl_summary',
    'realized_pnl_by_market'
  ]

  for (const table of pnlTables) {
    try {
      const query = `SELECT COUNT(*) as count FROM ${table}`
      const result = await client.query({
        query,
        format: 'JSONEachRow'
      })
      const data = await result.json<{ count: string }>()
      const count = parseInt(data[0].count)

      console.log(`✓ ${table}: ${count.toLocaleString()} rows`)

      results.push({
        query,
        result: count,
        interpretation: count === 0 ? 'Table is EMPTY' : `Table has ${count.toLocaleString()} rows`,
        implication: count === 0 ? 'No pre-calculated P&L data exists' : 'P&L data is available'
      })
    } catch (error: any) {
      console.log(`✗ ${table}: TABLE DOES NOT EXIST`)
      results.push({
        query: `SELECT COUNT(*) FROM ${table}`,
        result: 'TABLE NOT FOUND',
        interpretation: 'Table does not exist in database',
        implication: 'Cannot use this table for P&L calculation'
      })
    }
  }

  console.log()

  // Test 2: Check trades_raw for niggemon
  console.log('🔍 TEST 2: trades_raw Data for niggemon')
  console.log('-' .repeat(80))

  const tradesQuery = `
    SELECT
      COUNT(*) as trade_count,
      MIN(timestamp) as first_trade,
      MAX(timestamp) as last_trade,
      SUM(shares) as total_shares,
      COUNT(DISTINCT market_id) as markets_traded
    FROM trades_raw
    WHERE lower(wallet_address) = lower('${NIGGEMON_WALLET}')
  `

  try {
    const result = await client.query({
      query: tradesQuery,
      format: 'JSONEachRow'
    })
    const data = await result.json<any>()

    console.log(`Trade Count: ${data[0].trade_count}`)
    console.log(`First Trade: ${data[0].first_trade}`)
    console.log(`Last Trade: ${data[0].last_trade}`)
    console.log(`Total Shares: ${data[0].total_shares}`)
    console.log(`Markets Traded: ${data[0].markets_traded}`)

    results.push({
      query: tradesQuery,
      result: data[0],
      interpretation: `Niggemon has ${data[0].trade_count} trades across ${data[0].markets_traded} markets`,
      implication: 'Raw trade data exists and can be used for P&L calculation'
    })
  } catch (error: any) {
    console.log(`✗ Error: ${error.message}`)
    results.push({
      query: tradesQuery,
      result: 'ERROR',
      interpretation: error.message,
      implication: 'Cannot access trades_raw data'
    })
  }

  console.log()

  // Test 3: Check if realized_pnl_usd field exists in trades_raw
  console.log('🔍 TEST 3: realized_pnl_usd Field in trades_raw')
  console.log('-' .repeat(80))

  const pnlFieldQuery = `
    SELECT
      SUM(realized_pnl_usd) as total_pnl,
      COUNT(DISTINCT market_id) as markets_with_pnl,
      MIN(realized_pnl_usd) as min_pnl,
      MAX(realized_pnl_usd) as max_pnl,
      COUNT(*) as rows_with_pnl
    FROM trades_raw
    WHERE lower(wallet_address) = lower('${NIGGEMON_WALLET}')
      AND realized_pnl_usd IS NOT NULL
      AND realized_pnl_usd != 0
  `

  try {
    const result = await client.query({
      query: pnlFieldQuery,
      format: 'JSONEachRow'
    })
    const data = await result.json<any>()

    console.log(`Total P&L: $${data[0].total_pnl}`)
    console.log(`Markets with P&L: ${data[0].markets_with_pnl}`)
    console.log(`Min P&L: $${data[0].min_pnl}`)
    console.log(`Max P&L: $${data[0].max_pnl}`)
    console.log(`Rows with P&L: ${data[0].rows_with_pnl}`)

    results.push({
      query: pnlFieldQuery,
      result: data[0],
      interpretation: data[0].rows_with_pnl > 0
        ? `Found ${data[0].rows_with_pnl} trades with realized P&L totaling $${data[0].total_pnl}`
        : 'No realized P&L data in trades_raw',
      implication: data[0].rows_with_pnl > 0
        ? 'P&L data already calculated in trades_raw'
        : 'Need to calculate P&L from scratch'
    })
  } catch (error: any) {
    console.log(`✗ Error: ${error.message}`)
    results.push({
      query: pnlFieldQuery,
      result: 'ERROR',
      interpretation: error.message,
      implication: 'realized_pnl_usd field may not exist'
    })
  }

  console.log()

  // Test 4: Check trades_raw schema
  console.log('🔍 TEST 4: trades_raw Schema')
  console.log('-' .repeat(80))

  const schemaQuery = `
    SELECT name, type
    FROM system.columns
    WHERE database = currentDatabase()
      AND table = 'trades_raw'
    ORDER BY position
  `

  try {
    const result = await client.query({
      query: schemaQuery,
      format: 'JSONEachRow'
    })
    const data = await result.json<any>()

    console.log('Columns:')
    data.forEach((col: any) => {
      console.log(`  - ${col.name}: ${col.type}`)
    })

    const hasPnlField = data.some((col: any) => col.name === 'realized_pnl_usd')

    results.push({
      query: schemaQuery,
      result: data,
      interpretation: `trades_raw has ${data.length} columns. P&L field present: ${hasPnlField}`,
      implication: hasPnlField
        ? 'Can use realized_pnl_usd for calculation'
        : 'Must calculate P&L from scratch using payout vectors'
    })
  } catch (error: any) {
    console.log(`✗ Error: ${error.message}`)
  }

  console.log()

  // Test 5: Check outcome_positions_v2
  console.log('🔍 TEST 5: outcome_positions_v2 Data')
  console.log('-' .repeat(80))

  const outcomeQuery = `
    SELECT
      COUNT(*) as total_rows,
      COUNT(DISTINCT wallet) as wallets,
      COUNT(DISTINCT condition_id_norm) as conditions,
      SUM(net_shares) as total_net_shares
    FROM outcome_positions_v2
    WHERE wallet = '${NIGGEMON_WALLET}'
  `

  try {
    const result = await client.query({
      query: outcomeQuery,
      format: 'JSONEachRow'
    })
    const data = await result.json<any>()

    console.log(`Total Rows: ${data[0].total_rows}`)
    console.log(`Conditions: ${data[0].conditions}`)
    console.log(`Total Net Shares: ${data[0].total_net_shares}`)

    results.push({
      query: outcomeQuery,
      result: data[0],
      interpretation: `Found ${data[0].total_rows} outcome positions across ${data[0].conditions} conditions`,
      implication: data[0].total_rows > 0
        ? 'Can use outcome positions for unrealized P&L'
        : 'No outcome position data available'
    })
  } catch (error: any) {
    console.log(`✗ Table does not exist: ${error.message}`)
    results.push({
      query: outcomeQuery,
      result: 'TABLE NOT FOUND',
      interpretation: 'outcome_positions_v2 does not exist',
      implication: 'Cannot use this table for unrealized P&L'
    })
  }

  console.log()

  // Test 6: Check trade_cashflows_v3
  console.log('🔍 TEST 6: trade_cashflows_v3 Data')
  console.log('-' .repeat(80))

  const cashflowQuery = `
    SELECT
      COUNT(*) as total_rows,
      SUM(cashflow_usdc) as total_cashflows,
      MIN(cashflow_usdc) as min_cashflow,
      MAX(cashflow_usdc) as max_cashflow
    FROM trade_cashflows_v3
    WHERE wallet = '${NIGGEMON_WALLET}'
  `

  try {
    const result = await client.query({
      query: cashflowQuery,
      format: 'JSONEachRow'
    })
    const data = await result.json<any>()

    console.log(`Total Rows: ${data[0].total_rows}`)
    console.log(`Total Cashflows: $${data[0].total_cashflows}`)
    console.log(`Min Cashflow: $${data[0].min_cashflow}`)
    console.log(`Max Cashflow: $${data[0].max_cashflow}`)

    results.push({
      query: cashflowQuery,
      result: data[0],
      interpretation: `Found ${data[0].total_rows} cashflow entries totaling $${data[0].total_cashflows}`,
      implication: data[0].total_rows > 0
        ? 'Can use cashflows for P&L calculation'
        : 'No cashflow data available'
    })
  } catch (error: any) {
    console.log(`✗ Table does not exist: ${error.message}`)
    results.push({
      query: cashflowQuery,
      result: 'TABLE NOT FOUND',
      interpretation: 'trade_cashflows_v3 does not exist',
      implication: 'Cannot use this table for P&L'
    })
  }

  console.log()

  // Test 7: Check winning_index
  console.log('🔍 TEST 7: winning_index Coverage')
  console.log('-' .repeat(80))

  const winningQuery = `
    SELECT
      COUNT(*) as total_winners,
      COUNT(DISTINCT condition_id_norm) as resolved_conditions
    FROM winning_index
    WHERE win_idx IS NOT NULL
  `

  try {
    const result = await client.query({
      query: winningQuery,
      format: 'JSONEachRow'
    })
    const data = await result.json<any>()

    console.log(`Total Winners: ${data[0].total_winners}`)
    console.log(`Resolved Conditions: ${data[0].resolved_conditions}`)

    results.push({
      query: winningQuery,
      result: data[0],
      interpretation: `${data[0].resolved_conditions} conditions have been resolved`,
      implication: 'Can calculate realized P&L for resolved markets'
    })
  } catch (error: any) {
    console.log(`✗ Table does not exist: ${error.message}`)
    results.push({
      query: winningQuery,
      result: 'TABLE NOT FOUND',
      interpretation: 'winning_index does not exist',
      implication: 'Cannot determine which markets are resolved'
    })
  }

  console.log()

  // Test 8: Sample actual trades
  console.log('🔍 TEST 8: Sample Trades from trades_raw')
  console.log('-' .repeat(80))

  const sampleQuery = `
    SELECT
      timestamp,
      market_id,
      side,
      outcome_index,
      shares,
      entry_price,
      realized_pnl_usd
    FROM trades_raw
    WHERE lower(wallet_address) = lower('${NIGGEMON_WALLET}')
    ORDER BY timestamp DESC
    LIMIT 10
  `

  try {
    const result = await client.query({
      query: sampleQuery,
      format: 'JSONEachRow'
    })
    const data = await result.json<any>()

    console.log(`Found ${data.length} trades (showing first 10):`)
    data.forEach((trade: any, i: number) => {
      console.log(`\nTrade ${i + 1}:`)
      console.log(`  Time: ${trade.timestamp}`)
      console.log(`  Market: ${trade.market_id.substring(0, 20)}...`)
      console.log(`  Side: ${trade.side}`)
      console.log(`  Outcome: ${trade.outcome_index}`)
      console.log(`  Shares: ${trade.shares}`)
      console.log(`  Entry Price: $${trade.entry_price}`)
      console.log(`  Realized P&L: $${trade.realized_pnl_usd || 'NULL'}`)
    })

    results.push({
      query: sampleQuery,
      result: data,
      interpretation: `Retrieved ${data.length} sample trades`,
      implication: 'Can analyze trade structure for P&L calculation'
    })
  } catch (error: any) {
    console.log(`✗ Error: ${error.message}`)
  }

  console.log()

  // Test 9: Check for pre-calculated totals
  console.log('🔍 TEST 9: Pre-calculated P&L Totals')
  console.log('-' .repeat(80))

  const preCalcTables = [
    'realized_pnl_by_market_v2',
    'wallet_pnl_summary_v2',
    'wallet_realized_pnl_v2'
  ]

  for (const table of preCalcTables) {
    try {
      const query = `
        SELECT
          wallet,
          SUM(realized_pnl_usd) as total_pnl
        FROM ${table}
        WHERE wallet = '${NIGGEMON_WALLET}'
        GROUP BY wallet
      `
      const result = await client.query({
        query,
        format: 'JSONEachRow'
      })
      const data = await result.json<any>()

      if (data.length > 0) {
        console.log(`✓ ${table}: Total P&L = $${data[0].total_pnl}`)
      } else {
        console.log(`✓ ${table}: No data for wallet`)
      }
    } catch (error: any) {
      console.log(`✗ ${table}: ${error.message.includes('doesn\'t exist') ? 'Table not found' : error.message}`)
    }
  }

  console.log()

  // Final Summary
  console.log('=' .repeat(80))
  console.log('FINAL SUMMARY')
  console.log('=' .repeat(80))
  console.log()

  // Analyze what we found
  const emptyTables = results.filter(r => r.result === 0 || r.result === 'TABLE NOT FOUND')
  const tablesWithData = results.filter(r => typeof r.result === 'number' && r.result > 0)

  console.log('📊 KEY FINDINGS:')
  console.log()
  console.log(`1. CLAIM VERIFICATION: P&L Tables Empty?`)
  console.log(`   - Tables checked: ${pnlTables.length}`)
  console.log(`   - Empty/Missing: ${emptyTables.length}`)
  console.log(`   - With data: ${tablesWithData.length}`)
  console.log()

  const tradesResult = results.find(r => r.query.includes('trades_raw') && r.query.includes('COUNT(*)'))
  if (tradesResult && typeof tradesResult.result === 'object' && tradesResult.result.trade_count) {
    console.log(`2. RAW DATA AVAILABILITY:`)
    console.log(`   - Niggemon has ${tradesResult.result.trade_count} trades`)
    console.log(`   - Across ${tradesResult.result.markets_traded} markets`)
    console.log(`   - Trading period: ${tradesResult.result.first_trade} to ${tradesResult.result.last_trade}`)
    console.log()
  }

  const pnlFieldResult = results.find(r => r.query.includes('realized_pnl_usd IS NOT NULL'))
  if (pnlFieldResult) {
    console.log(`3. EXISTING P&L CALCULATIONS:`)
    if (typeof pnlFieldResult.result === 'object' && pnlFieldResult.result.rows_with_pnl) {
      console.log(`   - ${pnlFieldResult.result.rows_with_pnl} trades have realized_pnl_usd`)
      console.log(`   - Total: $${pnlFieldResult.result.total_pnl}`)
    } else {
      console.log(`   - No pre-calculated P&L in trades_raw`)
    }
    console.log()
  }

  console.log(`4. DATA STRUCTURE ANALYSIS:`)
  console.log(`   - trades_raw: ${tradesResult ? '✓ EXISTS' : '✗ MISSING'}`)
  console.log(`   - outcome_positions_v2: ${results.find(r => r.query.includes('outcome_positions_v2'))?.result !== 'TABLE NOT FOUND' ? '✓ EXISTS' : '✗ MISSING'}`)
  console.log(`   - trade_cashflows_v3: ${results.find(r => r.query.includes('trade_cashflows_v3'))?.result !== 'TABLE NOT FOUND' ? '✓ EXISTS' : '✗ MISSING'}`)
  console.log(`   - winning_index: ${results.find(r => r.query.includes('winning_index'))?.result !== 'TABLE NOT FOUND' ? '✓ EXISTS' : '✗ MISSING'}`)
  console.log()

  console.log(`5. CAN WE BUILD P&L FROM FIRST PRINCIPLES?`)
  const hasRawTrades = tradesResult && tradesResult.result.trade_count > 0
  const hasWinningIndex = results.find(r => r.query.includes('winning_index'))?.result !== 'TABLE NOT FOUND'
  const hasOutcomePositions = results.find(r => r.query.includes('outcome_positions_v2'))?.result !== 'TABLE NOT FOUND'

  if (hasRawTrades && hasWinningIndex) {
    console.log(`   ✓ YES - We have all required data:`)
    console.log(`     • trades_raw contains trade history`)
    console.log(`     • winning_index contains market resolutions`)
    if (hasOutcomePositions) {
      console.log(`     • outcome_positions_v2 available for unrealized P&L`)
    }
    console.log(`   → Can calculate P&L using payout vector method`)
  } else {
    console.log(`   ✗ NO - Missing required data:`)
    if (!hasRawTrades) console.log(`     • trades_raw is empty or missing`)
    if (!hasWinningIndex) console.log(`     • winning_index is missing`)
  }
  console.log()

  console.log(`6. GAPS & MISSING PIECES:`)
  const gaps: string[] = []
  if (emptyTables.length > 0) {
    gaps.push(`${emptyTables.length} P&L tables are empty or missing`)
  }
  if (!hasWinningIndex) {
    gaps.push('No winning_index table for market resolutions')
  }
  if (!hasOutcomePositions) {
    gaps.push('No outcome_positions_v2 for unrealized P&L')
  }

  if (gaps.length === 0) {
    console.log(`   ✓ No critical gaps detected`)
  } else {
    gaps.forEach(gap => console.log(`   • ${gap}`))
  }
  console.log()

  console.log('=' .repeat(80))
  console.log('DIAGNOSTIC COMPLETE')
  console.log('=' .repeat(80))
}

// Run the diagnostic
runDiagnostic().catch(console.error)
