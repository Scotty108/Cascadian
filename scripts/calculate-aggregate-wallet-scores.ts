#!/usr/bin/env npx tsx

/**
 * Calculate Aggregate Wallet Scores for All Discovered Wallets
 *
 * This script calculates basic wallet metrics using aggregated data from Goldsky
 * WITHOUT syncing full trade history for each wallet.
 *
 * Purpose:
 * - Get basic scores for ALL 59,864 wallets to build full distribution
 * - Enable percentile calculations and relative rankings
 * - Support crowd vs elite divergence signals
 * - Much faster than syncing full trade history
 *
 * Metrics Calculated:
 * - Total P&L (realized + unrealized)
 * - Win rate
 * - Total trades
 * - Total volume
 * - Basic Omega ratio (wins vs losses)
 *
 * Time Estimate: 2-4 hours (vs 18 days for full trade sync)
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'
import { request, gql } from 'graphql-request'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Use PnL subgraph endpoint (has realizedPnl data)
const GOLDSKY_ENDPOINT = 'https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn'

// ============================================================================
// Constants
// ============================================================================

// Goldsky PnL Correction Factor (empirically verified - 0.00% error)
// Root cause: Goldsky sums PnL across all outcome tokens in multi-outcome markets
// See: lib/metrics/omega-from-goldsky.ts and OMEGA_SCORING_SYSTEM.md
const GOLDSKY_PNL_CORRECTION_FACTOR = 13.2399

// ============================================================================
// Types
// ============================================================================

interface WalletAggregateStats {
  wallet_address: string
  total_pnl: number
  total_volume: number
  total_trades: number
  wins: number
  losses: number
  win_rate: number
  omega_ratio: number
  avg_trade_size: number
}

interface ProcessingStats {
  totalWallets: number
  processed: number
  succeeded: number
  failed: number
  startTime: number
}

// ============================================================================
// Goldsky Queries
// ============================================================================

// Query userPositions from PnL subgraph (not userBalances!)
const WALLET_AGGREGATE_QUERY = gql`
  query GetWalletAggregateStats($walletAddress: String!) {
    userPositions(where: { user: $walletAddress }, first: 1000) {
      id
      user
      tokenId
      amount
      avgPrice
      realizedPnl
      totalBought
    }
  }
`

// ============================================================================
// Aggregate Calculation
// ============================================================================

async function fetchWalletAggregateStats(
  walletAddress: string
): Promise<WalletAggregateStats | null> {
  try {
    const data = await request(GOLDSKY_ENDPOINT, WALLET_AGGREGATE_QUERY, {
      walletAddress: walletAddress.toLowerCase(),
    })

    const positions = (data as any).userPositions || []

    if (positions.length === 0) {
      return null // No trading activity
    }

    let totalPnl = 0
    let totalVolume = 0
    let totalTrades = 0
    let winningTrades = 0
    let losingTrades = 0

    for (const position of positions) {
      const bought = parseFloat(position.totalBought || '0')
      const realizedPnlRaw = parseFloat(position.realizedPnl || '0')

      // Apply Goldsky correction factor + USDC decimals
      // Formula: pnlInUSD = realizedPnl / 13.2399 / 1e6
      const realizedPnl = realizedPnlRaw / GOLDSKY_PNL_CORRECTION_FACTOR / 1e6

      // Add to volume (total USD traded) - also needs correction
      const volumeUSD = bought / GOLDSKY_PNL_CORRECTION_FACTOR / 1e6
      totalVolume += volumeUSD

      // Count trades (each position = 1 trade)
      totalTrades++

      // Add realized P&L (now corrected)
      totalPnl += realizedPnl

      // Track wins/losses
      if (realizedPnl > 0) {
        winningTrades++
      } else if (realizedPnl < 0) {
        losingTrades++
      }
    }

    const winRate = totalTrades > 0 ? winningTrades / totalTrades : 0

    // Calculate basic Omega ratio (wins vs losses)
    // Omega = sum(gains) / abs(sum(losses))
    const totalWins = positions
      .filter((p: any) => parseFloat(p.realizedPnl || '0') > 0)
      .reduce((sum: number, p: any) => {
        const pnl = parseFloat(p.realizedPnl || '0') / GOLDSKY_PNL_CORRECTION_FACTOR / 1e6
        return sum + pnl
      }, 0)

    const totalLosses = Math.abs(
      positions
        .filter((p: any) => parseFloat(p.realizedPnl || '0') < 0)
        .reduce((sum: number, p: any) => {
          const pnl = parseFloat(p.realizedPnl || '0') / GOLDSKY_PNL_CORRECTION_FACTOR / 1e6
          return sum + pnl
        }, 0)
    )

    const omegaRatio = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? 99 : 0

    const avgTradeSize = totalTrades > 0 ? totalVolume / totalTrades : 0

    return {
      wallet_address: walletAddress,
      total_pnl: totalPnl,
      total_volume: totalVolume,
      total_trades: totalTrades,
      wins: winningTrades,
      losses: losingTrades,
      win_rate: winRate,
      omega_ratio: omegaRatio,
      avg_trade_size: avgTradeSize,
    }
  } catch (error) {
    console.error(`   ⚠️  Error fetching stats for ${walletAddress}:`, error)
    return null
  }
}

// ============================================================================
// Database Operations
// ============================================================================

async function saveWalletScore(stats: WalletAggregateStats): Promise<void> {
  const { error } = await supabase.from('wallet_scores').upsert(
    {
      wallet_address: stats.wallet_address,
      omega_net: stats.omega_ratio,
      total_pnl: stats.total_pnl,
      total_volume_usd: stats.total_volume,
      total_bets: stats.total_trades,
      wins: stats.wins,
      losses: stats.losses,
      win_rate: stats.win_rate,
      avg_bet_size: stats.avg_trade_size,
      last_calculated_at: new Date().toISOString(),
    },
    {
      onConflict: 'wallet_address',
    }
  )

  if (error) {
    throw new Error(`Failed to save wallet score: ${error.message}`)
  }
}

// ============================================================================
// Batch Processing
// ============================================================================

async function processBatch(
  wallets: string[],
  stats: ProcessingStats
): Promise<void> {
  console.log(`\n[Batch ${Math.floor(stats.processed / 50) + 1}] Processing ${wallets.length} wallets...`)

  // Process wallets in parallel (batch of 50)
  const results = await Promise.allSettled(
    wallets.map(async (wallet) => {
      const aggregateStats = await fetchWalletAggregateStats(wallet)

      if (!aggregateStats) {
        return null // No trading activity
      }

      await saveWalletScore(aggregateStats)
      return aggregateStats
    })
  )

  // Count successes and failures
  for (const result of results) {
    stats.processed++

    if (result.status === 'fulfilled' && result.value) {
      stats.succeeded++
    } else {
      stats.failed++
    }
  }

  // Print progress
  const elapsed = Date.now() - stats.startTime
  const rate = stats.processed / (elapsed / 1000)
  const remaining = stats.totalWallets - stats.processed
  const eta = remaining / rate

  console.log(`📊 Progress: ${stats.processed}/${stats.totalWallets} (${((stats.processed / stats.totalWallets) * 100).toFixed(1)}%)`)
  console.log(`   ✅ Succeeded: ${stats.succeeded}`)
  console.log(`   ❌ Failed: ${stats.failed}`)
  console.log(`   📈 Rate: ${rate.toFixed(1)} wallets/sec`)
  console.log(`   ⏱️  Elapsed: ${formatDuration(elapsed)}`)
  console.log(`   ⏳ ETA: ${formatDuration(eta * 1000)}`)
}

// ============================================================================
// Main Pipeline
// ============================================================================

async function calculateAggregateScores(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('     AGGREGATE WALLET SCORING (FULL DISTRIBUTION)         ')
  console.log('═══════════════════════════════════════════════════════════\n')

  const stats: ProcessingStats = {
    totalWallets: 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
    startTime: Date.now(),
  }

  // Fetch all discovered wallets
  console.log('📡 Fetching discovered wallets from Supabase...')

  const { data: wallets, error } = await supabase
    .from('discovered_wallets')
    .select('wallet_address')
    .order('discovered_at', { ascending: false })

  if (error) {
    throw new Error(`Failed to fetch wallets: ${error.message}`)
  }

  if (!wallets || wallets.length === 0) {
    console.log('❌ No wallets found in discovered_wallets table')
    return
  }

  stats.totalWallets = wallets.length
  console.log(`✅ Found ${stats.totalWallets.toLocaleString()} wallets to process\n`)

  console.log('🔄 Processing in batches of 50...\n')

  // Process in batches of 50
  const BATCH_SIZE = 50

  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    const batch = wallets.slice(i, i + BATCH_SIZE)
    const addresses = batch.map((w) => w.wallet_address)

    await processBatch(addresses, stats)

    // Small delay between batches to avoid rate limiting
    if (i + BATCH_SIZE < wallets.length) {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }

  // Final summary
  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('                     SUMMARY                               ')
  console.log('═══════════════════════════════════════════════════════════\n')

  const elapsed = Date.now() - stats.startTime
  const successRate = ((stats.succeeded / stats.totalWallets) * 100).toFixed(1)

  console.log(`✅ Total wallets processed: ${stats.totalWallets.toLocaleString()}`)
  console.log(`✅ Successfully scored: ${stats.succeeded.toLocaleString()} (${successRate}%)`)
  console.log(`⚠️  Failed: ${stats.failed.toLocaleString()}`)
  console.log(`⏱️  Total time: ${formatDuration(elapsed)}`)

  console.log('\n📊 Next steps:')
  console.log('   1. Verify distribution: SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY omega_net) FROM wallet_scores')
  console.log('   2. Calculate percentiles for all wallets')
  console.log('   3. Use for crowd vs elite divergence signals\n')
}

// ============================================================================
// Utilities
// ============================================================================

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

// ============================================================================
// Entry Point
// ============================================================================

async function main() {
  await calculateAggregateScores()
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
