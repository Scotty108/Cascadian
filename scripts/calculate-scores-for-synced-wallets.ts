#!/usr/bin/env npx tsx

/**
 * Calculate Scores for Synced Wallets
 *
 * Use Goldsky PnL data for the 1,250 wallets we already synced to ClickHouse.
 * These wallets are guaranteed to have trading activity and P&L data.
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'
import { createClient as createClickHouseClient } from '@clickhouse/client'
import { fetchWalletPnL } from '../lib/goldsky/client'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const clickhouse = createClickHouseClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
})

const GOLDSKY_PNL_CORRECTION_FACTOR = 13.2399

interface WalletStats {
  wallet_address: string
  total_pnl: number
  total_volume: number
  position_count: number
  wins: number
  losses: number
  win_rate: number
  omega_ratio: number
}

async function calculateScoresForSyncedWallets() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  GOLDSKY SCORING FOR SYNCED WALLETS (1,250 wallets)     ')
  console.log('═══════════════════════════════════════════════════════════\n')

  // Get unique wallets from ClickHouse trades_raw
  console.log('📡 Fetching synced wallets from ClickHouse...')

  const walletsQuery = `
    SELECT DISTINCT wallet_address
    FROM trades_raw
    ORDER BY wallet_address
  `

  const walletsResult = await clickhouse.query({
    query: walletsQuery,
    format: 'JSONEachRow',
  })

  const wallets: any[] = await walletsResult.json()
  const walletAddresses = wallets.map((w) => w.wallet_address)

  console.log(`✅ Found ${walletAddresses.length} unique wallets\n`)
  console.log('🔄 Processing wallets...\n')

  let processed = 0
  let succeeded = 0
  let failed = 0
  const startTime = Date.now()

  const BATCH_SIZE = 50

  for (let i = 0; i < walletAddresses.length; i += BATCH_SIZE) {
    const batch = walletAddresses.slice(i, i + BATCH_SIZE)

    const results = await Promise.allSettled(
      batch.map(async (wallet) => {
        const pnlData = await fetchWalletPnL(wallet)

        if (!pnlData || pnlData.positionCount === 0) {
          return null
        }

        // Apply correction factor
        const totalPnl = pnlData.totalRealizedPnl / GOLDSKY_PNL_CORRECTION_FACTOR / 1e6

        // Calculate stats from positions
        let wins = 0
        let losses = 0
        let totalWins = 0
        let totalLosses = 0
        let totalVolume = 0

        for (const pos of pnlData.positions) {
          const pnl = parseFloat(pos.realizedPnl) / GOLDSKY_PNL_CORRECTION_FACTOR / 1e6
          const volume = parseFloat(pos.totalBought) / GOLDSKY_PNL_CORRECTION_FACTOR / 1e6

          totalVolume += volume

          if (pnl > 0) {
            wins++
            totalWins += pnl
          } else if (pnl < 0) {
            losses++
            totalLosses += Math.abs(pnl)
          }
        }

        const winRate = wins + losses > 0 ? wins / (wins + losses) : 0
        const omegaRatio = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? 99 : 0

        const stats: WalletStats = {
          wallet_address: wallet,
          total_pnl: totalPnl,
          total_volume: totalVolume,
          position_count: pnlData.positionCount,
          wins,
          losses,
          win_rate: winRate,
          omega_ratio: omegaRatio,
        }

        // Save to Supabase
        const { error } = await supabase.from('wallet_scores').upsert(
          {
            wallet_address: stats.wallet_address,
            omega_net: stats.omega_ratio,
            total_pnl: stats.total_pnl,
            total_volume_usd: stats.total_volume,
            total_bets: stats.position_count,
            wins: stats.wins,
            losses: stats.losses,
            win_rate: stats.win_rate,
            last_calculated_at: new Date().toISOString(),
          },
          {
            onConflict: 'wallet_address',
          }
        )

        if (error) {
          throw new Error(`Failed to save: ${error.message}`)
        }

        return stats
      })
    )

    // Count results
    for (const result of results) {
      processed++

      if (result.status === 'fulfilled' && result.value) {
        succeeded++
      } else {
        failed++
      }
    }

    // Progress update
    const elapsed = Date.now() - startTime
    const rate = processed / (elapsed / 1000)
    const remaining = walletAddresses.length - processed
    const eta = remaining / rate

    console.log(`\n[Batch ${Math.floor(i / BATCH_SIZE) + 1}] Processed ${batch.length} wallets`)
    console.log(`📊 Progress: ${processed}/${walletAddresses.length} (${((processed / walletAddresses.length) * 100).toFixed(1)}%)`)
    console.log(`   ✅ Succeeded: ${succeeded}`)
    console.log(`   ❌ Failed: ${failed}`)
    console.log(`   📈 Rate: ${rate.toFixed(1)} wallets/sec`)
    console.log(`   ⏱️  Elapsed: ${formatDuration(elapsed)}`)
    console.log(`   ⏳ ETA: ${formatDuration(eta * 1000)}`)

    // Small delay between batches
    if (i + BATCH_SIZE < walletAddresses.length) {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }

  // Final summary
  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('                     SUMMARY                               ')
  console.log('═══════════════════════════════════════════════════════════\n')

  const elapsed = Date.now() - startTime
  const successRate = ((succeeded / walletAddresses.length) * 100).toFixed(1)

  console.log(`✅ Total wallets processed: ${walletAddresses.length.toLocaleString()}`)
  console.log(`✅ Successfully scored: ${succeeded.toLocaleString()} (${successRate}%)`)
  console.log(`⚠️  Failed: ${failed.toLocaleString()}`)
  console.log(`⏱️  Total time: ${formatDuration(elapsed)}`)

  console.log('\n📊 Next steps:')
  console.log('   1. Test strategies with these metrics')
  console.log('   2. Expand to more wallets if needed')
  console.log('   3. Set up daily refresh\n')
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  } else {
    return `${seconds}s`
  }
}

calculateScoresForSyncedWallets()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
