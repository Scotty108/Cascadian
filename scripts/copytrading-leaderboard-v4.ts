/**
 * Top 50 Copytrading Leaderboard - V4
 * Using pm_trade_fifo_roi_v3 with NO bankroll limitation
 *
 * Ranks wallets by Log Growth Per Day
 * Every trade is copied with $2, no skipping
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '../lib/clickhouse/client'

// Configuration
const BET_SIZE = 2.0          // Bet size per trade
const LOOKBACK_DAYS = 90      // Last 90 days
const ACTIVE_DAYS = 4         // Must trade in last 4 days
const MIN_TRADES = 30         // > 30 trades
const MIN_MARKETS = 6         // > 6 markets
const MIN_WIN_RATE = 40       // > 40% win rate
const MIN_MEDIAN_BET = 5      // Median bet > $5
const MAX_MICRO_ARB_PCT = 10  // < 10% micro-arb trades

async function main() {
  console.log('=== Copytrading Leaderboard V4 (No Bankroll Limitation) ===')
  console.log(`Bet size: $${BET_SIZE} per trade, Lookback: ${LOOKBACK_DAYS} days`)
  console.log('')

  // Steps 1-12: Single query to get filtered wallets with all metrics
  console.log('Running query (Steps 1-12)...')
  const results = await getLeaderboard()
  console.log(`Found ${results.length} wallets with positive LogGrowthPerDay`)

  // Display leaderboard
  console.log('\n' + '='.repeat(200))
  console.log('TOP 50 COPYTRADING LEADERBOARD (Last 90 Days, No Bankroll Limit)')
  console.log('='.repeat(200))

  console.log(
    'Rank'.padEnd(5) +
    'Wallet Address'.padEnd(44) +
    'LogGrowth/Day'.padEnd(15) +
    'ROI%/Day'.padEnd(12) +
    'Trades/Day'.padEnd(12) +
    'FinalBank'.padEnd(14) +
    'Copied'.padEnd(8) +
    'Skipped'.padEnd(9) +
    'EV/Trade'.padEnd(12) +
    'CompScore'.padEnd(12) +
    'WinRate%'.padEnd(10) +
    'MedROI%'.padEnd(10) +
    'Last Trade'
  )
  console.log('-'.repeat(200))

  const top50 = results.slice(0, 50)
  for (let i = 0; i < top50.length; i++) {
    const r = top50[i]
    console.log(
      String(i + 1).padEnd(5) +
      r.wallet.padEnd(44) +
      r.log_growth_per_day.toFixed(6).padEnd(15) +
      r.roi_pct_per_day.toFixed(4).padEnd(12) +
      r.trades_per_day.toFixed(2).padEnd(12) +
      `$${r.final_bankroll.toFixed(2)}`.padEnd(14) +
      String(r.trades_copied).padEnd(8) +
      String(r.trades_skipped).padEnd(9) +
      r.ev_per_trade.toFixed(4).padEnd(12) +
      r.compounding_score.toFixed(4).padEnd(12) +
      r.win_rate_pct.toFixed(1).padEnd(10) +
      r.median_roi_pct.toFixed(1).padEnd(10) +
      r.date_last_trade
    )
  }

  console.log('='.repeat(200))

  // JSON output
  console.log('\n📊 JSON Output:')
  console.log(JSON.stringify(top50.map((r, i) => ({
    rank: i + 1,
    wallet: r.wallet,
    log_growth_per_day: r.log_growth_per_day,
    roi_pct_per_day: r.roi_pct_per_day,
    trades_per_day: r.trades_per_day,
    final_bankroll: r.final_bankroll,
    trades_copied: r.trades_copied,
    trades_skipped: r.trades_skipped,
    ev_per_trade: r.ev_per_trade,
    compounding_score: r.compounding_score,
    win_rate_pct: r.win_rate_pct,
    median_roi_pct: r.median_roi_pct,
    date_last_trade: r.date_last_trade
  })), null, 2))
}

interface LeaderboardRow {
  wallet: string
  log_growth_per_day: number
  roi_pct_per_day: number
  trades_per_day: number
  final_bankroll: number
  trades_copied: number
  trades_skipped: number
  ev_per_trade: number
  compounding_score: number
  win_rate_pct: number
  median_roi_pct: number
  date_last_trade: string
}

async function getLeaderboard(): Promise<LeaderboardRow[]> {
  const query = `
    WITH
    -- CRITICAL: Deduplicate FIFO table first (278M → 78M rows)
    deduped_fifo AS (
      SELECT
        wallet,
        condition_id,
        outcome_index,
        any(entry_time) as entry_time,
        any(resolved_at) as resolved_at,
        any(tokens) as tokens,
        any(cost_usd) as cost_usd,
        any(roi) as roi
      FROM pm_trade_fifo_roi_v3
      WHERE entry_time >= now() - INTERVAL ${LOOKBACK_DAYS} DAY
      GROUP BY wallet, condition_id, outcome_index
    ),
    -- Step 1: Get 90-day dataset
    trades_90d AS (
      SELECT
        wallet,
        condition_id,
        outcome_index,
        entry_time,
        resolved_at,
        tokens,
        abs(cost_usd) as cost_usd,
        abs(cost_usd) / nullIf(tokens, 0) as entry_price,
        roi,
        (toUnixTimestamp(resolved_at) - toUnixTimestamp(entry_time)) / 86400.0 as hold_days
      FROM deduped_fifo
      WHERE tokens > 0
        AND resolved_at > entry_time
    ),

    -- Steps 2-7: Filter wallets
    wallet_base AS (
      SELECT
        wallet,
        count() as total_trades,
        uniqExact(condition_id) as markets_traded,
        min(entry_time) as first_trade_time,
        max(entry_time) as last_trade_time,

        -- Win/loss counts (roi > 1 means profit)
        countIf(roi > 1) as wins,
        countIf(roi <= 1) as losses,
        countIf(roi > 1) * 100.0 / count() as win_rate_pct,

        -- Median bet size
        medianExact(cost_usd) as median_bet_size,

        -- Micro-arb filter: YES at >0.95 or NO at <0.05
        countIf(
          (outcome_index = 0 AND entry_price > 0.95) OR
          (outcome_index = 1 AND entry_price < 0.05)
        ) * 100.0 / count() as micro_arb_pct,

        -- Step 8: Winsorization - p95 ROI
        quantile(0.95)(roi - 1) as p95_roi,

        -- Median win ROI (among winners, roi > 1)
        medianExactIf(roi - 1, roi > 1) as median_win_roi,

        -- Median loss magnitude (among losers, roi <= 1)
        medianExactIf(1 - roi, roi <= 1) as median_loss_mag,

        -- Step 10: Hold time
        avg(if(hold_days > 0 AND hold_days < 90, hold_days, null)) as avg_hold_days,

        -- Step 11: Simulation (no bankroll limit)
        -- B_0 = $2 * N, B_T = $2 * sum(roi)
        avg(roi) as avg_roi,
        sum(roi) as sum_roi,

        -- Time range for days calculation
        (toUnixTimestamp(max(resolved_at)) - toUnixTimestamp(min(entry_time))) / 86400.0 as days_active

      FROM trades_90d
      GROUP BY wallet
      HAVING
        -- Step 2: Active in last 4 days
        last_trade_time >= now() - INTERVAL ${ACTIVE_DAYS} DAY
        -- Step 3: > 30 trades
        AND total_trades > ${MIN_TRADES}
        -- Step 4: > 6 markets
        AND markets_traded > ${MIN_MARKETS}
        -- Step 5: Win rate > 40%
        AND win_rate_pct > ${MIN_WIN_RATE}
        -- Step 6: Median bet > $5
        AND median_bet_size > ${MIN_MEDIAN_BET}
        -- Step 7: Micro-arb < 10%
        AND micro_arb_pct <= ${MAX_MICRO_ARB_PCT}
        -- Must have both wins and losses for EV calc
        AND wins > 0
        AND losses > 0
    ),

    -- Step 9: Compute EV and filter EV > 0
    wallet_with_ev AS (
      SELECT
        *,
        -- EV = (W * median_win) - ((1-W) * median_loss)
        (win_rate_pct / 100.0 * median_win_roi) - ((1 - win_rate_pct / 100.0) * median_loss_mag) as ev_per_trade
      FROM wallet_base
      WHERE median_win_roi IS NOT NULL
        AND median_loss_mag IS NOT NULL
    ),

    -- Final calculations
    final AS (
      SELECT
        wallet,

        -- LogGrowthPerDay = ln(avg_roi) / days_active
        -- avg_roi = sum(roi) / N = B_T / B_0 when betting $2 per trade
        ln(avg_roi) / greatest(1, days_active) as log_growth_per_day,

        -- ROI % per day = (avg_roi - 1) / days_active
        (avg_roi - 1) * 100 / greatest(1, days_active) as roi_pct_per_day,

        -- Trades per day
        total_trades / greatest(1, days_active) as trades_per_day,

        -- Final bankroll = $2 * sum(roi)
        ${BET_SIZE} * sum_roi as final_bankroll,

        -- All trades copied, none skipped
        total_trades as trades_copied,
        0 as trades_skipped,

        -- EV per trade
        ev_per_trade,

        -- Compounding score = EV / avg_hold_days
        ev_per_trade / greatest(0.01, coalesce(avg_hold_days, 1)) as compounding_score,

        -- Win rate %
        win_rate_pct,

        -- Median ROI % (winsorized - capped at p95)
        least(median_win_roi, p95_roi) * 100 as median_roi_pct,

        -- Date of last trade
        formatDateTime(last_trade_time, '%Y-%m-%d') as date_last_trade

      FROM wallet_with_ev
      WHERE ev_per_trade > 0  -- Step 9 safety gate
        AND avg_roi > 1       -- Must be profitable overall
    )

    SELECT *
    FROM final
    ORDER BY log_growth_per_day DESC
    LIMIT 50
  `

  const result = await clickhouse.query({ query, format: 'JSONEachRow' })
  const rows = await result.json() as any[]

  return rows.map(r => ({
    wallet: r.wallet,
    log_growth_per_day: Number(r.log_growth_per_day),
    roi_pct_per_day: Number(r.roi_pct_per_day),
    trades_per_day: Number(r.trades_per_day),
    final_bankroll: Number(r.final_bankroll),
    trades_copied: Number(r.trades_copied),
    trades_skipped: Number(r.trades_skipped),
    ev_per_trade: Number(r.ev_per_trade),
    compounding_score: Number(r.compounding_score),
    win_rate_pct: Number(r.win_rate_pct),
    median_roi_pct: Number(r.median_roi_pct),
    date_last_trade: r.date_last_trade
  }))
}

main().catch(console.error)
