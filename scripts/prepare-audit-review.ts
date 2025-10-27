#!/usr/bin/env npx tsx

/**
 * Prepare Audit Review Payload
 *
 * Creates a human-reviewable summary of audited wallet P&L.
 * Uses ONLY audited_wallet_pnl.json as P&L source.
 * NO production writes. NO contaminated columns.
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

interface AuditReviewEntry {
  wallet_address: string
  realized_pnl_usd: number
  coverage_percent: number
  total_conditions_traded: number
  resolved_conditions_used: number
  meets_coverage_threshold: boolean // >2%
}

async function prepareAuditReview() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('           PREPARING AUDIT REVIEW PAYLOAD                  ')
  console.log('═══════════════════════════════════════════════════════════\n')

  // Load authoritative P&L from Path B
  console.log('📊 Loading audited_wallet_pnl.json (authoritative source)...\n')

  const auditedPnL: AuditedWalletPnL[] = JSON.parse(
    fs.readFileSync('audited_wallet_pnl.json', 'utf-8')
  )

  console.log(`✅ Loaded ${auditedPnL.length} audited wallets\n`)

  // Coverage threshold
  const COVERAGE_THRESHOLD = 2.0 // 2%

  // Build review payload
  const reviewPayload: AuditReviewEntry[] = []

  console.log('📋 Building review payload...\n')

  for (const wallet of auditedPnL) {
    const meetsThreshold = wallet.coverage_pct >= COVERAGE_THRESHOLD

    reviewPayload.push({
      wallet_address: wallet.wallet,
      realized_pnl_usd: wallet.realized_pnl_usd,
      coverage_percent: wallet.coverage_pct,
      total_conditions_traded: wallet.total_conditions_seen,
      resolved_conditions_used: wallet.resolved_conditions_covered,
      meets_coverage_threshold: meetsThreshold,
    })
  }

  // Display review table
  console.log('═══════════════════════════════════════════════════════════')
  console.log('              AUDIT REVIEW PAYLOAD                         ')
  console.log('═══════════════════════════════════════════════════════════\n')

  console.log('Wallet        | Realized P&L | Coverage | Resolved/Total | Threshold')
  console.log('──────────────┼──────────────┼──────────┼────────────────┼───────────')

  reviewPayload.forEach((entry) => {
    const wallet = entry.wallet_address.substring(0, 13) + '...'
    const pnl = `$${entry.realized_pnl_usd.toFixed(2)}`.padStart(12)
    const coverage = `${entry.coverage_percent.toFixed(2)}%`.padStart(8)
    const resolved = `${entry.resolved_conditions_used}/${entry.total_conditions_traded}`.padStart(14)
    const threshold = entry.meets_coverage_threshold ? '✅ PASS' : '⚠️  BELOW'

    console.log(`${wallet} | ${pnl} | ${coverage} | ${resolved} | ${threshold}`)
  })

  // Summary stats
  const totalPnL = reviewPayload.reduce((sum, e) => sum + e.realized_pnl_usd, 0)
  const meetingThreshold = reviewPayload.filter(e => e.meets_coverage_threshold).length
  const avgCoverage = reviewPayload.reduce((sum, e) => sum + e.coverage_percent, 0) / reviewPayload.length

  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('                    SUMMARY STATISTICS                     ')
  console.log('═══════════════════════════════════════════════════════════\n')

  console.log(`Total Wallets Audited:        ${reviewPayload.length}`)
  console.log(`Meeting Coverage Threshold:   ${meetingThreshold} (${((meetingThreshold / reviewPayload.length) * 100).toFixed(1)}%)`)
  console.log(`Total Realized P&L:           $${totalPnL.toFixed(2)}`)
  console.log(`Average Coverage:             ${avgCoverage.toFixed(2)}%`)
  console.log(`Coverage Threshold:           >${COVERAGE_THRESHOLD}%`)

  console.log('\n📋 Data Source:')
  console.log('   ✅ audited_wallet_pnl.json (Path B audited engine)')
  console.log('   ❌ NOT from ClickHouse pnl_net (contaminated)')
  console.log('   ❌ NOT from Goldsky alone (truncates at 1k positions)')

  console.log('\n🔒 Critical Invariants Applied by Path B:')
  console.log('   1. Shares divided by 128 (ClickHouse scaling fix)')
  console.log('   2. outcomePrices coerced to numbers (resolution detection fix)')
  console.log('   3. Realized P&L at resolution only (no unrealized)')
  console.log('   4. YES/NO inventory netted correctly per market')

  console.log('\n⚠️  Deprecated Data (DO NOT USE):')
  console.log('   - Old ClickHouse pnl_net columns (wrong by 100x+)')
  console.log('   - Old ClickHouse pnl_gross columns (assume every fill wins)')
  console.log('   - Legacy "$563K" leaderboard numbers (completely wrong)')

  // Save review payload
  console.log('\n💾 Saving audit_review_payload.json...\n')

  fs.writeFileSync(
    'audit_review_payload.json',
    JSON.stringify(reviewPayload, null, 2)
  )

  console.log('✅ Review payload saved to audit_review_payload.json')
  console.log('\n📋 Next Steps:')
  console.log('   1. Human review of audit_review_payload.json')
  console.log('   2. NO production writes until approved')
  console.log('   3. NO wallet_scores computation')
  console.log('   4. NO publishing of legacy contaminated numbers')
  console.log('\n═══════════════════════════════════════════════════════════\n')
}

prepareAuditReview()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
