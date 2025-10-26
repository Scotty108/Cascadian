import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

/**
 * ============================================================================
 * TIER 1 METRICS - DEMO QUERIES
 * ============================================================================
 *
 * Demonstrates common query patterns for Tier 1 metrics.
 * Use this as a reference for building API endpoints and dashboards.
 * ============================================================================
 */

type TimeWindow = '30d' | '90d' | '180d' | 'lifetime'

const WINDOW_ENUM: Record<TimeWindow, number> = {
  '30d': 1,
  '90d': 2,
  '180d': 3,
  'lifetime': 4,
}

/**
 * Query 1: Top Performers by Omega
 */
async function topPerformersByOmega(window: TimeWindow = '30d', limit = 50) {
  console.log(`\n📊 Top ${limit} Performers by Omega (${window} window):\n`)

  const query = `
    SELECT
      wallet_address,
      metric_2_omega_net as omega,
      metric_9_net_pnl_usd as net_pnl,
      metric_12_hit_rate * 100 as hit_rate_pct,
      metric_13_avg_win_usd as avg_win,
      metric_14_avg_loss_usd as avg_loss,
      metric_22_resolved_bets as bets
    FROM wallet_metrics_complete
    WHERE window = ${WINDOW_ENUM[window]}
      AND metric_22_resolved_bets >= 10
    ORDER BY metric_2_omega_net DESC
    LIMIT ${limit}
  `

  const result = await clickhouse.query({ query, format: 'JSONEachRow' })
  const data = await result.json() as any[]

  console.log('Rank | Wallet (last 8) | Omega  | Net PnL  | Hit % | Avg Win | Avg Loss | Bets')
  console.log('-'.repeat(90))

  data.forEach((row, idx) => {
    const wallet = row.wallet_address.slice(-8)
    const omega = row.omega?.toFixed(2) || 'N/A'
    const pnl = `$${row.net_pnl?.toLocaleString(undefined, { maximumFractionDigits: 0 }) || '0'}`
    const hitRate = row.hit_rate_pct?.toFixed(1) || '0'
    const avgWin = `$${row.avg_win?.toFixed(0) || '0'}`
    const avgLoss = `$${row.avg_loss?.toFixed(0) || '0'}`

    console.log(
      `${(idx + 1).toString().padStart(4)} | ${wallet} | ${omega.padStart(6)} | ${pnl.padStart(8)} | ${hitRate.padStart(5)} | ${avgWin.padStart(7)} | ${avgLoss.padStart(8)} | ${row.bets.toString().padStart(4)}`
    )
  })

  return data
}

/**
 * Query 2: Profitable Wallets
 */
async function profitableWallets(window: TimeWindow = 'lifetime', minBets = 20) {
  console.log(`\n💰 Profitable Wallets (${window} window, min ${minBets} bets):\n`)

  const query = `
    SELECT
      wallet_address,
      metric_2_omega_net as omega,
      metric_9_net_pnl_usd as net_pnl,
      metric_15_ev_per_bet_mean as ev_per_bet,
      metric_22_resolved_bets as bets
    FROM wallet_metrics_complete
    WHERE window = ${WINDOW_ENUM[window]}
      AND metric_2_omega_net > 1.0
      AND metric_22_resolved_bets >= ${minBets}
    ORDER BY metric_9_net_pnl_usd DESC
    LIMIT 50
  `

  const result = await clickhouse.query({ query, format: 'JSONEachRow' })
  const data = await result.json() as any[]

  console.log(`Found ${data.length} profitable wallets\n`)
  console.log('Rank | Wallet (last 8) | Omega | Net PnL    | EV/Bet  | Bets')
  console.log('-'.repeat(70))

  data.slice(0, 20).forEach((row, idx) => {
    const wallet = row.wallet_address.slice(-8)
    const omega = row.omega?.toFixed(2) || 'N/A'
    const pnl = `$${row.net_pnl?.toLocaleString(undefined, { maximumFractionDigits: 0 }) || '0'}`
    const evPerBet = `$${row.ev_per_bet?.toFixed(2) || '0'}`

    console.log(
      `${(idx + 1).toString().padStart(4)} | ${wallet} | ${omega.padStart(5)} | ${pnl.padStart(10)} | ${evPerBet.padStart(7)} | ${row.bets.toString().padStart(4)}`
    )
  })

  return data
}

/**
 * Query 3: High Accuracy Traders
 */
async function highAccuracyTraders(window: TimeWindow = '90d', minHitRate = 0.60) {
  console.log(`\n🎯 High Accuracy Traders (${window} window, hit rate >= ${(minHitRate * 100).toFixed(0)}%):\n`)

  const query = `
    SELECT
      wallet_address,
      metric_12_hit_rate * 100 as hit_rate_pct,
      metric_2_omega_net as omega,
      metric_9_net_pnl_usd as net_pnl,
      metric_22_resolved_bets as bets
    FROM wallet_metrics_complete
    WHERE window = ${WINDOW_ENUM[window]}
      AND metric_12_hit_rate >= ${minHitRate}
      AND metric_22_resolved_bets >= 15
    ORDER BY metric_12_hit_rate DESC
    LIMIT 50
  `

  const result = await clickhouse.query({ query, format: 'JSONEachRow' })
  const data = await result.json() as any[]

  console.log(`Found ${data.length} high accuracy traders\n`)
  console.log('Rank | Wallet (last 8) | Hit %  | Omega | Net PnL  | Bets')
  console.log('-'.repeat(65))

  data.slice(0, 20).forEach((row, idx) => {
    const wallet = row.wallet_address.slice(-8)
    const hitRate = row.hit_rate_pct?.toFixed(1) || '0'
    const omega = row.omega?.toFixed(2) || 'N/A'
    const pnl = `$${row.net_pnl?.toLocaleString(undefined, { maximumFractionDigits: 0 }) || '0'}`

    console.log(
      `${(idx + 1).toString().padStart(4)} | ${wallet} | ${hitRate.padStart(5)}% | ${omega.padStart(5)} | ${pnl.padStart(8)} | ${row.bets.toString().padStart(4)}`
    )
  })

  return data
}

/**
 * Query 4: Best EV per Bet
 */
async function bestEVPerBet(window: TimeWindow = '180d', minBets = 25) {
  console.log(`\n⚡ Best EV per Bet (${window} window, min ${minBets} bets):\n`)

  const query = `
    SELECT
      wallet_address,
      metric_15_ev_per_bet_mean as ev_per_bet,
      metric_2_omega_net as omega,
      metric_9_net_pnl_usd as net_pnl,
      metric_22_resolved_bets as bets
    FROM wallet_metrics_complete
    WHERE window = ${WINDOW_ENUM[window]}
      AND metric_22_resolved_bets >= ${minBets}
    ORDER BY metric_15_ev_per_bet_mean DESC
    LIMIT 100
  `

  const result = await clickhouse.query({ query, format: 'JSONEachRow' })
  const data = await result.json() as any[]

  console.log(`Found ${data.length} wallets\n`)
  console.log('Rank | Wallet (last 8) | EV/Bet   | Omega | Net PnL  | Bets')
  console.log('-'.repeat(68))

  data.slice(0, 20).forEach((row, idx) => {
    const wallet = row.wallet_address.slice(-8)
    const evPerBet = `$${row.ev_per_bet?.toFixed(2) || '0'}`
    const omega = row.omega?.toFixed(2) || 'N/A'
    const pnl = `$${row.net_pnl?.toLocaleString(undefined, { maximumFractionDigits: 0 }) || '0'}`

    console.log(
      `${(idx + 1).toString().padStart(4)} | ${wallet} | ${evPerBet.padStart(8)} | ${omega.padStart(5)} | ${pnl.padStart(8)} | ${row.bets.toString().padStart(4)}`
    )
  })

  return data
}

/**
 * Query 5: Elite Traders (High Omega + High Hit Rate)
 */
async function eliteTraders(window: TimeWindow = '90d') {
  console.log(`\n⭐ Elite Traders (${window} window - High Omega + High Hit Rate):\n`)

  const query = `
    SELECT
      wallet_address,
      metric_2_omega_net as omega,
      metric_12_hit_rate * 100 as hit_rate_pct,
      metric_9_net_pnl_usd as net_pnl,
      metric_15_ev_per_bet_mean as ev_per_bet,
      metric_22_resolved_bets as bets
    FROM wallet_metrics_complete
    WHERE window = ${WINDOW_ENUM[window]}
      AND metric_2_omega_net >= 2.0
      AND metric_12_hit_rate >= 0.55
      AND metric_22_resolved_bets >= 15
    ORDER BY metric_2_omega_net DESC
    LIMIT 50
  `

  const result = await clickhouse.query({ query, format: 'JSONEachRow' })
  const data = await result.json() as any[]

  console.log(`Found ${data.length} elite traders\n`)
  console.log('Rank | Wallet (last 8) | Omega | Hit %  | Net PnL  | EV/Bet  | Bets')
  console.log('-'.repeat(75))

  data.forEach((row, idx) => {
    const wallet = row.wallet_address.slice(-8)
    const omega = row.omega?.toFixed(2) || 'N/A'
    const hitRate = row.hit_rate_pct?.toFixed(1) || '0'
    const pnl = `$${row.net_pnl?.toLocaleString(undefined, { maximumFractionDigits: 0 }) || '0'}`
    const evPerBet = `$${row.ev_per_bet?.toFixed(2) || '0'}`

    console.log(
      `${(idx + 1).toString().padStart(4)} | ${wallet} | ${omega.padStart(5)} | ${hitRate.padStart(5)}% | ${pnl.padStart(8)} | ${evPerBet.padStart(7)} | ${row.bets.toString().padStart(4)}`
    )
  })

  return data
}

/**
 * Query 6: Statistics Summary
 */
async function statisticsSummary() {
  console.log('\n📈 Statistics Summary Across All Windows:\n')

  const query = `
    SELECT
      window,
      count(*) as wallets,
      quantile(0.25)(metric_2_omega_net) as p25_omega,
      quantile(0.5)(metric_2_omega_net) as median_omega,
      quantile(0.75)(metric_2_omega_net) as p75_omega,
      quantile(0.95)(metric_2_omega_net) as p95_omega,
      avg(metric_12_hit_rate) * 100 as avg_hit_rate,
      sum(metric_9_net_pnl_usd) as total_pnl,
      avg(metric_22_resolved_bets) as avg_bets
    FROM wallet_metrics_complete
    GROUP BY window
    ORDER BY window
  `

  const result = await clickhouse.query({ query, format: 'JSONEachRow' })
  const data = await result.json() as any[]

  console.log('Window   | Wallets | P25 Ω | Median Ω | P75 Ω | P95 Ω | Avg Hit % | Total PnL      | Avg Bets')
  console.log('-'.repeat(100))

  data.forEach((row) => {
    const windowName = Object.keys(WINDOW_ENUM).find(k => WINDOW_ENUM[k as TimeWindow] === row.window) || 'unknown'
    const p25 = row.p25_omega?.toFixed(2) || 'N/A'
    const median = row.median_omega?.toFixed(2) || 'N/A'
    const p75 = row.p75_omega?.toFixed(2) || 'N/A'
    const p95 = row.p95_omega?.toFixed(2) || 'N/A'
    const hitRate = row.avg_hit_rate?.toFixed(1) || '0'
    const totalPnl = `$${row.total_pnl?.toLocaleString(undefined, { maximumFractionDigits: 0 }) || '0'}`
    const avgBets = row.avg_bets?.toFixed(1) || '0'

    console.log(
      `${windowName.padEnd(8)} | ${row.wallets.toString().padStart(7)} | ${p25.padStart(5)} | ${median.padStart(8)} | ${p75.padStart(5)} | ${p95.padStart(5)} | ${hitRate.padStart(9)}% | ${totalPnl.padStart(14)} | ${avgBets.padStart(8)}`
    )
  })
}

/**
 * Query 7: Wallet Detail
 */
async function walletDetail(walletAddress: string) {
  console.log(`\n🔍 Wallet Detail: ${walletAddress}\n`)

  const query = `
    SELECT
      window,
      metric_2_omega_net as omega,
      metric_9_net_pnl_usd as net_pnl,
      metric_12_hit_rate * 100 as hit_rate,
      metric_13_avg_win_usd as avg_win,
      metric_14_avg_loss_usd as avg_loss,
      metric_15_ev_per_bet_mean as ev_per_bet,
      metric_22_resolved_bets as bets
    FROM wallet_metrics_complete
    WHERE wallet_address = '${walletAddress}'
    ORDER BY window
  `

  const result = await clickhouse.query({ query, format: 'JSONEachRow' })
  const data = await result.json() as any[]

  if (data.length === 0) {
    console.log('   No data found for this wallet')
    return
  }

  console.log('Window   | Omega | Net PnL  | Hit % | Avg Win | Avg Loss | EV/Bet  | Bets')
  console.log('-'.repeat(85))

  data.forEach((row) => {
    const windowName = Object.keys(WINDOW_ENUM).find(k => WINDOW_ENUM[k as TimeWindow] === row.window) || 'unknown'
    const omega = row.omega?.toFixed(2) || 'N/A'
    const pnl = `$${row.net_pnl?.toLocaleString(undefined, { maximumFractionDigits: 0 }) || '0'}`
    const hitRate = row.hit_rate?.toFixed(1) || '0'
    const avgWin = `$${row.avg_win?.toFixed(0) || '0'}`
    const avgLoss = `$${row.avg_loss?.toFixed(0) || '0'}`
    const evPerBet = `$${row.ev_per_bet?.toFixed(2) || '0'}`

    console.log(
      `${windowName.padEnd(8)} | ${omega.padStart(5)} | ${pnl.padStart(8)} | ${hitRate.padStart(5)} | ${avgWin.padStart(7)} | ${avgLoss.padStart(8)} | ${evPerBet.padStart(7)} | ${row.bets.toString().padStart(4)}`
    )
  })

  return data
}

/**
 * Main menu
 */
async function main() {
  console.log('═'.repeat(80))
  console.log('                    TIER 1 METRICS - DEMO QUERIES')
  console.log('═'.repeat(80))

  const args = process.argv.slice(2)

  if (args.length === 0) {
    console.log('\nUsage: npx tsx scripts/demo-tier1-queries.ts <query_name> [params...]')
    console.log('\nAvailable queries:')
    console.log('  1. top-performers [window] [limit]    - Top performers by omega')
    console.log('  2. profitable [window] [minBets]      - Profitable wallets')
    console.log('  3. high-accuracy [window] [minHitRate]- High accuracy traders')
    console.log('  4. best-ev [window] [minBets]         - Best EV per bet')
    console.log('  5. elite [window]                     - Elite traders (high omega + hit rate)')
    console.log('  6. stats                              - Statistics summary')
    console.log('  7. wallet [address]                   - Wallet detail')
    console.log('  8. all [window]                       - Run all queries for a window')
    console.log('\nExamples:')
    console.log('  npx tsx scripts/demo-tier1-queries.ts top-performers 30d 20')
    console.log('  npx tsx scripts/demo-tier1-queries.ts profitable lifetime 25')
    console.log('  npx tsx scripts/demo-tier1-queries.ts wallet 0x742d35Cc6634C0532925a3b844Bc454e4438f44e')
    console.log('  npx tsx scripts/demo-tier1-queries.ts all 90d')
    console.log()
    return
  }

  const command = args[0]

  try {
    switch (command) {
      case 'top-performers':
      case '1':
        await topPerformersByOmega(args[1] as TimeWindow || '30d', parseInt(args[2]) || 50)
        break

      case 'profitable':
      case '2':
        await profitableWallets(args[1] as TimeWindow || 'lifetime', parseInt(args[2]) || 20)
        break

      case 'high-accuracy':
      case '3':
        await highAccuracyTraders(args[1] as TimeWindow || '90d', parseFloat(args[2]) || 0.60)
        break

      case 'best-ev':
      case '4':
        await bestEVPerBet(args[1] as TimeWindow || '180d', parseInt(args[2]) || 25)
        break

      case 'elite':
      case '5':
        await eliteTraders(args[1] as TimeWindow || '90d')
        break

      case 'stats':
      case '6':
        await statisticsSummary()
        break

      case 'wallet':
      case '7':
        if (!args[1]) {
          console.log('\n❌ Please provide a wallet address')
          return
        }
        await walletDetail(args[1])
        break

      case 'all':
      case '8':
        const window = args[1] as TimeWindow || '30d'
        await topPerformersByOmega(window, 20)
        await profitableWallets(window, 15)
        await highAccuracyTraders(window, 0.55)
        await bestEVPerBet(window, 15)
        await eliteTraders(window)
        await statisticsSummary()
        break

      default:
        console.log(`\n❌ Unknown command: ${command}`)
        console.log('Run without arguments to see available commands')
    }

    console.log()
  } catch (error) {
    console.error('\n❌ Error executing query:', error)
    process.exit(1)
  }
}

main()
