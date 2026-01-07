/**
 * Simulate Copy Trading Returns v2 - BATCH APPROACH
 *
 * Instead of per-wallet queries (timeout), use ONE bulk query for all wallets.
 *
 * @author Claude (Edge Detection Approach)
 */

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
import { clickhouse } from '@/lib/clickhouse/client'

// Top wallets from our edge detection hunt (just use the goldmine one for now)
const TOP_WALLETS = [
  '0x4044798f1d60d92369c86cf5b6f1e497e2818de5',  // #4 GOLDMINE
  '0x1e62e1e8ab58b631ebca23f3027e94df0e36dad4',  // #1 @isunou
  '0xc4a08effa3ff5056f96e0e051c7c8d8e19d47a3d',  // #2
  '0xd52ee3a3f8ff7ac23e636ff47da4ef58d6b01ccc',  // #3
  '0x78d0f71aa3e3cc6e9db56e41e58bb07c3763fa64',  // #5
]

async function runSimulation() {
  console.log('╔═══════════════════════════════════════════════════════════════════════════════════════╗')
  console.log('║        COPY TRADING SIMULATION v2 - BULK BATCH APPROACH                              ║')
  console.log('╠═══════════════════════════════════════════════════════════════════════════════════════╣')
  console.log('║ Uses ONE bulk query instead of per-wallet queries to avoid timeout                   ║')
  console.log('╚═══════════════════════════════════════════════════════════════════════════════════════╝')
  console.log()

  // Step 1: Get all trades for all wallets in ONE query (last 30 days for more data)
  console.log('📊 Fetching trades for all wallets in single bulk query...')

  const walletsStr = TOP_WALLETS.map(w => `'${w.toLowerCase()}'`).join(',')

  // Use subquery to filter by time AFTER aggregation
  const tradesQuery = `
    SELECT * FROM (
      SELECT
        lower(trader_wallet) as wallet,
        event_id,
        any(side) as side,
        any(usdc_amount) / 1e6 as usdc,
        any(token_amount) / 1e6 as tokens,
        any(usdc_amount) / NULLIF(any(token_amount), 0) as entry_price,
        any(trade_time) as trade_time,
        any(token_id) as token_id
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) IN (${walletsStr})
        AND is_deleted = 0
      GROUP BY lower(trader_wallet), event_id
    )
    WHERE trade_time >= now() - INTERVAL 30 DAY
    ORDER BY wallet, trade_time ASC
  `

  console.log('Running bulk trades query...')
  const tradesResult = await clickhouse.query({ query: tradesQuery, format: 'JSONEachRow' })
  const allTrades = await tradesResult.json() as any[]

  console.log(`✅ Got ${allTrades.length} total trades across ${TOP_WALLETS.length} wallets`)
  console.log()

  // Step 2: Get all token resolutions in ONE query
  const tokenIds = [...new Set(allTrades.map(t => t.token_id))]
  console.log(`📊 Fetching resolutions for ${tokenIds.length} unique tokens...`)

  const resolutionsQuery = `
    SELECT
      m.token_id_dec as token_id,
      m.condition_id,
      m.outcome_index,
      r.payout_numerators,
      r.resolved_at,
      CASE
        WHEN r.resolved_at IS NULL THEN 0
        ELSE 1
      END as is_resolved
    FROM pm_token_to_condition_map_v5 m
    LEFT JOIN pm_condition_resolutions r ON lower(m.condition_id) = lower(r.condition_id) AND r.is_deleted = 0
    WHERE m.token_id_dec IN (${tokenIds.map(t => `'${t}'`).join(',')})
  `

  const resResult = await clickhouse.query({ query: resolutionsQuery, format: 'JSONEachRow' })
  const resolutions = await resResult.json() as any[]

  console.log(`✅ Got ${resolutions.length} resolution records`)
  console.log()

  // Build resolution lookup
  const resolutionMap = new Map<string, { resolved: boolean, winning_outcome: number }>()
  for (const r of resolutions) {
    const payouts = r.payout_numerators?.replace(/[\[\]]/g, '').split(',').map(Number) || []
    const winningOutcome = payouts.length > 0 ? payouts.indexOf(Math.max(...payouts)) : -1
    resolutionMap.set(r.token_id, {
      resolved: r.is_resolved === 1,
      winning_outcome: winningOutcome
    })
  }

  // Step 3: Process trades per wallet
  const results: any[] = []

  for (const wallet of TOP_WALLETS) {
    const walletTrades = allTrades.filter(t => t.wallet === wallet.toLowerCase())

    let copyable_trades = 0
    let total_invested = 0
    let total_return = 0
    let wins = 0
    let losses = 0
    let pending = 0
    let sum_entry = 0
    let skipped_high = 0

    for (const trade of walletTrades) {
      const entry_price = parseFloat(trade.entry_price)

      // Skip if entry > 85¢
      if (entry_price > 0.85) {
        skipped_high++
        continue
      }

      copyable_trades++
      sum_entry += entry_price

      // $1 per trade
      const investment = 1.0
      total_invested += investment

      const resolution = resolutionMap.get(trade.token_id)

      if (!resolution || !resolution.resolved) {
        pending++
        continue
      }

      // Calculate PnL
      const isBuy = trade.side === 'buy'
      const yesWon = resolution.winning_outcome === 0

      let pnl = 0
      if (isBuy) {
        if (yesWon) {
          pnl = (1.0 / entry_price) * investment - investment
          wins++
        } else {
          pnl = -investment
          losses++
        }
      } else {
        if (!yesWon) {
          pnl = ((1.0 - entry_price) / entry_price) * investment
          wins++
        } else {
          pnl = -investment
          losses++
        }
      }

      total_return += pnl
    }

    const roi = total_invested > 0 ? (total_return / total_invested) * 100 : 0
    const avg_entry = copyable_trades > 0 ? sum_entry / copyable_trades : 0

    results.push({
      wallet: wallet.slice(0, 18) + '...',
      total_trades: walletTrades.length,
      copyable: copyable_trades,
      skipped: skipped_high,
      wins,
      losses,
      pending,
      invested: total_invested,
      return: total_return,
      roi,
      avg_entry
    })

    console.log(`💼 ${wallet.slice(0, 10)}...`)
    console.log(`   Trades: ${walletTrades.length} total, ${copyable_trades} copyable, ${skipped_high} skipped (>85¢)`)
    console.log(`   Results: ${wins} wins, ${losses} losses, ${pending} pending`)
    console.log(`   ROI: ${roi >= 0 ? '+' : ''}${roi.toFixed(1)}% on $${total_invested.toFixed(0)} invested`)
    console.log()
  }

  // Sort by ROI
  results.sort((a, b) => b.roi - a.roi)

  // Print leaderboard
  console.log('╔══════════════════════════════════════════════════════════════════════════════════════════════════════╗')
  console.log('║                       30-DAY COPY TRADING SIMULATION LEADERBOARD                                     ║')
  console.log('╠══════════════════════════════════════════════════════════════════════════════════════════════════════╣')
  console.log('║ Rank │ Wallet               │ Trades │ Copyable │ W/L/P       │ Invested │ Return   │ ROI      ║')
  console.log('╠══════╪══════════════════════╪════════╪══════════╪═════════════╪══════════╪══════════╪══════════╣')

  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    const row = [
      String(i + 1).padStart(4),
      r.wallet.padEnd(20),
      String(r.total_trades).padStart(6),
      String(r.copyable).padStart(8),
      `${r.wins}/${r.losses}/${r.pending}`.padStart(11),
      `$${r.invested.toFixed(0)}`.padStart(8),
      `$${r.return.toFixed(2)}`.padStart(8),
      `${r.roi >= 0 ? '+' : ''}${r.roi.toFixed(1)}%`.padStart(8),
    ].join(' │ ')
    console.log(`║ ${row} ║`)
  }

  console.log('╚══════════════════════════════════════════════════════════════════════════════════════════════════════╝')

  // Save
  const fs = await import('fs')
  fs.writeFileSync(
    '/Users/scotty/Projects/Cascadian-app/scripts/experimental/results/simulation-results-v2.json',
    JSON.stringify(results, null, 2)
  )
  console.log('\n📁 Results saved to results/simulation-results-v2.json')

  return results
}

runSimulation()
  .then(() => {
    console.log('\n✅ Simulation complete!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('Simulation failed:', error)
    process.exit(1)
  })
