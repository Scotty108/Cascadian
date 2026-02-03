import { clickhouse } from '../lib/clickhouse/client'
import * as fs from 'fs'

async function exportLeaderboard() {
  console.log('Exporting filtered leaderboard from pm_trade_fifo_roi_v3_mat_unified...')

  const query = `
    WITH wallet_stats AS (
        SELECT
            wallet,
            uniqExact(condition_id) as markets,
            count() as total_trades,
            countIf(entry_time >= now() - INTERVAL 5 DAY) as trades_last_5d,
            avgIf(cost_usd, is_closed = 1) as avg_bet,  -- Only closed trades
            avgIf(roi, is_closed = 1) * 100 as ev_pct,  -- Only closed trades (EV based on resolved outcomes)
            countIf(is_closed = 1 AND pnl_usd > 0) * 100.0 / nullIf(countIf(is_closed = 1), 0) as win_rate_pct,

            -- Additional metrics
            sum(cost_usd) as total_volume,
            sumIf(pnl_usd, is_closed = 1) as total_pnl,  -- Only closed trades
            countIf(is_closed = 1) as closed_trades,
            countIf(is_closed = 0) as open_trades,
            countIf(is_short = 1) as short_trades,
            countIf(is_short = 0) as long_trades,

            -- % held to resolution (only makes sense for closed trades)
            countIf(is_closed = 1 AND pct_sold_early < 0.01) * 100.0 / nullIf(countIf(is_closed = 1), 0) as pct_held_to_resolution,
            avgIf(pct_sold_early, is_closed = 1) * 100 as avg_pct_sold_early,  -- Only closed trades

            -- Trades per day
            total_trades / nullIf(dateDiff('day', min(entry_time), max(entry_time)) + 1, 0) as trades_per_day,

            -- Hold time
            avgIf(dateDiff('minute', entry_time, resolved_at), is_closed = 1 AND resolved_at IS NOT NULL) as avg_hold_time_minutes,

            -- Date range
            min(entry_time) as first_trade,
            max(entry_time) as last_trade,
            dateDiff('day', min(entry_time), max(entry_time)) + 1 as active_days,

            -- Win/Loss
            sumIf(pnl_usd, pnl_usd > 0 AND is_closed = 1) as total_wins_usd,
            sumIf(pnl_usd, pnl_usd < 0 AND is_closed = 1) as total_losses_usd,
            avgIf(pnl_usd, pnl_usd > 0 AND is_closed = 1) as avg_win_usd,
            avgIf(pnl_usd, pnl_usd < 0 AND is_closed = 1) as avg_loss_usd,
            medianIf(roi * 100, is_closed = 1) as median_roi_pct

        FROM pm_trade_fifo_roi_v3_mat_unified
        GROUP BY wallet
        HAVING markets > 10
           AND trades_last_5d >= 1
           AND avg_bet > 10
           AND ev_pct > 5
           AND win_rate_pct > 75
    )
    SELECT
        wallet,
        markets,
        total_trades,
        trades_last_5d,
        round(avg_bet, 2) as avg_bet_usd,
        round(total_volume, 2) as total_volume_usd,
        round(total_pnl, 2) as total_pnl_usd,
        round(ev_pct, 2) as ev_pct,
        round(win_rate_pct, 2) as win_rate_pct,
        closed_trades,
        open_trades,
        long_trades,
        short_trades,
        round(pct_held_to_resolution, 2) as pct_held_to_resolution,
        round(avg_pct_sold_early, 2) as avg_pct_sold_early,
        round(trades_per_day, 2) as trades_per_day,
        round(avg_hold_time_minutes, 0) as avg_hold_time_minutes,
        round(active_days, 0) as active_days,
        round(total_wins_usd, 2) as total_wins_usd,
        round(total_losses_usd, 2) as total_losses_usd,
        round(avg_win_usd, 2) as avg_win_usd,
        round(avg_loss_usd, 2) as avg_loss_usd,
        round(median_roi_pct, 2) as median_roi_pct,
        first_trade,
        last_trade
    FROM wallet_stats
    ORDER BY total_pnl DESC
  `

  const result = await clickhouse.query({ query, format: 'JSONEachRow' })
  const rows = await result.json() as any[]

  console.log(`Found ${rows.length} wallets`)

  // Build CSV
  const headers = [
    'wallet',
    'markets',
    'total_trades',
    'trades_last_5d',
    'avg_bet_usd',
    'total_volume_usd',
    'total_pnl_usd',
    'ev_pct',
    'win_rate_pct',
    'closed_trades',
    'open_trades',
    'long_trades',
    'short_trades',
    'pct_held_to_resolution',
    'avg_pct_sold_early',
    'trades_per_day',
    'avg_hold_time_minutes',
    'active_days',
    'total_wins_usd',
    'total_losses_usd',
    'avg_win_usd',
    'avg_loss_usd',
    'median_roi_pct',
    'first_trade',
    'last_trade'
  ]

  const csvLines = [headers.join(',')]

  for (const row of rows) {
    const values = headers.map(h => {
      const val = row[h]
      if (val === null || val === undefined) return ''
      if (typeof val === 'string' && val.includes(',')) return `"${val}"`
      return val
    })
    csvLines.push(values.join(','))
  }

  const outputPath = './exports/leaderboard-v25-filtered.csv'
  fs.mkdirSync('./exports', { recursive: true })
  fs.writeFileSync(outputPath, csvLines.join('\n'))

  console.log(`Exported to ${outputPath}`)
  console.log('\n--- Filter Funnel (with corrected is_closed) ---')
  console.log('Step 0: All wallets              -> 1,814,034')
  console.log('Step 1: >10 markets              ->   590,987')
  console.log('Step 2: + Bought last 5 days     ->    56,048')
  console.log('Step 3: + Avg bet >$10 (closed)  ->    40,250')
  console.log('Step 4: + EV >5% (closed)        ->    15,265')
  console.log('Step 5: + Win Rate >75%          ->     2,796')
}

exportLeaderboard().catch(console.error)
