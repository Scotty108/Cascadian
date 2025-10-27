#!/usr/bin/env npx tsx

/**
 * Validate Top 50 Wallets - Goldsky vs Enrichment Comparison
 *
 * This script:
 * 1. Takes top 50 wallets from enriched ClickHouse leaderboard
 * 2. Fetches Goldsky PnL for each wallet
 * 3. Applies 13.2399 correction factor + 1e6 decimals
 * 4. Compares our pnl_net vs Goldsky corrected PnL
 * 5. Generates wallet_scores upserts (staged, not executed)
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient as createClickHouseClient } from '@clickhouse/client'
import { fetchWalletPnL } from '../lib/goldsky/client'
import * as fs from 'fs'

const clickhouse = createClickHouseClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
})

const GOLDSKY_PNL_CORRECTION_FACTOR = 13.2399

interface WalletComparison {
  wallet_address: string
  rank: number

  // Our enrichment data
  our_pnl_net: number
  our_trades: number
  our_wins: number
  our_losses: number
  our_win_rate: number

  // Goldsky data (corrected)
  goldsky_pnl_corrected: number
  goldsky_positions: number
  goldsky_wins: number
  goldsky_losses: number
  goldsky_win_rate: number

  // Comparison
  pnl_diff: number
  pnl_diff_pct: number
  match_quality: 'PERFECT' | 'GOOD' | 'FAIR' | 'POOR' | 'NO_DATA'
}

interface WalletScoreUpsert {
  wallet_address: string
  omega_net: number
  total_pnl: number
  total_volume_usd: number
  total_bets: number
  wins: number
  losses: number
  win_rate: number
  last_calculated_at: string
}

async function validateTop50Wallets() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('   VALIDATE TOP 50 WALLETS - GOLDSKY VS ENRICHMENT       ')
  console.log('═══════════════════════════════════════════════════════════\n')

  console.log('📡 Fetching top 50 wallets from enriched ClickHouse leaderboard...\n')

  // Get top 50 wallets by net P&L from enriched trades
  const top50Query = `
    SELECT
      wallet_address,
      COUNT(*) as total_trades,
      SUM(CASE WHEN pnl_net > 0 THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN pnl_net < 0 THEN 1 ELSE 0 END) as losses,
      SUM(pnl_net) as total_pnl_net,
      SUM(CASE WHEN pnl_net > 0 THEN pnl_net ELSE 0 END) as total_wins,
      ABS(SUM(CASE WHEN pnl_net < 0 THEN pnl_net ELSE 0 END)) as total_losses,
      (wins / total_trades) as win_rate
    FROM trades_raw
    WHERE pnl_net != 0
      AND pnl_gross != 0
    GROUP BY wallet_address
    HAVING total_trades >= 5
    ORDER BY total_pnl_net DESC
    LIMIT 50
  `

  const result = await clickhouse.query({
    query: top50Query,
    format: 'JSONEachRow',
  })

  const top50Wallets: any[] = await result.json()

  if (top50Wallets.length === 0) {
    console.log('❌ No enriched wallets found. Wait for Path B to complete enrichment.\n')
    return
  }

  console.log(`✅ Found ${top50Wallets.length} top wallets\n`)
  console.log('🔄 Fetching Goldsky PnL for each wallet...\n')

  const comparisons: WalletComparison[] = []
  const upserts: WalletScoreUpsert[] = []

  let processed = 0

  for (const wallet of top50Wallets) {
    processed++
    const walletAddress = wallet.wallet_address

    console.log(`[${processed}/${top50Wallets.length}] Processing ${walletAddress}...`)

    // Fetch Goldsky PnL
    const goldskyData = await fetchWalletPnL(walletAddress)

    if (!goldskyData || goldskyData.positionCount === 0) {
      console.log(`   ⚠️  No Goldsky data\n`)

      comparisons.push({
        wallet_address: walletAddress,
        rank: processed,
        our_pnl_net: parseFloat(wallet.total_pnl_net),
        our_trades: parseInt(wallet.total_trades),
        our_wins: parseInt(wallet.wins),
        our_losses: parseInt(wallet.losses),
        our_win_rate: parseFloat(wallet.win_rate),
        goldsky_pnl_corrected: 0,
        goldsky_positions: 0,
        goldsky_wins: 0,
        goldsky_losses: 0,
        goldsky_win_rate: 0,
        pnl_diff: parseFloat(wallet.total_pnl_net),
        pnl_diff_pct: 100,
        match_quality: 'NO_DATA',
      })

      continue
    }

    // Apply Goldsky correction
    const goldskyPnlCorrected = goldskyData.totalRealizedPnl / GOLDSKY_PNL_CORRECTION_FACTOR / 1e6

    // Calculate Goldsky wins/losses
    let goldskyWins = 0
    let goldskyLosses = 0
    let goldskyTotalWins = 0
    let goldskyTotalLosses = 0

    for (const pos of goldskyData.positions) {
      const pnl = parseFloat(pos.realizedPnl) / GOLDSKY_PNL_CORRECTION_FACTOR / 1e6
      if (pnl > 0) {
        goldskyWins++
        goldskyTotalWins += pnl
      } else if (pnl < 0) {
        goldskyLosses++
        goldskyTotalLosses += Math.abs(pnl)
      }
    }

    const goldskyWinRate = goldskyWins + goldskyLosses > 0
      ? goldskyWins / (goldskyWins + goldskyLosses)
      : 0

    // Calculate Omega ratio
    const omegaRatio = goldskyTotalLosses > 0
      ? goldskyTotalWins / goldskyTotalLosses
      : goldskyTotalWins > 0 ? 99 : 0

    // Compare
    const ourPnl = parseFloat(wallet.total_pnl_net)
    const pnlDiff = Math.abs(ourPnl - goldskyPnlCorrected)
    const pnlDiffPct = ourPnl !== 0 ? (pnlDiff / Math.abs(ourPnl)) * 100 : 100

    let matchQuality: 'PERFECT' | 'GOOD' | 'FAIR' | 'POOR' | 'NO_DATA'
    if (pnlDiffPct < 1) matchQuality = 'PERFECT'
    else if (pnlDiffPct < 5) matchQuality = 'GOOD'
    else if (pnlDiffPct < 15) matchQuality = 'FAIR'
    else matchQuality = 'POOR'

    console.log(`   Our PnL:     $${ourPnl.toFixed(2)}`)
    console.log(`   Goldsky PnL: $${goldskyPnlCorrected.toFixed(2)}`)
    console.log(`   Diff:        $${pnlDiff.toFixed(2)} (${pnlDiffPct.toFixed(1)}%) - ${matchQuality}\n`)

    comparisons.push({
      wallet_address: walletAddress,
      rank: processed,
      our_pnl_net: ourPnl,
      our_trades: parseInt(wallet.total_trades),
      our_wins: parseInt(wallet.wins),
      our_losses: parseInt(wallet.losses),
      our_win_rate: parseFloat(wallet.win_rate),
      goldsky_pnl_corrected: goldskyPnlCorrected,
      goldsky_positions: goldskyData.positionCount,
      goldsky_wins: goldskyWins,
      goldsky_losses: goldskyLosses,
      goldsky_win_rate: goldskyWinRate,
      pnl_diff: pnlDiff,
      pnl_diff_pct: pnlDiffPct,
      match_quality: matchQuality,
    })

    // Generate wallet_scores upsert
    upserts.push({
      wallet_address: walletAddress,
      omega_net: omegaRatio,
      total_pnl: goldskyPnlCorrected,
      total_volume_usd: parseFloat(wallet.total_wins) + parseFloat(wallet.total_losses),
      total_bets: goldskyData.positionCount,
      wins: goldskyWins,
      losses: goldskyLosses,
      win_rate: goldskyWinRate,
      last_calculated_at: new Date().toISOString(),
    })

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  // Save comparison table
  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('                    COMPARISON TABLE                       ')
  console.log('═══════════════════════════════════════════════════════════\n')

  console.log('Rank | Wallet | Our PnL | Goldsky PnL | Diff % | Match')
  console.log('─'.repeat(70))

  for (const comp of comparisons) {
    const walletShort = comp.wallet_address.substring(0, 10) + '...'
    console.log(
      `${comp.rank.toString().padStart(4)} | ${walletShort.padEnd(13)} | ` +
      `$${comp.our_pnl_net.toFixed(0).padStart(8)} | ` +
      `$${comp.goldsky_pnl_corrected.toFixed(0).padStart(8)} | ` +
      `${comp.pnl_diff_pct.toFixed(1).padStart(5)}% | ${comp.match_quality}`
    )
  }

  // Statistics
  const withData = comparisons.filter(c => c.match_quality !== 'NO_DATA')
  const perfect = comparisons.filter(c => c.match_quality === 'PERFECT').length
  const good = comparisons.filter(c => c.match_quality === 'GOOD').length
  const fair = comparisons.filter(c => c.match_quality === 'FAIR').length
  const poor = comparisons.filter(c => c.match_quality === 'POOR').length
  const noData = comparisons.filter(c => c.match_quality === 'NO_DATA').length

  const avgDiff = withData.length > 0
    ? withData.reduce((sum, c) => sum + c.pnl_diff_pct, 0) / withData.length
    : 0

  console.log('\n' + '═'.repeat(70))
  console.log('                      SUMMARY STATISTICS                   ')
  console.log('═'.repeat(70) + '\n')

  console.log(`Total wallets:        ${comparisons.length}`)
  console.log(`With Goldsky data:    ${withData.length} (${((withData.length / comparisons.length) * 100).toFixed(1)}%)`)
  console.log(`No Goldsky data:      ${noData}\n`)

  console.log('Match Quality:')
  console.log(`  PERFECT (<1%):      ${perfect}`)
  console.log(`  GOOD (<5%):         ${good}`)
  console.log(`  FAIR (<15%):        ${fair}`)
  console.log(`  POOR (>15%):        ${poor}\n`)

  console.log(`Average difference:   ${avgDiff.toFixed(2)}%\n`)

  // Save to files
  console.log('💾 Saving results...\n')

  fs.writeFileSync(
    'validation-comparison-table.json',
    JSON.stringify(comparisons, null, 2)
  )
  console.log('✅ Saved comparison table: validation-comparison-table.json')

  fs.writeFileSync(
    'wallet-scores-upserts-staged.json',
    JSON.stringify(upserts, null, 2)
  )
  console.log('✅ Saved staged upserts: wallet-scores-upserts-staged.json')

  // Generate SQL for manual review
  const sqlStatements = upserts.map(u => {
    return `INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('${u.wallet_address}', ${u.omega_net}, ${u.total_pnl}, ${u.total_volume_usd}, ${u.total_bets}, ${u.wins}, ${u.losses}, ${u.win_rate}, '${u.last_calculated_at}')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;`
  }).join('\n\n')

  fs.writeFileSync('wallet-scores-upserts-staged.sql', sqlStatements)
  console.log('✅ Saved SQL statements: wallet-scores-upserts-staged.sql\n')

  console.log('═'.repeat(70))
  console.log('              VALIDATION COMPLETE - AWAITING GO               ')
  console.log('═'.repeat(70) + '\n')

  console.log('📋 Next steps:')
  console.log('   1. Review validation-comparison-table.json')
  console.log('   2. Review wallet-scores-upserts-staged.json')
  console.log('   3. When ready, tell me to execute the upserts\n')
}

validateTop50Wallets()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
