/**
 * Bulk Sync Omega Scores
 *
 * Discovers active wallets from Goldsky PnL subgraph and calculates
 * omega scores for all of them, then syncs to database.
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'
import { calculateWalletOmegaScore } from '@/lib/metrics/omega-from-goldsky'
import { pnlClient } from '@/lib/goldsky/client'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Query to get all unique wallet addresses from Goldsky PnL subgraph
const DISCOVER_WALLETS_QUERY = /* GraphQL */ `
  query DiscoverActiveWallets($skip: Int!) {
    userPositions(
      first: 1000
      skip: $skip
      orderBy: realizedPnl
      orderDirection: desc
    ) {
      user
      realizedPnl
    }
  }
`

async function discoverActiveWallets(): Promise<string[]> {
  console.log('🔍 Discovering active wallets from Goldsky...\n')

  const wallets = new Set<string>()
  let skip = 0
  let hasMore = true

  while (hasMore && skip < 50000) { // Cap at 50k to get plenty of wallets
    try {
      const data: any = await pnlClient.request(DISCOVER_WALLETS_QUERY, { skip })

      if (data.userPositions && data.userPositions.length > 0) {
        data.userPositions.forEach((pos: any) => {
          if (pos.user) {
            wallets.add(pos.user.toLowerCase())
          }
        })

        console.log(`  Found ${data.userPositions.length} positions (skip: ${skip}, total unique wallets: ${wallets.size})`)

        skip += 1000

        // If we got less than 1000, we're done
        if (data.userPositions.length < 1000) {
          hasMore = false
        }
      } else {
        hasMore = false
      }
    } catch (error) {
      console.error(`  ❌ Error fetching wallets at skip ${skip}:`, error)
      hasMore = false
    }
  }

  console.log(`\n✅ Discovered ${wallets.size} unique wallets\n`)
  return Array.from(wallets)
}

async function syncWalletScore(wallet: string, index: number, total: number): Promise<boolean> {
  try {
    console.log(`[${index + 1}/${total}] Processing ${wallet}...`)

    // Calculate Omega score
    const score = await calculateWalletOmegaScore(wallet)

    if (!score) {
      console.log(`  ⚠️  No PnL data found`)
      return false
    }

    // Only sync if meets minimum trades threshold
    if (!score.meets_minimum_trades) {
      console.log(`  ⏭️  Skipped (only ${score.closed_positions} trades)`)
      return false
    }

    // Save to database
    const { error } = await supabase.from('wallet_scores').upsert(
      {
        wallet_address: score.wallet_address,
        omega_ratio: score.omega_ratio,
        omega_momentum: score.omega_momentum,
        total_positions: score.total_positions,
        closed_positions: score.closed_positions,
        total_pnl: score.total_pnl,
        total_gains: score.total_gains,
        total_losses: score.total_losses,
        win_rate: score.win_rate,
        avg_gain: score.avg_gain,
        avg_loss: score.avg_loss,
        momentum_direction: score.momentum_direction,
        grade: score.grade,
        meets_minimum_trades: score.meets_minimum_trades,
        calculated_at: new Date().toISOString(),
      },
      {
        onConflict: 'wallet_address',
      }
    )

    if (error) {
      console.log(`  ❌ Database error: ${error.message}`)
      return false
    }

    console.log(`  ✅ [${score.grade}] Omega: ${score.omega_ratio.toFixed(2)} | PnL: $${score.total_pnl.toLocaleString()} | ${score.closed_positions} trades`)
    return true

  } catch (error) {
    console.log(`  ❌ Error: ${(error as Error).message}`)
    return false
  }
}

async function bulkSyncOmegaScores() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('           BULK OMEGA SCORE SYNC TO DATABASE              ')
  console.log('═══════════════════════════════════════════════════════════\n')

  const startTime = Date.now()

  // Step 1: Discover wallets
  const wallets = await discoverActiveWallets()

  if (wallets.length === 0) {
    console.log('❌ No wallets found!')
    return
  }

  // Step 2: Sync omega scores
  console.log('📊 Calculating and syncing omega scores...\n')

  let processed = 0
  let synced = 0
  let skipped = 0
  let errors = 0

  // Process in batches with delay to avoid rate limits
  const batchSize = 10

  for (let i = 0; i < wallets.length; i += batchSize) {
    const batch = wallets.slice(i, i + batchSize)

    const results = await Promise.all(
      batch.map((wallet, batchIndex) =>
        syncWalletScore(wallet, i + batchIndex, wallets.length)
      )
    )

    results.forEach(success => {
      processed++
      if (success) {
        synced++
      } else {
        skipped++
      }
    })

    // Small delay between batches
    if (i + batchSize < wallets.length) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }

  // Step 3: Show summary
  const duration = ((Date.now() - startTime) / 1000).toFixed(1)

  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('                      SYNC COMPLETE                        ')
  console.log('═══════════════════════════════════════════════════════════\n')
  console.log(`⏱️  Duration: ${duration}s`)
  console.log(`📊 Processed: ${processed} wallets`)
  console.log(`✅ Synced: ${synced} wallets`)
  console.log(`⏭️  Skipped: ${skipped} wallets (< 5 trades)`)
  console.log(`❌ Errors: ${errors} wallets`)

  // Show database stats
  console.log('\n📋 Database Statistics:\n')

  const { data: stats } = await supabase
    .from('wallet_scores')
    .select('grade, closed_positions, omega_ratio, meets_minimum_trades')

  if (stats) {
    const total = stats.length
    const qualified = stats.filter(s => s.meets_minimum_trades).length
    const gradeDistribution = stats.reduce((acc, s) => {
      acc[s.grade] = (acc[s.grade] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    console.log(`   Total wallets: ${total}`)
    console.log(`   Qualified (5+ trades): ${qualified}`)
    console.log(`\n   Grade Distribution:`)
    Object.entries(gradeDistribution)
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([grade, count]) => {
        console.log(`     ${grade} Grade: ${count}`)
      })

    const avgOmega = stats.reduce((sum, s) => sum + parseFloat(s.omega_ratio || '0'), 0) / stats.length
    console.log(`\n   Average Omega Ratio: ${avgOmega.toFixed(2)}`)
  }

  // Show top 10
  console.log('\n🏆 Top 10 Wallets:\n')
  const { data: topWallets } = await supabase
    .from('wallet_scores')
    .select('wallet_address, grade, omega_ratio, total_pnl, closed_positions')
    .eq('meets_minimum_trades', true)
    .order('omega_ratio', { ascending: false })
    .limit(10)

  if (topWallets) {
    topWallets.forEach((w, i) => {
      console.log(`${i + 1}. [${w.grade}] ${w.wallet_address.substring(0, 12)}...`)
      console.log(`   Omega: ${parseFloat(w.omega_ratio).toFixed(2)} | PnL: $${parseFloat(w.total_pnl).toLocaleString()} | ${w.closed_positions} trades`)
    })
  }

  console.log('\n✅ Bulk sync complete!\n')
}

// Run the sync
bulkSyncOmegaScores()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
