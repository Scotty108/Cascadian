import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'
import { refreshMarketSII } from '@/lib/metrics/market-sii'
import { calculateWalletOmegaScore } from '@/lib/metrics/omega-from-goldsky'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Continuous SII Update Script
 *
 * This script continuously updates:
 * 1. Wallet Omega scores for active traders
 * 2. Market SII signals for active markets
 *
 * Can be run as:
 * - Cron job (every hour): npx tsx scripts/continuous-sii-update.ts
 * - Continuous mode: npx tsx scripts/continuous-sii-update.ts --continuous
 * - Triggered by webhooks (when new trades occur)
 *
 * PERFORMANCE:
 * - 500 wallets in batches of 20 = ~2-3 minutes
 * - 100 markets in batches of 5 = ~2-3 minutes
 * - Total cycle time: ~5-6 minutes per run
 *
 * SCALING:
 * - 500 wallets/hour = can handle 500 active wallets with 1-hour refresh
 * - Increase WALLETS_PER_RUN to 1000+ for larger scale
 * - Increase WALLET_BATCH_SIZE to 50+ for faster processing
 * - With 1000 wallets/run, you can handle 1000 active wallets
 */

const UPDATE_INTERVAL_MS = 60 * 60 * 1000 // 1 hour
const CONTINUOUS_MODE = process.argv.includes('--continuous')

// Configurable batch sizes - SCALE THESE UP as needed
const WALLETS_PER_RUN = 500 // Update 500 wallets per hour
const WALLET_BATCH_SIZE = 20 // Process 20 wallets in parallel

// To scale for more wallets, increase these:
// - 1000 wallets: WALLETS_PER_RUN = 1000, WALLET_BATCH_SIZE = 30
// - 2000 wallets: WALLETS_PER_RUN = 2000, WALLET_BATCH_SIZE = 50
// - 5000+ wallets: Use tiered approach (update hot wallets more frequently)

async function updateWalletScores() {
  console.log('\n🔄 Updating Wallet Scores...\n')

  // Get wallets with recent activity (from ClickHouse or positions)
  // For now, get wallets that already have scores (prioritize refresh)
  const { data: wallets } = await supabase
    .from('wallet_scores')
    .select('wallet_address')
    .order('calculated_at', { ascending: true })
    .limit(WALLETS_PER_RUN) // Now updates 500 wallets per run!

  if (!wallets || wallets.length === 0) {
    console.log('   No wallets to update')
    return 0
  }

  console.log(`   Processing ${wallets.length} wallets in batches of ${WALLET_BATCH_SIZE}...`)

  let updated = 0

  // Process in parallel batches instead of one-by-one
  for (let i = 0; i < wallets.length; i += WALLET_BATCH_SIZE) {
    const batch = wallets.slice(i, i + WALLET_BATCH_SIZE)

    const results = await Promise.allSettled(
      batch.map(async (wallet) => {
        const score = await calculateWalletOmegaScore(wallet.wallet_address)

        if (score) {
          await supabase.from('wallet_scores').upsert({
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
          })
          return score
        }
        return null
      })
    )

    // Count successes
    results.forEach((result) => {
      if (result.status === 'fulfilled' && result.value) {
        updated++
      }
    })

    // Progress indicator
    console.log(`   Processed ${Math.min(i + WALLET_BATCH_SIZE, wallets.length)}/${wallets.length}...`)
  }

  console.log(`   ✅ Updated ${updated}/${wallets.length} wallet scores`)
  return updated
}

async function updateMarketSII() {
  console.log('\n🔄 Updating Market SII...\n')

  // Get active markets
  const { data: markets } = await supabase
    .from('markets')
    .select('condition_id, question')
    .eq('active', true)
    .order('volume_24h', { ascending: false })
    .limit(100) // Top 100 markets by volume

  if (!markets || markets.length === 0) {
    console.log('   No active markets to update')
    return 0
  }

  console.log(`   Processing ${markets.length} markets...`)

  // Process in batches of 5 (to avoid rate limits)
  const BATCH_SIZE = 5
  let updated = 0

  for (let i = 0; i < markets.length; i += BATCH_SIZE) {
    const batch = markets.slice(i, i + BATCH_SIZE)

    const results = await Promise.allSettled(
      batch.map((market) => refreshMarketSII(market.condition_id, market.question, true))
    )

    results.forEach((result, idx) => {
      if (result.status === 'fulfilled' && result.value) {
        updated++
        const market = batch[idx]
        const sii = result.value
        const questionPreview = market.question ? market.question.substring(0, 50) : 'Unknown'
        console.log(
          `   ✅ ${questionPreview}... → ${sii.smart_money_side} (Ω ${sii.omega_differential.toFixed(2)})`
        )
      }
    })

    // Small delay between batches
    if (i + BATCH_SIZE < markets.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  console.log(`   ✅ Updated ${updated}/${markets.length} market SII scores`)
  return updated
}

async function runUpdateCycle() {
  const startTime = Date.now()

  console.log('═'.repeat(70))
  console.log('📊 Continuous SII Update - Starting')
  console.log(`⏰ ${new Date().toISOString()}`)
  console.log('═'.repeat(70))

  try {
    // Step 1: Update wallet scores
    const walletsUpdated = await updateWalletScores()

    // Step 2: Update market SII
    const marketsUpdated = await updateMarketSII()

    const duration = ((Date.now() - startTime) / 1000).toFixed(1)

    console.log('\n' + '═'.repeat(70))
    console.log('✅ Update Cycle Complete')
    console.log(`   Duration: ${duration}s`)
    console.log(`   Wallets: ${walletsUpdated} updated`)
    console.log(`   Markets: ${marketsUpdated} updated`)
    console.log('═'.repeat(70))
  } catch (error) {
    console.error('\n❌ Update cycle failed:', error)
  }
}

async function main() {
  if (CONTINUOUS_MODE) {
    console.log('🔄 Running in CONTINUOUS mode')
    console.log(`   Update interval: ${UPDATE_INTERVAL_MS / 1000 / 60} minutes\n`)

    // Run immediately
    await runUpdateCycle()

    // Then run on interval
    setInterval(runUpdateCycle, UPDATE_INTERVAL_MS)
  } else {
    // Single run
    await runUpdateCycle()
    process.exit(0)
  }
}

main()
