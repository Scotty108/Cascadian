#!/usr/bin/env tsx
/**
 * Export Current Wallets (READ-ONLY)
 *
 * PURPOSE:
 * Export all wallet addresses currently in trades_raw to a text file.
 * One wallet per line for easy comparison with discovered wallets.
 *
 * OUTPUT:
 * - runtime/current_wallets.txt (one wallet per line)
 * - runtime/current_wallets_stats.json (summary statistics)
 *
 * USAGE:
 * npx tsx scripts/export-current-wallets.ts
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import * as fs from 'fs'
import { clickhouse } from '@/lib/clickhouse/client'

const OUTPUT_FILE = resolve(process.cwd(), 'runtime/current_wallets.txt')
const STATS_FILE = resolve(process.cwd(), 'runtime/current_wallets_stats.json')

interface WalletStats {
  wallet_address: string
  trade_count: string
  total_volume: string
  first_trade: string
  last_trade: string
}

async function exportCurrentWallets() {
  console.log('📤 Exporting Current Wallets (READ-ONLY)')
  console.log(`   Output: ${OUTPUT_FILE}`)
  console.log(`   Stats: ${STATS_FILE}\n`)

  try {
    // Query all distinct wallets with stats
    console.log('   Querying ClickHouse for wallets...')
    const result = await clickhouse.query({
      query: `
        SELECT
          wallet_address,
          count() as trade_count,
          sum(usd_value) as total_volume,
          min(timestamp) as first_trade,
          max(timestamp) as last_trade
        FROM trades_raw
        GROUP BY wallet_address
        ORDER BY total_volume DESC
      `,
      format: 'JSONEachRow'
    })

    const wallets = await result.json<WalletStats>()

    console.log(`   Found ${wallets.length} wallets\n`)

    // Create runtime directory if needed
    const runtimeDir = resolve(process.cwd(), 'runtime')
    if (!fs.existsSync(runtimeDir)) {
      fs.mkdirSync(runtimeDir, { recursive: true })
    }

    // Write wallet addresses to text file (one per line)
    console.log('   Writing wallet addresses...')
    const walletAddresses = wallets.map(w => w.wallet_address.toLowerCase())
    fs.writeFileSync(OUTPUT_FILE, walletAddresses.join('\n') + '\n')

    // Write detailed stats to JSON
    console.log('   Writing statistics...')
    const stats = {
      total_wallets: wallets.length,
      exported_at: new Date().toISOString(),
      top_10_by_volume: wallets.slice(0, 10).map(w => ({
        wallet: w.wallet_address,
        trade_count: parseInt(w.trade_count),
        total_volume: parseFloat(w.total_volume),
        first_trade: w.first_trade,
        last_trade: w.last_trade
      })),
      volume_distribution: {
        total_volume: wallets.reduce((sum, w) => sum + parseFloat(w.total_volume), 0),
        avg_volume: wallets.reduce((sum, w) => sum + parseFloat(w.total_volume), 0) / wallets.length,
        median_volume: parseFloat(wallets[Math.floor(wallets.length / 2)]?.total_volume || '0')
      },
      trade_distribution: {
        total_trades: wallets.reduce((sum, w) => sum + parseInt(w.trade_count), 0),
        avg_trades: wallets.reduce((sum, w) => sum + parseInt(w.trade_count), 0) / wallets.length,
        median_trades: parseInt(wallets[Math.floor(wallets.length / 2)]?.trade_count || '0')
      }
    }

    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2))

    // Final summary
    console.log('\n═══════════════════════════════════════════════════════════')
    console.log('✅ Export Complete')
    console.log('═══════════════════════════════════════════════════════════')
    console.log(`   Total wallets: ${stats.total_wallets.toLocaleString()}`)
    console.log(`   Total volume: $${stats.volume_distribution.total_volume.toLocaleString(undefined, { maximumFractionDigits: 0 })}`)
    console.log(`   Total trades: ${stats.trade_distribution.total_trades.toLocaleString()}`)
    console.log(`   Avg trades/wallet: ${stats.trade_distribution.avg_trades.toFixed(1)}`)
    console.log(`   Avg volume/wallet: $${stats.volume_distribution.avg_volume.toLocaleString(undefined, { maximumFractionDigits: 0 })}`)
    console.log('')
    console.log(`   Output: ${OUTPUT_FILE}`)
    console.log(`   Stats: ${STATS_FILE}`)
    console.log('═══════════════════════════════════════════════════════════\n')

    return {
      totalWallets: stats.total_wallets,
      outputFile: OUTPUT_FILE,
      statsFile: STATS_FILE
    }

  } catch (error) {
    console.error('❌ Export failed:', error)
    throw error
  }
}

// Auto-execute
if (require.main === module || import.meta.url === `file://${process.argv[1]}`) {
  exportCurrentWallets().catch((error) => {
    console.error('❌ Fatal error:', error)
    process.exit(1)
  })
}

export { exportCurrentWallets }
