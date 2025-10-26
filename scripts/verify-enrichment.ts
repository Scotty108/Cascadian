/**
 * Verify Trade Enrichment Quality
 *
 * Comprehensive verification of trade enrichment to ensure:
 * - All enriched trades have valid values
 * - P&L calculations are correct
 * - No data corruption
 * - Statistics make sense
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

// ============================================================================
// Verification Checks
// ============================================================================

interface VerificationResult {
  check: string
  passed: boolean
  details: string
  severity: 'error' | 'warning' | 'info'
}

const results: VerificationResult[] = []

function addResult(check: string, passed: boolean, details: string, severity: 'error' | 'warning' | 'info' = 'info') {
  results.push({ check, passed, details, severity })
}

// ============================================================================
// Check 1: Basic Statistics
// ============================================================================

async function checkBasicStats(): Promise<void> {
  console.log('📊 Check 1: Basic Statistics...')

  const result = await clickhouse.query({
    query: `
      SELECT
        count() as total_trades,
        countIf(outcome IS NOT NULL) as enriched_trades,
        countIf(outcome IS NULL) as unenriched_trades,
        countIf(outcome = 1) as winning_trades,
        countIf(outcome = 0) as losing_trades
      FROM trades_raw
    `,
    format: 'JSONEachRow',
  })

  const data = await result.json<{
    total_trades: string
    enriched_trades: string
    unenriched_trades: string
    winning_trades: string
    losing_trades: string
  }>()

  const stats = Array.isArray(data) ? data[0] : data

  const total = parseInt(stats.total_trades)
  const enriched = parseInt(stats.enriched_trades)
  const unenriched = parseInt(stats.unenriched_trades)
  const wins = parseInt(stats.winning_trades)
  const losses = parseInt(stats.losing_trades)

  const enrichmentRate = total > 0 ? (enriched / total) * 100 : 0
  const winRate = enriched > 0 ? (wins / enriched) * 100 : 0

  console.log(`   Total trades: ${total.toLocaleString()}`)
  console.log(`   Enriched: ${enriched.toLocaleString()} (${enrichmentRate.toFixed(1)}%)`)
  console.log(`   Unenriched: ${unenriched.toLocaleString()}`)
  console.log(`   Wins: ${wins.toLocaleString()}`)
  console.log(`   Losses: ${losses.toLocaleString()}`)
  console.log(`   Win rate: ${winRate.toFixed(1)}%\n`)

  // Validation
  if (total === 0) {
    addResult('Basic Stats', false, 'No trades found in database', 'error')
  } else if (enrichmentRate < 50) {
    addResult('Basic Stats', false, `Low enrichment rate: ${enrichmentRate.toFixed(1)}%`, 'warning')
  } else {
    addResult('Basic Stats', true, `${enrichmentRate.toFixed(1)}% enriched, ${winRate.toFixed(1)}% win rate`, 'info')
  }

  // Win rate sanity check (should be between 20% and 80% for most traders)
  if (winRate > 0 && (winRate < 20 || winRate > 80)) {
    addResult('Win Rate', false, `Unusual win rate: ${winRate.toFixed(1)}% (expected 20-80%)`, 'warning')
  } else if (winRate > 0) {
    addResult('Win Rate', true, `Win rate ${winRate.toFixed(1)}% is reasonable`, 'info')
  }
}

// ============================================================================
// Check 2: Data Integrity
// ============================================================================

async function checkDataIntegrity(): Promise<void> {
  console.log('🔍 Check 2: Data Integrity...')

  // Check for invalid outcomes (should only be 0, 1, or NULL)
  const outcomeCheck = await clickhouse.query({
    query: `
      SELECT count() as invalid_outcomes
      FROM trades_raw
      WHERE outcome IS NOT NULL AND outcome NOT IN (0, 1)
    `,
    format: 'JSONEachRow',
  })

  const outcomeData = await outcomeCheck.json<{ invalid_outcomes: string }>()
  const invalidOutcomes = parseInt((Array.isArray(outcomeData) ? outcomeData[0] : outcomeData).invalid_outcomes)

  console.log(`   Invalid outcomes: ${invalidOutcomes}`)

  if (invalidOutcomes > 0) {
    addResult('Outcome Values', false, `Found ${invalidOutcomes} trades with invalid outcome values`, 'error')
  } else {
    addResult('Outcome Values', true, 'All outcomes are valid (0, 1, or NULL)', 'info')
  }

  // Check for enriched trades with zero P&L (suspicious)
  const zeroPnlCheck = await clickhouse.query({
    query: `
      SELECT count() as zero_pnl_trades
      FROM trades_raw
      WHERE outcome IS NOT NULL AND pnl_net = 0
    `,
    format: 'JSONEachRow',
  })

  const zeroPnlData = await zeroPnlCheck.json<{ zero_pnl_trades: string }>()
  const zeroPnl = parseInt((Array.isArray(zeroPnlData) ? zeroPnlData[0] : zeroPnlData).zero_pnl_trades)

  console.log(`   Zero P&L trades: ${zeroPnl}`)

  if (zeroPnl > 0) {
    addResult('P&L Values', false, `Found ${zeroPnl} enriched trades with zero P&L (unusual)`, 'warning')
  } else {
    addResult('P&L Values', true, 'All enriched trades have non-zero P&L', 'info')
  }

  // Check for negative hours held
  const negativeHoursCheck = await clickhouse.query({
    query: `
      SELECT count() as negative_hours
      FROM trades_raw
      WHERE outcome IS NOT NULL AND hours_held < 0
    `,
    format: 'JSONEachRow',
  })

  const negativeHoursData = await negativeHoursCheck.json<{ negative_hours: string }>()
  const negativeHours = parseInt((Array.isArray(negativeHoursData) ? negativeHoursData[0] : negativeHoursData).negative_hours)

  console.log(`   Negative hours held: ${negativeHours}\n`)

  if (negativeHours > 0) {
    addResult('Hours Held', false, `Found ${negativeHours} trades with negative hours held`, 'error')
  } else {
    addResult('Hours Held', true, 'All trades have non-negative hours held', 'info')
  }
}

// ============================================================================
// Check 3: P&L Calculations
// ============================================================================

async function checkPnLCalculations(): Promise<void> {
  console.log('💰 Check 3: P&L Calculations...')

  const result = await clickhouse.query({
    query: `
      SELECT
        avg(pnl_gross) as avg_pnl_gross,
        avg(pnl_net) as avg_pnl_net,
        avg(fee_usd) as avg_fee,
        sum(pnl_gross) as total_pnl_gross,
        sum(pnl_net) as total_pnl_net,
        sum(fee_usd) as total_fees,
        avgIf(pnl_net, outcome = 1) as avg_win,
        avgIf(pnl_net, outcome = 0) as avg_loss
      FROM trades_raw
      WHERE outcome IS NOT NULL
    `,
    format: 'JSONEachRow',
  })

  const data = await result.json<{
    avg_pnl_gross: string
    avg_pnl_net: string
    avg_fee: string
    total_pnl_gross: string
    total_pnl_net: string
    total_fees: string
    avg_win: string
    avg_loss: string
  }>()

  const stats = Array.isArray(data) ? data[0] : data

  const avgPnlGross = parseFloat(stats.avg_pnl_gross)
  const avgPnlNet = parseFloat(stats.avg_pnl_net)
  const avgFee = parseFloat(stats.avg_fee)
  const totalPnlGross = parseFloat(stats.total_pnl_gross)
  const totalPnlNet = parseFloat(stats.total_pnl_net)
  const totalFees = parseFloat(stats.total_fees)
  const avgWin = parseFloat(stats.avg_win)
  const avgLoss = parseFloat(stats.avg_loss)

  console.log(`   Average P&L (gross): $${avgPnlGross.toFixed(2)}`)
  console.log(`   Average P&L (net): $${avgPnlNet.toFixed(2)}`)
  console.log(`   Average fee: $${avgFee.toFixed(2)}`)
  console.log(`   Total P&L (gross): $${totalPnlGross.toLocaleString(undefined, { minimumFractionDigits: 2 })}`)
  console.log(`   Total P&L (net): $${totalPnlNet.toLocaleString(undefined, { minimumFractionDigits: 2 })}`)
  console.log(`   Total fees: $${totalFees.toLocaleString(undefined, { minimumFractionDigits: 2 })}`)
  console.log(`   Average win: $${avgWin.toFixed(2)}`)
  console.log(`   Average loss: $${avgLoss.toFixed(2)}\n`)

  // Validation: net P&L should be less than gross P&L (fees reduce profit)
  const netLessThanGross = totalPnlNet <= totalPnlGross

  if (!netLessThanGross) {
    addResult('P&L Calculation', false, 'Net P&L is greater than gross P&L (fees should reduce profit)', 'error')
  } else {
    addResult('P&L Calculation', true, 'Net P&L correctly accounts for fees', 'info')
  }

  // Validation: fees should be positive
  if (totalFees < 0) {
    addResult('Fees', false, 'Total fees are negative', 'error')
  } else if (totalFees === 0) {
    addResult('Fees', false, 'No fees recorded (should be ~2% of volume)', 'warning')
  } else {
    addResult('Fees', true, `Total fees: $${totalFees.toLocaleString()}`, 'info')
  }

  // Validation: average loss should be negative
  if (avgLoss >= 0) {
    addResult('Loss Calculation', false, 'Average loss is non-negative', 'error')
  } else {
    addResult('Loss Calculation', true, 'Average loss is negative (correct)', 'info')
  }

  // Validation: average win should be positive
  if (avgWin <= 0) {
    addResult('Win Calculation', false, 'Average win is non-positive', 'error')
  } else {
    addResult('Win Calculation', true, 'Average win is positive (correct)', 'info')
  }
}

// ============================================================================
// Check 4: Return Percentages
// ============================================================================

async function checkReturnPercentages(): Promise<void> {
  console.log('📈 Check 4: Return Percentages...')

  const result = await clickhouse.query({
    query: `
      SELECT
        avg(return_pct) as avg_return,
        min(return_pct) as min_return,
        max(return_pct) as max_return,
        avgIf(return_pct, outcome = 1) as avg_win_return,
        avgIf(return_pct, outcome = 0) as avg_loss_return,
        count() as total,
        countIf(return_pct > 100) as extreme_wins,
        countIf(return_pct < -100) as extreme_losses
      FROM trades_raw
      WHERE outcome IS NOT NULL
    `,
    format: 'JSONEachRow',
  })

  const data = await result.json<{
    avg_return: string
    min_return: string
    max_return: string
    avg_win_return: string
    avg_loss_return: string
    total: string
    extreme_wins: string
    extreme_losses: string
  }>()

  const stats = Array.isArray(data) ? data[0] : data

  const avgReturn = parseFloat(stats.avg_return)
  const minReturn = parseFloat(stats.min_return)
  const maxReturn = parseFloat(stats.max_return)
  const avgWinReturn = parseFloat(stats.avg_win_return)
  const avgLossReturn = parseFloat(stats.avg_loss_return)
  const total = parseInt(stats.total)
  const extremeWins = parseInt(stats.extreme_wins)
  const extremeLosses = parseInt(stats.extreme_losses)

  console.log(`   Average return: ${avgReturn.toFixed(2)}%`)
  console.log(`   Min return: ${minReturn.toFixed(2)}%`)
  console.log(`   Max return: ${maxReturn.toFixed(2)}%`)
  console.log(`   Average win return: ${avgWinReturn.toFixed(2)}%`)
  console.log(`   Average loss return: ${avgLossReturn.toFixed(2)}%`)
  console.log(`   Extreme wins (>100%): ${extremeWins}`)
  console.log(`   Extreme losses (<-100%): ${extremeLosses}\n`)

  // Validation: winning trades should have positive returns
  if (avgWinReturn <= 0) {
    addResult('Win Returns', false, 'Average win return is non-positive', 'error')
  } else {
    addResult('Win Returns', true, `Average win return: ${avgWinReturn.toFixed(2)}%`, 'info')
  }

  // Validation: losing trades should have negative returns around -102% (lose investment + fees)
  if (avgLossReturn > -80 || avgLossReturn < -120) {
    addResult('Loss Returns', false, `Average loss return ${avgLossReturn.toFixed(2)}% is unusual (expected ~-102%)`, 'warning')
  } else {
    addResult('Loss Returns', true, `Average loss return: ${avgLossReturn.toFixed(2)}%`, 'info')
  }

  // Validation: extreme returns
  const extremeRate = ((extremeWins + extremeLosses) / total) * 100
  if (extremeRate > 10) {
    addResult('Extreme Returns', false, `${extremeRate.toFixed(1)}% of trades have extreme returns (>100% or <-100%)`, 'warning')
  } else {
    addResult('Extreme Returns', true, `Only ${extremeRate.toFixed(1)}% extreme returns`, 'info')
  }
}

// ============================================================================
// Check 5: Sample Trades
// ============================================================================

async function checkSampleTrades(): Promise<void> {
  console.log('📋 Check 5: Sample Trades...')

  const result = await clickhouse.query({
    query: `
      SELECT
        trade_id,
        side,
        entry_price,
        shares,
        usd_value,
        outcome,
        pnl_gross,
        pnl_net,
        fee_usd,
        return_pct,
        hours_held
      FROM trades_raw
      WHERE outcome IS NOT NULL
      ORDER BY timestamp DESC
      LIMIT 10
    `,
    format: 'JSONEachRow',
  })

  const trades = await result.json()
  const sampleTrades = Array.isArray(trades) ? trades : [trades]

  console.table(sampleTrades.slice(0, 5))
  console.log()

  // Manual validation of sample trades
  let sampleErrors = 0

  for (const trade of sampleTrades) {
    const expectedPnlNet = trade.pnl_gross - trade.fee_usd
    const pnlNetDiff = Math.abs(trade.pnl_net - expectedPnlNet)

    if (pnlNetDiff > 0.01) {
      console.log(`   ⚠️  Trade ${trade.trade_id}: pnl_net mismatch (expected ${expectedPnlNet}, got ${trade.pnl_net})`)
      sampleErrors++
    }

    const expectedReturn = (trade.pnl_net / trade.usd_value) * 100
    const returnDiff = Math.abs(trade.return_pct - expectedReturn)

    if (returnDiff > 0.1) {
      console.log(`   ⚠️  Trade ${trade.trade_id}: return_pct mismatch (expected ${expectedReturn.toFixed(2)}%, got ${trade.return_pct.toFixed(2)}%)`)
      sampleErrors++
    }
  }

  if (sampleErrors > 0) {
    addResult('Sample Trades', false, `Found ${sampleErrors} calculation errors in samples`, 'error')
  } else {
    addResult('Sample Trades', true, 'All sample trades have correct calculations', 'info')
  }
}

// ============================================================================
// Check 6: Close Prices
// ============================================================================

async function checkClosePrices(): Promise<void> {
  console.log('💲 Check 6: Close Prices...')

  const result = await clickhouse.query({
    query: `
      SELECT
        avg(close_price) as avg_close_price,
        min(close_price) as min_close_price,
        max(close_price) as max_close_price,
        countIf(close_price < 0) as negative_prices,
        countIf(close_price > 1) as prices_above_1
      FROM trades_raw
      WHERE outcome IS NOT NULL
    `,
    format: 'JSONEachRow',
  })

  const data = await result.json<{
    avg_close_price: string
    min_close_price: string
    max_close_price: string
    negative_prices: string
    prices_above_1: string
  }>()

  const stats = Array.isArray(data) ? data[0] : data

  const avgClosePrice = parseFloat(stats.avg_close_price)
  const minClosePrice = parseFloat(stats.min_close_price)
  const maxClosePrice = parseFloat(stats.max_close_price)
  const negativePrices = parseInt(stats.negative_prices)
  const pricesAbove1 = parseInt(stats.prices_above_1)

  console.log(`   Average close price: $${avgClosePrice.toFixed(4)}`)
  console.log(`   Min close price: $${minClosePrice.toFixed(4)}`)
  console.log(`   Max close price: $${maxClosePrice.toFixed(4)}`)
  console.log(`   Negative prices: ${negativePrices}`)
  console.log(`   Prices above $1: ${pricesAbove1}\n`)

  // Validation: prices should be in range [0, 1]
  if (negativePrices > 0 || pricesAbove1 > 0) {
    addResult('Close Prices', false, `Found ${negativePrices + pricesAbove1} prices outside [0, 1] range`, 'error')
  } else {
    addResult('Close Prices', true, 'All close prices are in valid range [0, 1]', 'info')
  }

  // For resolved markets, close price should be close to 0 or 1
  const ambiguousResult = await clickhouse.query({
    query: `
      SELECT count() as ambiguous_resolutions
      FROM trades_raw
      WHERE outcome IS NOT NULL
        AND close_price > 0.1
        AND close_price < 0.9
    `,
    format: 'JSONEachRow',
  })

  const ambiguousData = await ambiguousResult.json<{ ambiguous_resolutions: string }>()
  const ambiguous = parseInt((Array.isArray(ambiguousData) ? ambiguousData[0] : ambiguousData).ambiguous_resolutions)

  console.log(`   Ambiguous resolutions (price 0.1-0.9): ${ambiguous}`)

  if (ambiguous > 0) {
    addResult('Resolution Clarity', false, `Found ${ambiguous} trades with ambiguous resolution prices`, 'warning')
  } else {
    addResult('Resolution Clarity', true, 'All resolutions are clear (price near 0 or 1)', 'info')
  }
}

// ============================================================================
// Results Summary
// ============================================================================

function printSummary(): void {
  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('                  VERIFICATION SUMMARY                     ')
  console.log('═══════════════════════════════════════════════════════════\n')

  const errors = results.filter(r => !r.passed && r.severity === 'error')
  const warnings = results.filter(r => !r.passed && r.severity === 'warning')
  const passed = results.filter(r => r.passed)

  console.log(`✅ Passed: ${passed.length}/${results.length} checks`)
  console.log(`⚠️  Warnings: ${warnings.length}`)
  console.log(`❌ Errors: ${errors.length}\n`)

  if (errors.length > 0) {
    console.log('❌ ERRORS:')
    errors.forEach(r => {
      console.log(`   [${r.check}] ${r.details}`)
    })
    console.log()
  }

  if (warnings.length > 0) {
    console.log('⚠️  WARNINGS:')
    warnings.forEach(r => {
      console.log(`   [${r.check}] ${r.details}`)
    })
    console.log()
  }

  if (errors.length === 0 && warnings.length === 0) {
    console.log('🎉 All checks passed! Trade enrichment is working correctly.\n')
  } else if (errors.length === 0) {
    console.log('✅ No critical errors. Some warnings to review.\n')
  } else {
    console.log('❌ Critical errors found. Review and fix before proceeding.\n')
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('           TRADE ENRICHMENT VERIFICATION                   ')
  console.log('═══════════════════════════════════════════════════════════\n')

  try {
    await checkBasicStats()
    await checkDataIntegrity()
    await checkPnLCalculations()
    await checkReturnPercentages()
    await checkSampleTrades()
    await checkClosePrices()

    printSummary()

    const errors = results.filter(r => !r.passed && r.severity === 'error')
    process.exit(errors.length > 0 ? 1 : 0)

  } catch (error) {
    console.error('\n❌ Verification failed:', error)
    process.exit(1)
  }
}

main()
