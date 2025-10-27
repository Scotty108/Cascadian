#!/usr/bin/env npx tsx

/**
 * Generate Staged Leaderboard
 *
 * Uses ONLY audited_wallet_pnl.json as P&L source.
 * Creates ranked leaderboard + human-readable summaries.
 * NO DB writes. NO wallet_scores computation.
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import * as fs from 'fs'

interface AuditedWalletPnL {
  wallet: string
  realized_pnl_usd: number
  resolved_conditions_covered: number
  total_conditions_seen: number
  coverage_pct: number
}

interface LeaderboardEntry {
  rank: number
  wallet_address: string
  realized_pnl_usd: number
  coverage_pct: number
}

interface WalletSummary {
  wallet_address: string
  summary: string
}

async function generateStagedLeaderboard() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('          GENERATING STAGED LEADERBOARD                    ')
  console.log('═══════════════════════════════════════════════════════════\n')

  // Step 1: Load audited_wallet_pnl.json (ONLY approved source)
  console.log('📊 Loading audited_wallet_pnl.json (authoritative source)...\n')

  const auditedPnL: AuditedWalletPnL[] = JSON.parse(
    fs.readFileSync('audited_wallet_pnl.json', 'utf-8')
  )

  console.log(`✅ Loaded ${auditedPnL.length} wallets with audited P&L\n`)

  // Step 2: Sort by realized_pnl_usd descending
  console.log('📊 Sorting wallets by realized P&L (descending)...\n')

  const sortedWallets = [...auditedPnL].sort(
    (a, b) => b.realized_pnl_usd - a.realized_pnl_usd
  )

  // Step 3: Build ranked leaderboard
  const leaderboard: LeaderboardEntry[] = sortedWallets.map((wallet, index) => ({
    rank: index + 1,
    wallet_address: wallet.wallet,
    realized_pnl_usd: wallet.realized_pnl_usd,
    coverage_pct: wallet.coverage_pct,
  }))

  // Step 4: Build human-readable summaries
  const summaries: WalletSummary[] = sortedWallets.map((wallet) => {
    const pnl = wallet.realized_pnl_usd
    const coverage = wallet.coverage_pct
    const walletShort = wallet.wallet.substring(0, 10) + '...'

    let profitDesc = ''
    if (pnl > 0) {
      profitDesc = `$${pnl.toFixed(2)} realized profit`
    } else if (pnl < 0) {
      profitDesc = `$${Math.abs(pnl).toFixed(2)} realized loss`
    } else {
      profitDesc = 'break-even'
    }

    return {
      wallet_address: wallet.wallet,
      summary: `Wallet ${walletShort} has ${profitDesc} across ${coverage.toFixed(2)}% of resolved markets we can currently verify.`,
    }
  })

  // Display leaderboard
  console.log('═══════════════════════════════════════════════════════════')
  console.log('                 STAGED LEADERBOARD                        ')
  console.log('═══════════════════════════════════════════════════════════\n')

  console.log('Rank | Wallet Address                              | Realized P&L | Coverage')
  console.log('─────┼─────────────────────────────────────────────┼──────────────┼─────────')

  leaderboard.forEach((entry) => {
    const rank = entry.rank.toString().padStart(4)
    const wallet = entry.wallet_address.substring(0, 42).padEnd(42)
    const pnl = `$${entry.realized_pnl_usd.toFixed(2)}`.padStart(12)
    const coverage = `${entry.coverage_pct.toFixed(2)}%`.padStart(8)

    console.log(`${rank} | ${wallet} | ${pnl} | ${coverage}`)
  })

  console.log('\n═══════════════════════════════════════════════════════════')
  console.log(`Total Wallets: ${leaderboard.length}`)
  console.log(`Total Realized P&L: $${leaderboard.reduce((sum, e) => sum + e.realized_pnl_usd, 0).toFixed(2)}`)
  console.log(`Average Coverage: ${(leaderboard.reduce((sum, e) => sum + e.coverage_pct, 0) / leaderboard.length).toFixed(2)}%`)
  console.log('═══════════════════════════════════════════════════════════\n')

  // Display summaries
  console.log('═══════════════════════════════════════════════════════════')
  console.log('              WALLET SUMMARIES (HUMAN-READABLE)            ')
  console.log('═══════════════════════════════════════════════════════════\n')

  summaries.forEach((summary, i) => {
    console.log(`[${i + 1}] ${summary.summary}`)
  })

  console.log('\n═══════════════════════════════════════════════════════════\n')

  // Save outputs
  console.log('💾 Saving staged outputs...\n')

  fs.writeFileSync(
    'staged_leaderboard.json',
    JSON.stringify(leaderboard, null, 2)
  )
  console.log('✅ Saved: staged_leaderboard.json')

  fs.writeFileSync(
    'staged_wallet_summaries.json',
    JSON.stringify(summaries, null, 2)
  )
  console.log('✅ Saved: staged_wallet_summaries.json\n')

  // Final checklist
  console.log('═══════════════════════════════════════════════════════════')
  console.log('                   COMPLIANCE CHECKLIST                    ')
  console.log('═══════════════════════════════════════════════════════════\n')

  console.log('✅ Used ONLY audited_wallet_pnl.json as P&L source')
  console.log('✅ Never referenced pnl_net, pnl_gross, or old "$563K" data')
  console.log('✅ Every P&L shown with coverage_pct (coverage contract)')
  console.log('✅ No P&L invented for wallets not in audited file')
  console.log('✅ NO database writes performed')
  console.log('✅ NO wallet_scores computation')
  console.log('✅ Outputs staged for review only\n')

  console.log('📋 Generated Files:')
  console.log('   - staged_leaderboard.json (ranked by realized P&L)')
  console.log('   - staged_wallet_summaries.json (human-readable)\n')

  console.log('⏸️  Awaiting approval before any production writes.\n')
  console.log('═══════════════════════════════════════════════════════════\n')
}

generateStagedLeaderboard()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
