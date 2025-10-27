#!/usr/bin/env npx tsx

/**
 * Build Wallet Leaderboard
 *
 * Combines authoritative P&L from Path B (audited_wallet_pnl.json)
 * with basic activity stats from ClickHouse.
 *
 * DOES NOT compute P&L. DOES NOT touch contaminated columns.
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient as createClickHouseClient } from '@clickhouse/client'
import * as fs from 'fs'

const clickhouse = createClickHouseClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
})

interface AuditedWalletPnL {
  wallet: string
  realized_pnl_usd: number
  resolved_conditions_covered: number
  total_conditions_seen: number
  coverage_pct: number
}

interface WalletActivityStats {
  total_trades: number
  distinct_markets: number
  last_trade_timestamp: string
}

interface LeaderboardEntry {
  wallet: string
  realized_pnl_usd: number
  coverage_pct: number
  total_trades: number
  distinct_markets: number
  last_trade_timestamp: string
  status: 'ok' | 'insufficient_coverage'
}

async function getWalletActivityStats(wallet: string): Promise<WalletActivityStats> {
  const query = `
    SELECT
      COUNT(*) as total_trades,
      COUNT(DISTINCT condition_id) as distinct_markets,
      MAX(timestamp) as last_trade_timestamp
    FROM trades_raw
    WHERE wallet_address = '${wallet}'
  `

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow',
  })

  const data: any[] = await result.json()

  if (data.length === 0) {
    return {
      total_trades: 0,
      distinct_markets: 0,
      last_trade_timestamp: '1970-01-01 00:00:00',
    }
  }

  return {
    total_trades: parseInt(data[0].total_trades),
    distinct_markets: parseInt(data[0].distinct_markets),
    last_trade_timestamp: data[0].last_trade_timestamp,
  }
}

async function buildLeaderboard() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('              BUILDING WALLET LEADERBOARD                  ')
  console.log('═══════════════════════════════════════════════════════════\n')

  // Load authoritative P&L from Path B
  console.log('📊 Loading audited_wallet_pnl.json from Path B...\n')

  const auditedPnL: AuditedWalletPnL[] = JSON.parse(
    fs.readFileSync('audited_wallet_pnl.json', 'utf-8')
  )

  console.log(`✅ Loaded ${auditedPnL.length} wallets with audited P&L\n`)

  // For each wallet, get activity stats from ClickHouse
  console.log('🔄 Fetching activity stats from ClickHouse...\n')

  const leaderboard: LeaderboardEntry[] = []

  for (const wallet of auditedPnL) {
    console.log(`   Processing ${wallet.wallet.substring(0, 10)}...`)

    const activityStats = await getWalletActivityStats(wallet.wallet)

    const status: 'ok' | 'insufficient_coverage' =
      wallet.coverage_pct > 0 ? 'ok' : 'insufficient_coverage'

    leaderboard.push({
      wallet: wallet.wallet,
      realized_pnl_usd: wallet.realized_pnl_usd,
      coverage_pct: wallet.coverage_pct,
      total_trades: activityStats.total_trades,
      distinct_markets: activityStats.distinct_markets,
      last_trade_timestamp: activityStats.last_trade_timestamp,
      status,
    })
  }

  console.log('\n✅ Activity stats fetched for all wallets\n')

  // Sort leaderboard
  // 1. Wallets with status="ok" sorted by realized_pnl_usd descending
  // 2. Wallets with status="insufficient_coverage" at the bottom
  console.log('📊 Sorting leaderboard...\n')

  const okWallets = leaderboard
    .filter(w => w.status === 'ok')
    .sort((a, b) => b.realized_pnl_usd - a.realized_pnl_usd)

  const insufficientWallets = leaderboard
    .filter(w => w.status === 'insufficient_coverage')
    .sort((a, b) => b.realized_pnl_usd - a.realized_pnl_usd)

  const sortedLeaderboard = [...okWallets, ...insufficientWallets]

  // Display leaderboard
  console.log('═══════════════════════════════════════════════════════════')
  console.log('                   WALLET LEADERBOARD                      ')
  console.log('═══════════════════════════════════════════════════════════\n')

  console.log('Rank | Wallet        | P&L (USD) | Cov%  | Trades | Markets | Status')
  console.log('─────┼───────────────┼───────────┼───────┼────────┼─────────┼─────────────────')

  sortedLeaderboard.forEach((entry, i) => {
    const rank = (i + 1).toString().padStart(4)
    const wallet = entry.wallet.substring(0, 13) + '...'
    const pnl = `$${entry.realized_pnl_usd.toFixed(2)}`.padStart(9)
    const coverage = `${entry.coverage_pct.toFixed(2)}%`.padStart(6)
    const trades = entry.total_trades.toString().padStart(6)
    const markets = entry.distinct_markets.toString().padStart(7)
    const status = entry.status === 'ok' ? '✅ OK' : '⚠️  INSUFFICIENT'

    console.log(`${rank} | ${wallet} | ${pnl} | ${coverage} | ${trades} | ${markets} | ${status}`)
  })

  console.log('\n═══════════════════════════════════════════════════════════')
  console.log(`Total wallets: ${sortedLeaderboard.length}`)
  console.log(`Scored (coverage > 0): ${okWallets.length}`)
  console.log(`Insufficient coverage: ${insufficientWallets.length}`)
  console.log('═══════════════════════════════════════════════════════════\n')

  // Save to JSON
  console.log('💾 Saving wallet_leaderboard.json...\n')

  fs.writeFileSync(
    'wallet_leaderboard.json',
    JSON.stringify(sortedLeaderboard, null, 2)
  )

  console.log('✅ Leaderboard saved to wallet_leaderboard.json\n')
  console.log('📋 Summary:')
  console.log(`   - Authoritative P&L from Path B (audited_wallet_pnl.json)`)
  console.log(`   - Activity stats from ClickHouse (no P&L calculation)`)
  console.log(`   - No contaminated columns used (pnl_net, pnl_gross, outcome)`)
  console.log(`   - No database writes performed`)
  console.log(`   - Output: wallet_leaderboard.json (staged only)\n`)
}

buildLeaderboard()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
