import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { calculateAllMetrics, calculateOmegaRatio } from '@/lib/metrics/omega'

async function testOmegaCalculation() {
  console.log('🧮 Testing Omega ratio calculation...\n')

  // Test with the wallet we synced earlier
  const testWallet = '0x96a8b71cbfdcc8f0af7efc22c28c8bc237ed29d6'

  console.log(`Testing with wallet: ${testWallet}\n`)

  try {
    const metrics = await calculateAllMetrics(testWallet)

    console.log('📊 Metrics Results:\n')
    console.log('Omega 30d:')
    if (metrics.omega_30d) {
      console.log(`  Omega Ratio: ${metrics.omega_30d.omega_ratio.toFixed(2)}`)
      console.log(`  Total Trades: ${metrics.omega_30d.total_trades}`)
      console.log(`  Win Rate: ${(metrics.omega_30d.win_rate * 100).toFixed(1)}%`)
      console.log(`  Winning Trades: ${metrics.omega_30d.winning_trades}`)
      console.log(`  Losing Trades: ${metrics.omega_30d.losing_trades}`)
      console.log(`  Total Gains: $${metrics.omega_30d.total_gains.toFixed(2)}`)
      console.log(`  Total Losses: $${metrics.omega_30d.total_losses.toFixed(2)}`)
      console.log(`  Avg Gain: $${metrics.omega_30d.avg_gain.toFixed(2)}`)
      console.log(`  Avg Loss: $${metrics.omega_30d.avg_loss.toFixed(2)}`)
    } else {
      console.log('  ⚠️  No closed trades with PnL data (need to calculate PnL first)')
    }

    console.log('\nOmega 60d:')
    if (metrics.omega_60d) {
      console.log(`  Omega Ratio: ${metrics.omega_60d.omega_ratio.toFixed(2)}`)
      console.log(`  Total Trades: ${metrics.omega_60d.total_trades}`)
    } else {
      console.log('  ⚠️  No data')
    }

    console.log('\nOmega Momentum:')
    if (metrics.omega_momentum) {
      console.log(`  30d Omega: ${metrics.omega_momentum.omega_30d.toFixed(2)}`)
      console.log(`  60d Omega: ${metrics.omega_momentum.omega_60d.toFixed(2)}`)
      console.log(`  Momentum: ${(metrics.omega_momentum.omega_momentum * 100).toFixed(1)}%`)
      console.log(`  Direction: ${metrics.omega_momentum.momentum_direction}`)
    } else {
      console.log('  ⚠️  Not enough data')
    }

    console.log('\nSharpe Ratio (30d):')
    if (metrics.sharpe_30d !== null) {
      console.log(`  Sharpe: ${metrics.sharpe_30d.toFixed(2)}`)
    } else {
      console.log('  ⚠️  No data')
    }

    console.log('\n\n💡 Note:')
    console.log('If no metrics are shown, it means we need to:')
    console.log('1. Match buy/sell trades to calculate realized PnL')
    console.log('2. Update trades_raw with is_closed=true and pnl values')
    console.log('3. Re-run this calculation')
  } catch (error) {
    console.error('❌ Error:', error)
  }
}

testOmegaCalculation()
