import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import {
  calculateWalletOmegaScore,
  rankWalletsByOmega,
  getTopMomentumWallets,
} from '@/lib/metrics/omega-from-goldsky'

async function main() {
  console.log('🧮 Calculating Omega Scores from Goldsky PnL Data...\n')
  console.log('This uses realized PnL from closed positions to calculate:')
  console.log('- Omega Ratio (gains/losses)')
  console.log('- Omega Momentum (improving vs declining)')
  console.log('- Win Rate and average gains/losses')
  console.log('- Letter grades (S/A/B/C/D/F)\n')

  // Test with wallets we discovered earlier
  const testWallets = [
    '0xc5d563a36ae78145c45a50134d48a1215220f80a', // 233 trades
    '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e', // 221 trades
    '0x241f846866c2de4fb67cdb0ca6b963d85e56ef50', // 72 trades
    '0x537494c54dee9162534675712f2e625c9713042e', // 47 trades
    '0x066ea9d5dacc81ea3a0535ffe13209d55571ceb2', // 46 trades
    '0x96a8b71cbfdcc8f0af7efc22c28c8bc237ed29d6', // Our original test wallet
  ]

  console.log(`Testing ${testWallets.length} wallets...\n`)

  // Calculate scores for each wallet
  console.log('=' .repeat(80))
  console.log('INDIVIDUAL WALLET SCORES')
  console.log('='.repeat(80))

  for (const wallet of testWallets) {
    console.log(`\n📊 Wallet: ${wallet}`)

    try {
      const score = await calculateWalletOmegaScore(wallet)

      if (!score) {
        console.log('   ⚠️  No PnL data found (no closed positions)')
        continue
      }

      console.log(`   Grade: ${score.grade}`)
      console.log(`   Omega Ratio: ${score.omega_ratio.toFixed(2)}`)
      console.log(`   Total Positions: ${score.total_positions} (${score.closed_positions} closed)`)
      console.log(`   Win Rate: ${(score.win_rate * 100).toFixed(1)}%`)
      console.log(`   Total P&L: $${score.total_pnl.toFixed(2)}`)
      console.log(`   Avg Gain: $${score.avg_gain.toFixed(2)} | Avg Loss: $${score.avg_loss.toFixed(2)}`)

      if (score.omega_momentum !== null) {
        const momentumPct = (score.omega_momentum * 100).toFixed(1)
        const momentumIcon =
          score.momentum_direction === 'improving'
            ? '📈'
            : score.momentum_direction === 'declining'
              ? '📉'
              : '➡️'
        console.log(
          `   Momentum: ${momentumPct}% ${momentumIcon} (${score.momentum_direction})`
        )
      } else {
        console.log(`   Momentum: Not enough data`)
      }

      if (!score.meets_minimum_trades) {
        console.log(`   ⚠️  Below minimum ${5} closed trades (has ${score.closed_positions})`)
      }
    } catch (error) {
      console.log(`   ❌ Error: ${(error as Error).message}`)
    }
  }

  // Rank wallets
  console.log('\n\n')
  console.log('='.repeat(80))
  console.log('RANKED BY OMEGA RATIO (Top Performers)')
  console.log('='.repeat(80))

  const ranked = await rankWalletsByOmega(testWallets)

  if (ranked.length === 0) {
    console.log('\n⚠️  No wallets with sufficient closed positions found')
  } else {
    console.log(`\nFound ${ranked.length} wallets meeting minimum trade requirement:\n`)

    ranked.forEach((score, i) => {
      const rank = i + 1
      const momentumIcon =
        score.momentum_direction === 'improving'
          ? '📈'
          : score.momentum_direction === 'declining'
            ? '📉'
            : '➡️'

      console.log(`${rank}. [${score.grade}] ${score.wallet_address.slice(0, 10)}...`)
      console.log(`   Omega: ${score.omega_ratio.toFixed(2)} | P&L: $${score.total_pnl.toFixed(2)} | Win Rate: ${(score.win_rate * 100).toFixed(1)}%`)
      console.log(`   Momentum: ${momentumIcon} ${score.momentum_direction}`)
      console.log()
    })
  }

  // Get hot wallets (improving momentum)
  console.log('\n')
  console.log('='.repeat(80))
  console.log('HOT WALLETS (Improving Momentum)')
  console.log('='.repeat(80))

  const hotWallets = await getTopMomentumWallets(testWallets, 5)

  if (hotWallets.length === 0) {
    console.log('\n⚠️  No wallets with improving momentum found')
  } else {
    console.log(`\nFound ${hotWallets.length} wallets with positive momentum:\n`)

    hotWallets.forEach((score, i) => {
      const momentumPct = ((score.omega_momentum || 0) * 100).toFixed(1)
      console.log(`${i + 1}. [${score.grade}] ${score.wallet_address.slice(0, 10)}...`)
      console.log(`   Omega: ${score.omega_ratio.toFixed(2)} → Momentum: +${momentumPct}% 📈`)
      console.log(`   P&L: $${score.total_pnl.toFixed(2)} | Win Rate: ${(score.win_rate * 100).toFixed(1)}%`)
      console.log()
    })
  }

  console.log('\n✅ Omega Score Calculation Complete!')
  console.log('\n💡 Next steps:')
  console.log('   1. Store these scores in Postgres wallet_scores table')
  console.log('   2. Create API endpoint to serve scores')
  console.log('   3. Display in frontend with wallet profiles')
  console.log('   4. Use in Market Screener for SII (Smart Investor Index)')
}

main()
