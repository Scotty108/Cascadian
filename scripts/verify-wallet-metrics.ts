/**
 * Verify Wallet Metrics Calculations
 *
 * This script audits all wallet metrics for a specific address
 * and compares them against the UI display to find discrepancies.
 */

import { calculateWalletOmegaScore } from '@/lib/metrics/omega-from-goldsky'

const TEST_WALLET = '0x059fd0a47dbf42f2d723ddb5739cee6f3e6f9728'

async function main() {
  console.log(`\n🔍 Auditing Wallet Metrics for ${TEST_WALLET}\n`)
  console.log('=' .repeat(80))

  // Step 1: Calculate Omega Score from Goldsky
  console.log('\n📊 Step 1: Fetching Omega Score from Goldsky...\n')
  const omegaScore = await calculateWalletOmegaScore(TEST_WALLET)

  if (!omegaScore) {
    console.error('❌ No Omega score data found for this wallet')
    return
  }

  console.log('Omega Score Data:')
  console.log(`  Omega Ratio: ${omegaScore.omega_ratio.toFixed(2)}`)
  console.log(`  Total PnL: $${omegaScore.total_pnl.toFixed(2)}`)
  console.log(`  Total Gains: $${omegaScore.total_gains.toFixed(2)}`)
  console.log(`  Total Losses: $${omegaScore.total_losses.toFixed(2)}`)
  console.log(`  Win Rate: ${(omegaScore.win_rate * 100).toFixed(1)}%`)
  console.log(`  Closed Positions: ${omegaScore.closed_positions}`)
  console.log(`  Grade: ${omegaScore.grade}`)
  console.log(`  Momentum: ${omegaScore.momentum_direction}`)

  // Step 2: Check API endpoint
  console.log('\n📊 Step 2: Checking API endpoint...\n')
  try {
    const response = await fetch(`http://localhost:3000/api/wallets/${TEST_WALLET}/score?fresh=true`)
    const apiData = await response.json()

    console.log('API Response:')
    console.log(`  Status: ${response.status}`)
    if (response.ok) {
      console.log(`  Omega Ratio: ${apiData.omega_ratio?.toFixed(2)}`)
      console.log(`  Total Gains: $${apiData.total_gains?.toFixed(2)}`)
      console.log(`  Total Losses: $${apiData.total_losses?.toFixed(2)}`)
      console.log(`  Win Rate: ${(apiData.win_rate * 100)?.toFixed(1)}%`)
    } else {
      console.log(`  Error: ${apiData.error}`)
    }
  } catch (error) {
    console.error('❌ Failed to fetch from API:', error)
  }

  // Step 3: Comparison & Issues
  console.log('\n📊 Step 3: Known Issues from UI:\n')
  console.log('❌ UI shows:')
  console.log('   - Total Gains: $0.0k')
  console.log('   - Total Losses: $0.0k')
  console.log('   - Net PnL: $-11')
  console.log('   - Win Rate: 77.6% (104W / 30L = 134 closed)')
  console.log('   - Omega Ratio: 0.15')
  console.log('   - Avg Trade Size: $167 (100 trades)')
  console.log('')
  console.log('✅ Actual calculations show:')
  console.log(`   - Total Gains: $${omegaScore.total_gains.toFixed(2)}`)
  console.log(`   - Total Losses: $${omegaScore.total_losses.toFixed(2)}`)
  console.log(`   - Net PnL: $${omegaScore.total_pnl.toFixed(2)}`)
  console.log(`   - Win Rate: ${(omegaScore.win_rate * 100).toFixed(1)}%`)
  console.log(`   - Closed Positions: ${omegaScore.closed_positions}`)

  // Step 4: Identify Discrepancies
  console.log('\n🔍 Step 4: Discrepancy Analysis:\n')

  const issues: string[] = []

  // Check if Total Gains/Losses are actually $0
  if (omegaScore.total_gains === 0 && omegaScore.total_losses === 0) {
    issues.push('✓ Total Gains/Losses are correctly $0 (no profitable/losing trades found)')
  } else if (omegaScore.total_gains > 0 || omegaScore.total_losses > 0) {
    issues.push(`❌ UI shows $0 but actual: Gains=$${omegaScore.total_gains.toFixed(2)}, Losses=$${omegaScore.total_losses.toFixed(2)}`)
    issues.push('   → Issue: Frontend not displaying omega score data')
  }

  // Check trade counts
  const uiClosedTrades = 134
  const uiTotalTrades = 100
  if (omegaScore.closed_positions !== uiClosedTrades) {
    issues.push(`❌ Closed positions mismatch: UI shows ${uiClosedTrades}, actual: ${omegaScore.closed_positions}`)
  }
  if (uiTotalTrades !== uiClosedTrades) {
    issues.push(`❌ Trade count inconsistency: UI shows ${uiClosedTrades} closed but ${uiTotalTrades} total trades`)
    issues.push('   → Issue: useWalletTrades hook may be fetching different data than closed positions')
  }

  // Check win rate
  const expectedWinRate = 104 / 134 // 77.6%
  if (Math.abs((omegaScore.win_rate * 100) - (expectedWinRate * 100)) > 0.5) {
    issues.push(`❌ Win rate mismatch: UI shows ${(expectedWinRate * 100).toFixed(1)}%, actual: ${(omegaScore.win_rate * 100).toFixed(1)}%`)
  } else {
    issues.push(`✓ Win rate matches: ${(omegaScore.win_rate * 100).toFixed(1)}%`)
  }

  console.log(issues.join('\n'))

  console.log('\n' + '='.repeat(80))
  console.log('\n💡 Recommendations:\n')
  console.log('1. Check if omega score is loading correctly in UI')
  console.log('2. Verify Total Gains/Losses are being read from omegaScore.total_gains/losses')
  console.log('3. Fix trade count discrepancy (134 closed vs 100 total)')
  console.log('4. Ensure all data sources (Goldsky vs Polymarket API) are aligned')
  console.log('5. Verify graph data matches the displayed metrics\n')
}

main().catch(console.error)
