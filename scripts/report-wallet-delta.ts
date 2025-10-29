#!/usr/bin/env tsx
/**
 * Report Wallet Delta (READ-ONLY)
 *
 * PURPOSE:
 * Compare discovered wallets from Goldsky against current wallets in database.
 * Identify new wallets that need to be loaded.
 *
 * INPUT:
 * - runtime/discovered_wallets.jsonl (from discover-wallets.ts)
 * - runtime/current_wallets.txt (from export-current-wallets.ts)
 *
 * OUTPUT:
 * - runtime/wallet_discovery_report.json (comparison report)
 * - runtime/new_wallets.jsonl (wallets not yet in database)
 *
 * USAGE:
 * npx tsx scripts/report-wallet-delta.ts
 * npx tsx scripts/report-wallet-delta.ts --discovered=runtime/discovered_wallets.jsonl --out=runtime/wallet_discovery_report.json --new-out=runtime/new_wallets.jsonl
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import * as fs from 'fs'

// Parse command-line arguments
function getArg(flag: string): string | null {
  const arg = process.argv.find(a => a.startsWith(`--${flag}=`))
  return arg ? arg.split('=')[1] : null
}

const DISCOVERED_FILE = getArg('discovered') || resolve(process.cwd(), 'runtime/discovered_wallets.jsonl')
const CURRENT_FILE = getArg('current') || resolve(process.cwd(), 'runtime/current_wallets.txt')
const REPORT_FILE = getArg('out') || resolve(process.cwd(), 'runtime/wallet_discovery_report.json')
const NEW_WALLETS_FILE = getArg('new-out') || resolve(process.cwd(), 'runtime/new_wallets.jsonl')

interface DiscoveredWallet {
  wallet: string
  totalVolume: number
  numTrades: number
  totalPnL: number
}

async function reportWalletDelta() {
  console.log('📊 Wallet Delta Report (READ-ONLY)')
  console.log(`   Discovered: ${DISCOVERED_FILE}`)
  console.log(`   Current:    ${CURRENT_FILE}`)
  console.log(`   Report:     ${REPORT_FILE}\n`)

  // Check files exist
  if (!fs.existsSync(DISCOVERED_FILE)) {
    throw new Error(`Discovered wallets file not found: ${DISCOVERED_FILE}\nRun: npx tsx scripts/discover-wallets.ts`)
  }

  if (!fs.existsSync(CURRENT_FILE)) {
    throw new Error(`Current wallets file not found: ${CURRENT_FILE}\nRun: npx tsx scripts/export-current-wallets.ts`)
  }

  // Load discovered wallets
  console.log('   Loading discovered wallets...')
  const discoveredLines = fs.readFileSync(DISCOVERED_FILE, 'utf-8').split('\n').filter(Boolean)
  const discovered = new Map<string, DiscoveredWallet>()

  for (const line of discoveredLines) {
    try {
      const wallet = JSON.parse(line) as DiscoveredWallet
      discovered.set(wallet.wallet.toLowerCase(), wallet)
    } catch (error) {
      console.warn(`⚠️  Failed to parse line: ${line}`)
    }
  }

  console.log(`   Loaded ${discovered.size} discovered wallets`)

  // Load current wallets
  console.log('   Loading current wallets...')
  const currentWallets = new Set<string>(
    fs.readFileSync(CURRENT_FILE, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map(w => w.toLowerCase().trim())
  )

  console.log(`   Loaded ${currentWallets.size} current wallets\n`)

  // Calculate delta
  console.log('   Calculating delta...')
  const newWallets: DiscoveredWallet[] = []
  const existingWallets: DiscoveredWallet[] = []

  for (const [address, wallet] of discovered) {
    if (currentWallets.has(address)) {
      existingWallets.push(wallet)
    } else {
      newWallets.push(wallet)
    }
  }

  // Sort new wallets by volume descending
  newWallets.sort((a, b) => b.totalVolume - a.totalVolume)

  console.log(`   Found ${newWallets.length} new wallets`)
  console.log(`   Found ${existingWallets.length} existing wallets\n`)

  // Calculate aggregate stats for new wallets
  const newWalletsStats = {
    total_volume: newWallets.reduce((sum, w) => sum + w.totalVolume, 0),
    total_trades: newWallets.reduce((sum, w) => sum + w.numTrades, 0),
    avg_volume: newWallets.length > 0 ? newWallets.reduce((sum, w) => sum + w.totalVolume, 0) / newWallets.length : 0,
    avg_trades: newWallets.length > 0 ? newWallets.reduce((sum, w) => sum + w.numTrades, 0) / newWallets.length : 0
  }

  // Create report
  const report = {
    generated_at: new Date().toISOString(),
    existing_count: currentWallets.size,
    discovered_count: discovered.size,
    new_count: newWallets.length,
    overlap_count: existingWallets.length,
    coverage_pct: ((existingWallets.length / discovered.size) * 100).toFixed(2),

    new_wallets_stats: newWalletsStats,

    top_10_new_by_volume: newWallets.slice(0, 10).map(w => ({
      wallet: w.wallet,
      totalVolume: w.totalVolume,
      numTrades: w.numTrades,
      totalPnL: w.totalPnL
    })),

    volume_distribution_new: {
      top_10_pct: newWallets.slice(0, Math.ceil(newWallets.length * 0.1)).reduce((sum, w) => sum + w.totalVolume, 0) / newWalletsStats.total_volume * 100,
      top_25_pct: newWallets.slice(0, Math.ceil(newWallets.length * 0.25)).reduce((sum, w) => sum + w.totalVolume, 0) / newWalletsStats.total_volume * 100,
      top_50_pct: newWallets.slice(0, Math.ceil(newWallets.length * 0.5)).reduce((sum, w) => sum + w.totalVolume, 0) / newWalletsStats.total_volume * 100
    },

    files: {
      discovered: DISCOVERED_FILE,
      current: CURRENT_FILE,
      new_wallets: NEW_WALLETS_FILE
    }
  }

  // Write report
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2))

  // Write new wallets to JSONL
  if (newWallets.length > 0) {
    const newWalletsContent = newWallets.map(w => JSON.stringify(w)).join('\n') + '\n'
    fs.writeFileSync(NEW_WALLETS_FILE, newWalletsContent)
  }

  // Print summary
  console.log('═══════════════════════════════════════════════════════════')
  console.log('📊 Wallet Delta Report')
  console.log('═══════════════════════════════════════════════════════════')
  console.log(`   Existing wallets:  ${report.existing_count.toLocaleString()}`)
  console.log(`   Discovered wallets: ${report.discovered_count.toLocaleString()}`)
  console.log(`   NEW wallets:       ${report.new_count.toLocaleString()}`)
  console.log(`   Overlap:           ${report.overlap_count.toLocaleString()} (${report.coverage_pct}%)`)
  console.log('')
  console.log(`   New wallets aggregate:`)
  console.log(`   - Total volume: $${newWalletsStats.total_volume.toLocaleString(undefined, { maximumFractionDigits: 0 })}`)
  console.log(`   - Total trades: ${newWalletsStats.total_trades.toLocaleString()}`)
  console.log(`   - Avg volume:   $${newWalletsStats.avg_volume.toLocaleString(undefined, { maximumFractionDigits: 0 })}`)
  console.log(`   - Avg trades:   ${newWalletsStats.avg_trades.toFixed(1)}`)
  console.log('')
  console.log(`   Volume concentration (new wallets):`)
  console.log(`   - Top 10%: ${report.volume_distribution_new.top_10_pct.toFixed(1)}% of volume`)
  console.log(`   - Top 25%: ${report.volume_distribution_new.top_25_pct.toFixed(1)}% of volume`)
  console.log(`   - Top 50%: ${report.volume_distribution_new.top_50_pct.toFixed(1)}% of volume`)
  console.log('')

  if (newWallets.length > 0) {
    console.log(`   Top 10 new wallets by volume:`)
    report.top_10_new_by_volume.forEach((w, idx) => {
      console.log(`   ${idx + 1}. ${w.wallet.slice(0, 10)}... - $${w.totalVolume.toLocaleString()} volume, ${w.numTrades} trades`)
    })
    console.log('')
  }

  console.log(`   Report saved to: ${REPORT_FILE}`)
  if (newWallets.length > 0) {
    console.log(`   New wallets saved to: ${NEW_WALLETS_FILE}`)
  }
  console.log('═══════════════════════════════════════════════════════════\n')

  return report
}

// Auto-execute
if (require.main === module || import.meta.url === `file://${process.argv[1]}`) {
  reportWalletDelta().catch((error) => {
    console.error('❌ Fatal error:', error)
    process.exit(1)
  })
}

export { reportWalletDelta }
