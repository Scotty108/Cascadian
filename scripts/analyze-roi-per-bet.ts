/**
 * Analyze ROI Per Bet for Copy Trading Projections
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function analyzeRoiPerBet() {
  console.log('💰 Analyzing ROI Per Bet for Copy Trading\n')

  // Get top 50 wallets with 10+ trades
  const { data: wallets, error } = await supabase
    .from('wallet_scores')
    .select('wallet_address, omega_ratio, total_pnl, closed_positions, total_gains, total_losses')
    .gte('closed_positions', 10)
    .not('omega_ratio', 'is', null)
    .order('omega_ratio', { ascending: false })
    .limit(50)

  if (error || !wallets || wallets.length === 0) {
    console.log('❌ No data found')
    return
  }

  // Calculate ROI per bet for each wallet
  const walletsWithRoi = wallets.map(w => {
    const totalPnl = parseFloat(w.total_pnl || '0')
    const closedPositions = w.closed_positions || 0
    const totalGains = parseFloat(w.total_gains || '0')
    const totalLosses = parseFloat(w.total_losses || '0')
    const totalCapitalDeployed = totalGains + totalLosses

    return {
      ...w,
      roi_per_bet: closedPositions > 0 ? totalPnl / closedPositions : 0,
      overall_roi_pct: totalCapitalDeployed > 0 ? (totalPnl / totalCapitalDeployed) * 100 : 0,
    }
  })

  // Calculate statistics
  const roiPerBetValues = walletsWithRoi.map(w => w.roi_per_bet)
  const overallRoiValues = walletsWithRoi.map(w => w.overall_roi_pct)

  const avgRoiPerBet = roiPerBetValues.reduce((sum, val) => sum + val, 0) / roiPerBetValues.length
  const medianRoiPerBet = [...roiPerBetValues].sort((a, b) => a - b)[Math.floor(roiPerBetValues.length / 2)]

  const avgOverallRoi = overallRoiValues.reduce((sum, val) => sum + val, 0) / overallRoiValues.length
  const medianOverallRoi = [...overallRoiValues].sort((a, b) => a - b)[Math.floor(overallRoiValues.length / 2)]

  // Filter to reasonable omega ratios (≤50) to exclude outliers
  const reasonable = walletsWithRoi.filter(w => parseFloat(w.omega_ratio) <= 50)
  const reasonableRoiPerBet = reasonable.map(w => w.roi_per_bet)
  const reasonableAvgRoiPerBet = reasonableRoiPerBet.reduce((sum, val) => sum + val, 0) / reasonableRoiPerBet.length
  const reasonableMedianRoiPerBet = [...reasonableRoiPerBet].sort((a, b) => a - b)[Math.floor(reasonableRoiPerBet.length / 2)]

  console.log('═══════════════════════════════════════════════════════════════')
  console.log('              ROI PER BET ANALYSIS (Top 50 Wallets)            ')
  console.log('═══════════════════════════════════════════════════════════════\n')

  console.log('📊 ALL WALLETS (Top 50 by Omega):')
  console.log(`   Average ROI per Bet:    $${avgRoiPerBet.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
  console.log(`   Median ROI per Bet:     $${medianRoiPerBet.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ✓`)
  console.log(`   Average Overall ROI:    ${avgOverallRoi.toFixed(1)}%`)
  console.log(`   Median Overall ROI:     ${medianOverallRoi.toFixed(1)}% ✓`)
  console.log()

  console.log('📊 REASONABLE OMEGA (≤50, filters outliers):')
  console.log(`   Count:                  ${reasonable.length} wallets`)
  console.log(`   Average ROI per Bet:    $${reasonableAvgRoiPerBet.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
  console.log(`   Median ROI per Bet:     $${reasonableMedianRoiPerBet.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ✓`)
  console.log()

  console.log('═══════════════════════════════════════════════════════════════')
  console.log('                   COPY TRADING PROJECTIONS                    ')
  console.log('═══════════════════════════════════════════════════════════════\n')

  console.log('💡 If you copy trade 100 bets at MEDIAN ROI per bet:\n')

  console.log(`   Conservative (Reasonable Omega ≤50):`)
  console.log(`   → ${reasonableMedianRoiPerBet.toFixed(2)} × 100 = $${(reasonableMedianRoiPerBet * 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
  console.log()

  console.log(`   All Top 50 (includes outliers):`)
  console.log(`   → ${medianRoiPerBet.toFixed(2)} × 100 = $${(medianRoiPerBet * 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
  console.log()

  console.log('⚠️  IMPORTANT CAVEATS:')
  console.log('   • Past performance ≠ future results')
  console.log('   • These are TOP performers (survivorship bias)')
  console.log('   • Your bet sizes may differ from theirs')
  console.log('   • Slippage and timing differences in copy trading')
  console.log('   • Use the MEDIAN, not average (less skewed by outliers)')
  console.log()

  console.log('🎯 RECOMMENDATION:')
  console.log(`   Use the reasonable omega median: $${reasonableMedianRoiPerBet.toFixed(2)} per bet`)
  console.log(`   Expected on 100 trades: $${(reasonableMedianRoiPerBet * 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
  console.log(`   Overall ROI %: ${reasonableMedianRoiPerBet > 0 ? '+' : ''}${medianOverallRoi.toFixed(1)}%`)
  console.log()

  // Show top 10 by ROI per bet
  console.log('🏆 Top 10 by ROI Per Bet:\n')
  const topByRoi = [...walletsWithRoi].sort((a, b) => b.roi_per_bet - a.roi_per_bet).slice(0, 10)

  console.log('Rank | Address          | ROI/Bet    | Trades | Total PnL  | Omega')
  console.log('─────┼──────────────────┼────────────┼────────┼────────────┼──────')
  topByRoi.forEach((w, i) => {
    const rank = (i + 1).toString().padStart(4)
    const addr = w.wallet_address.slice(0, 16)
    const roiBet = `$${w.roi_per_bet.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`.padStart(10)
    const trades = w.closed_positions.toString().padStart(6)
    const pnl = `$${parseFloat(w.total_pnl).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`.padStart(10)
    const omega = parseFloat(w.omega_ratio).toFixed(1).padStart(5)
    console.log(`${rank} | ${addr} | ${roiBet} | ${trades} | ${pnl} | ${omega}`)
  })

  console.log('\n✅ Analysis complete!\n')
}

analyzeRoiPerBet()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
