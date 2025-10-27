#!/usr/bin/env tsx
/**
 * Monitor Signal Wallet Positions
 *
 * Fetches current positions for all 548 signal wallets and syncs to database.
 * Detects entries/exits and triggers watchlist population (future).
 *
 * Usage:
 *   npm exec tsx scripts/monitor-signal-wallet-positions.ts
 *
 * Schedule:
 *   Run every 5-15 minutes via CRON or Vercel cron
 *
 * Rate Limits:
 *   - Polymarket Data-API: ~100 requests/minute
 *   - This script: ~60 wallets/minute (5 parallel, 1s delay)
 *   - Full run: ~10 minutes for 548 wallets
 */

import { config } from 'dotenv'
import { monitorAllSignalWallets, getSignalWalletPositionStats } from '@/lib/services/wallet-position-monitor'
import { getSignalWalletCount } from '@/lib/data/wallet-signal-set'
import { isAutonomousTradingEnabled } from '@/lib/services/watchlist-auto-populate'

config({ path: '.env.local' })

async function main() {
  console.log('\n' + '='.repeat(60))
  console.log('  SIGNAL WALLET POSITION MONITORING')
  console.log('='.repeat(60))
  console.log(`Started: ${new Date().toISOString()}`)
  console.log()

  // Display kill switch status
  const autonomousEnabled = isAutonomousTradingEnabled()
  console.log('⚙️  Configuration:')
  console.log(`  AUTONOMOUS_TRADING_ENABLED: ${autonomousEnabled}`)
  if (!autonomousEnabled) {
    console.log('  ⚠️  Auto-population DISABLED (watchlists will NOT be updated)')
  } else {
    console.log('  ✅ Auto-population ENABLED (watchlists will be updated)')
  }
  console.log()

  // Show current stats before monitoring
  console.log('📊 Current Stats (before):')
  const statsBefore = await getSignalWalletPositionStats()
  if (statsBefore) {
    console.log(`  Wallets with positions: ${statsBefore.walletCount}`)
    console.log(`  Unique markets: ${statsBefore.marketCount}`)
    console.log(`  Total positions: ${statsBefore.totalPositions}`)
    console.log(`  Total unrealized P&L: $${statsBefore.totalPnL.toFixed(2)}`)
  }
  console.log()

  // Run monitoring with progress updates
  const startTime = Date.now()
  const result = await monitorAllSignalWallets({
    batchSize: 5,      // Process 5 wallets in parallel
    delayMs: 1000,     // 1 second delay between batches
    onProgress: (processed, total, changes) => {
      const pct = ((processed / total) * 100).toFixed(1)
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0)
      process.stdout.write(`\r⏳ Progress: ${processed}/${total} (${pct}%) | Changes: ${changes} | Elapsed: ${elapsed}s`)
    }
  })

  console.log() // New line after progress
  console.log()

  // Show stats after monitoring
  console.log('📊 Current Stats (after):')
  const statsAfter = await getSignalWalletPositionStats()
  if (statsAfter) {
    console.log(`  Wallets with positions: ${statsAfter.walletCount} (${statsAfter.walletCount > (statsBefore?.walletCount || 0) ? '+' : ''}${statsAfter.walletCount - (statsBefore?.walletCount || 0)})`)
    console.log(`  Unique markets: ${statsAfter.marketCount} (${statsAfter.marketCount > (statsBefore?.marketCount || 0) ? '+' : ''}${statsAfter.marketCount - (statsBefore?.marketCount || 0)})`)
    console.log(`  Total positions: ${statsAfter.totalPositions} (${statsAfter.totalPositions > (statsBefore?.totalPositions || 0) ? '+' : ''}${statsAfter.totalPositions - (statsBefore?.totalPositions || 0)})`)
    console.log(`  Total unrealized P&L: $${statsAfter.totalPnL.toFixed(2)} (${statsAfter.totalPnL > (statsBefore?.totalPnL || 0) ? '+' : ''}$${(statsAfter.totalPnL - (statsBefore?.totalPnL || 0)).toFixed(2)})`)
  }
  console.log()

  // Show detected changes
  if (result.changes.length > 0) {
    console.log('🔔 Detected Changes:')

    const entries = result.changes.filter(c => c.type === 'ENTERED')
    const exits = result.changes.filter(c => c.type === 'EXITED')

    if (entries.length > 0) {
      console.log(`\n  📈 ${entries.length} New Positions Entered:`)
      entries.slice(0, 10).forEach(change => {
        console.log(`    - ${change.wallet_address.slice(0, 10)}... entered ${change.outcome} on ${change.market_id.slice(0, 20)}...`)
      })
      if (entries.length > 10) {
        console.log(`    ... and ${entries.length - 10} more`)
      }
    }

    if (exits.length > 0) {
      console.log(`\n  📉 ${exits.length} Positions Exited:`)
      exits.slice(0, 10).forEach(change => {
        console.log(`    - ${change.wallet_address.slice(0, 10)}... exited ${change.outcome} on ${change.market_id.slice(0, 20)}...`)
      })
      if (exits.length > 10) {
        console.log(`    ... and ${exits.length - 10} more`)
      }
    }
  } else {
    console.log('✅ No changes detected (all positions up to date)')
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log()
  console.log('='.repeat(60))
  console.log(`Completed: ${new Date().toISOString()}`)
  console.log(`Duration: ${duration}s`)
  console.log('='.repeat(60))
  console.log()

  // TODO: Trigger watchlist population based on changes
  // TODO: Send notifications for high-value entries
}

main()
  .then(() => {
    console.log('✨ Done!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Error:', error)
    process.exit(1)
  })
